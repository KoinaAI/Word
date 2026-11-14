package app

import (
	"context"
	"net/http"
	"time"
)

// activity returns a zero-filled fourteen-day window so charts never imply activity
// on a day with no recorded answers. An ID of zero selects site-wide activity.
func (a *App) activity(ctx context.Context, userID int64) ([]Activity, error) {
	today := time.Now().UTC().Truncate(24 * time.Hour)
	start := today.AddDate(0, 0, -13)
	rows, e := a.db.QueryContext(ctx, "SELECT substr(created_at,1,10),COUNT(*) FROM answers WHERE created_at>=? AND (?=0 OR user_id=?) GROUP BY substr(created_at,1,10)", stamp(start), userID, userID)
	if e != nil {
		return nil, e
	}
	defer rows.Close()
	counts := map[string]int{}
	for rows.Next() {
		var day string
		var count int
		if e = rows.Scan(&day, &count); e != nil {
			return nil, e
		}
		counts[day] = count
	}
	if e = rows.Err(); e != nil {
		return nil, e
	}
	result := make([]Activity, 0, 14)
	for day := start; !day.After(today); day = day.AddDate(0, 0, 1) {
		key := day.Format("2006-01-02")
		result = append(result, Activity{Date: key, Count: counts[key]})
	}
	return result, nil
}
func (a *App) recent(ctx context.Context, userID int64) ([]Recent, error) {
	rows, e := a.db.QueryContext(ctx, "SELECT id,word_text,word_meaning,answer,created_at FROM answers WHERE (?=0 OR user_id=?) ORDER BY id DESC LIMIT 10", userID, userID)
	if e != nil {
		return nil, e
	}
	defer rows.Close()
	result := []Recent{}
	for rows.Next() {
		var item Recent
		if e = rows.Scan(&item.ID, &item.Text, &item.Meaning, &item.Answer, &item.CreatedAt); e != nil {
			return nil, e
		}
		result = append(result, item)
	}
	return result, rows.Err()
}
func (a *App) streak(ctx context.Context, id int64) (int, error) {
	rows, e := a.db.QueryContext(ctx, "SELECT DISTINCT substr(created_at,1,10) AS day FROM answers WHERE user_id=? ORDER BY day DESC", id)
	if e != nil {
		return 0, e
	}
	defer rows.Close()
	expected := time.Now().UTC().Truncate(24 * time.Hour)
	count := 0
	for rows.Next() {
		var day string
		if e = rows.Scan(&day); e != nil {
			return 0, e
		}
		date, e := time.Parse("2006-01-02", day)
		if e != nil {
			return 0, e
		}
		if count == 0 && date.Equal(expected.AddDate(0, 0, -1)) {
			expected = date
		}
		if !date.Equal(expected) {
			break
		}
		count++
		expected = expected.AddDate(0, 0, -1)
	}
	return count, rows.Err()
}
func (a *App) stats(w http.ResponseWriter, r *http.Request) {
	id := currentID(r)
	now := time.Now()
	start := stamp(now.UTC().Truncate(24 * time.Hour))
	var result struct {
		Learned    int        `json:"learned"`
		Due        int        `json:"due"`
		Reinforce  int        `json:"reinforce"`
		Favorites  int        `json:"favorites"`
		Today      int        `json:"today"`
		Streak     int        `json:"streak"`
		TotalWords int        `json:"totalWords"`
		Activity   []Activity `json:"activity"`
		Recent     []Recent   `json:"recent"`
	}
	e := a.db.QueryRowContext(r.Context(), `SELECT (SELECT COUNT(*) FROM progress WHERE user_id=? AND status='mastered'),(SELECT COUNT(*) FROM progress WHERE user_id=? AND due_at<>'' AND due_at<=?),(SELECT COUNT(*) FROM progress WHERE user_id=? AND reinforce=1),(SELECT COUNT(*) FROM favorites WHERE user_id=?),(SELECT COUNT(DISTINCT submitted_word_id) FROM answers WHERE user_id=? AND created_at>=?),(SELECT COUNT(*) FROM words)`, id, id, stamp(now), id, id, id, start).Scan(&result.Learned, &result.Due, &result.Reinforce, &result.Favorites, &result.Today, &result.TotalWords)
	if e != nil {
		internal(w, e)
		return
	}
	if result.Activity, e = a.activity(r.Context(), id); e != nil {
		internal(w, e)
		return
	}
	if result.Recent, e = a.recent(r.Context(), id); e != nil {
		internal(w, e)
		return
	}
	if result.Streak, e = a.streak(r.Context(), id); e != nil {
		internal(w, e)
		return
	}
	writeJSON(w, 200, result)
}
func (a *App) adminStats(w http.ResponseWriter, r *http.Request) {
	var result struct {
		Users       int        `json:"users"`
		Books       int        `json:"books"`
		Words       int        `json:"words"`
		Answers     int        `json:"answers"`
		ActiveToday int        `json:"activeToday"`
		Activity    []Activity `json:"activity"`
		Recent      []Recent   `json:"recent"`
	}
	e := a.db.QueryRowContext(r.Context(), `SELECT (SELECT COUNT(*) FROM users),(SELECT COUNT(*) FROM books),(SELECT COUNT(*) FROM words),(SELECT COUNT(*) FROM answers),(SELECT COUNT(DISTINCT user_id) FROM answers WHERE created_at>=?)`, stamp(time.Now().UTC().Truncate(24*time.Hour))).Scan(&result.Users, &result.Books, &result.Words, &result.Answers, &result.ActiveToday)
	if e != nil {
		internal(w, e)
		return
	}
	if result.Activity, e = a.activity(r.Context(), 0); e != nil {
		internal(w, e)
		return
	}
	if result.Recent, e = a.recent(r.Context(), 0); e != nil {
		internal(w, e)
		return
	}
	writeJSON(w, 200, result)
}
