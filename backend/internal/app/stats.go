package app

import (
	"context"
	"database/sql"
	"net/http"
	"time"
)

type activityDay struct {
	Date  string `json:"date"`
	Count int    `json:"count"`
}

type recentAnswer struct {
	ID        int64  `json:"id"`
	Text      string `json:"text"`
	Meaning   string `json:"meaning"`
	Answer    string `json:"answer"`
	CreatedAt string `json:"createdAt"`
}

type userStats struct {
	Learned    int            `json:"learned"`
	Due        int            `json:"due"`
	Reinforce  int            `json:"reinforce"`
	Favorites  int            `json:"favorites"`
	Today      int            `json:"today"`
	Streak     int            `json:"streak"`
	TotalWords int            `json:"totalWords"`
	Activity   []activityDay  `json:"activity"`
	Recent     []recentAnswer `json:"recent"`
}

func (a *App) stats(w http.ResponseWriter, r *http.Request, u User) error {
	tx, err := a.db.BeginTx(r.Context(), &sql.TxOptions{ReadOnly: true})
	if err != nil {
		return err
	}
	defer tx.Rollback()
	var stats userStats
	now := a.now()
	err = tx.QueryRowContext(r.Context(), `SELECT COALESCE(SUM(status='mastered'),0),COALESCE(SUM(due_at<=?),0),
 COALESCE(SUM(reinforce),0),COALESCE(SUM(favorite),0) FROM progress WHERE user_id=?`, now.Unix(), u.ID).Scan(&stats.Learned, &stats.Due, &stats.Reinforce, &stats.Favorites)
	if err != nil {
		return err
	}
	if err = tx.QueryRowContext(r.Context(), "SELECT COUNT(*) FROM words").Scan(&stats.TotalWords); err != nil {
		return err
	}
	stats.Activity, stats.Recent, err = readActivity(r.Context(), tx, now, u.ID)
	if err != nil {
		return err
	}
	stats.Today = stats.Activity[len(stats.Activity)-1].Count
	stats.Streak, err = readStreak(r.Context(), tx, now, u.ID)
	if err != nil {
		return err
	}
	return jsonResponse(w, http.StatusOK, stats)
}

// readActivity returns a 30-day UTC series, counting committed answers (including honest misses).
// Missing dates are zero-filled; recent events retain snapshots even after dictionary edits/deletions.
func readActivity(ctx context.Context, db querier, now time.Time, userID int64) ([]activityDay, []recentAnswer, error) {
	today := time.Date(now.UTC().Year(), now.UTC().Month(), now.UTC().Day(), 0, 0, 0, 0, time.UTC)
	start := today.AddDate(0, 0, -29)
	where := "created_at>=? AND created_at<?"
	args := []any{start.Unix(), today.AddDate(0, 0, 1).Unix()}
	if userID != 0 {
		where += " AND user_id=?"
		args = append(args, userID)
	}
	rows, err := db.QueryContext(ctx, "SELECT strftime('%Y-%m-%d',created_at,'unixepoch'),COUNT(*) FROM events WHERE "+where+" GROUP BY 1 ORDER BY 1", args...)
	if err != nil {
		return nil, nil, err
	}
	counts := map[string]int{}
	for rows.Next() {
		var date string
		var count int
		if err := rows.Scan(&date, &count); err != nil {
			rows.Close()
			return nil, nil, err
		}
		counts[date] = count
	}
	err = rows.Err()
	rows.Close()
	if err != nil {
		return nil, nil, err
	}
	activity := make([]activityDay, 0, 30)
	for day := start; !day.After(today); day = day.AddDate(0, 0, 1) {
		date := day.Format("2006-01-02")
		activity = append(activity, activityDay{date, counts[date]})
	}
	query := "SELECT id,text,meaning,answer,created_at FROM events"
	args = nil
	if userID != 0 {
		query += " WHERE user_id=?"
		args = append(args, userID)
	}
	rows, err = db.QueryContext(ctx, query+" ORDER BY created_at DESC,id DESC LIMIT 20", args...)
	if err != nil {
		return nil, nil, err
	}
	defer rows.Close()
	recent := []recentAnswer{}
	for rows.Next() {
		var event recentAnswer
		var createdAt int64
		if err := rows.Scan(&event.ID, &event.Text, &event.Meaning, &event.Answer, &createdAt); err != nil {
			return nil, nil, err
		}
		event.CreatedAt = isoTime(createdAt)
		recent = append(recent, event)
	}
	return activity, recent, rows.Err()
}

func readStreak(ctx context.Context, db querier, now time.Time, userID int64) (int, error) {
	today := time.Date(now.UTC().Year(), now.UTC().Month(), now.UTC().Day(), 0, 0, 0, 0, time.UTC)
	rows, err := db.QueryContext(ctx, "SELECT DISTINCT strftime('%Y-%m-%d',created_at,'unixepoch') FROM events WHERE user_id=? AND created_at<? ORDER BY 1 DESC", userID, today.AddDate(0, 0, 1).Unix())
	if err != nil {
		return 0, err
	}
	defer rows.Close()
	streak := 0
	expected := today
	for rows.Next() {
		var date string
		if err := rows.Scan(&date); err != nil {
			return 0, err
		}
		if streak == 0 && date != today.Format("2006-01-02") {
			expected = today.AddDate(0, 0, -1)
		}
		if date != expected.Format("2006-01-02") {
			break
		}
		streak++
		expected = expected.AddDate(0, 0, -1)
	}
	return streak, rows.Err()
}
