package app

import (
	"database/sql"
	"errors"
	"math"
	"net/http"
	"strings"
	"time"
)

type progress struct {
	Status       string
	Reinforce    bool
	Due          sql.NullInt64
	Repetitions  int
	IntervalDays int
	Ease         float64
}

type answerInput struct {
	WordID  int64  `json:"wordId"`
	Mode    string `json:"mode"`
	Answer  string `json:"answer"`
	EventID string `json:"eventId"`
}

func validMode(mode string) bool {
	return mode == "learn" || mode == "review" || mode == "sprint" || mode == "reinforce"
}

func validAnswer(answer string) bool {
	return answer == "known" || answer == "unknown" || answer == "unsure-known" || answer == "unsure-unknown"
}

// nextProgress implements the four answers. Sprint misses are deliberately a complete no-op.
// Certain recall uses 1/3/7 days before SM-2 ease multiplication; uncertainty restarts at one day.
func nextProgress(p progress, mode, answer string, now time.Time) progress {
	if mode == "sprint" && (answer == "unknown" || answer == "unsure-unknown") {
		return p
	}
	if p.Ease < 1.3 {
		p.Ease = 2.5
	}
	switch answer {
	case "known":
		p.Status, p.Reinforce = "mastered", false
		p.Repetitions++
		switch p.Repetitions {
		case 1:
			p.IntervalDays = 1
		case 2:
			p.IntervalDays = 3
		case 3:
			p.IntervalDays = 7
		default:
			p.IntervalDays = min(365, max(8, int(math.Round(float64(p.IntervalDays)*p.Ease))))
		}
		p.Ease = math.Min(3, p.Ease+0.1)
		p.Due = sql.NullInt64{Int64: now.Add(time.Duration(p.IntervalDays) * 24 * time.Hour).Unix(), Valid: true}
	case "unsure-known":
		p.Status, p.Reinforce = "learning", true
		p.Repetitions, p.IntervalDays = 0, 1
		p.Ease = math.Max(1.3, p.Ease-0.15)
		p.Due = sql.NullInt64{Int64: now.Add(24 * time.Hour).Unix(), Valid: true}
	case "unknown", "unsure-unknown":
		p.Status = "learning"
		// A failed reinforcement remains in its queue until a certain answer clears it.
		p.Reinforce = p.Reinforce || mode == "reinforce"
		p.Repetitions, p.IntervalDays = 0, 0
		p.Ease = math.Max(1.3, p.Ease-0.2)
		p.Due = sql.NullInt64{Int64: now.Add(10 * time.Minute).Unix(), Valid: true}
	}
	return p
}

func (a *App) answer(w http.ResponseWriter, r *http.Request, u User) error {
	var input answerInput
	if err := decode(w, r, &input); err != nil {
		return err
	}
	if input.WordID < 1 || !validMode(input.Mode) || !validAnswer(input.Answer) || !validText(input.EventID, 1, 128) || strings.TrimSpace(input.EventID) != input.EventID || strings.ContainsAny(input.EventID, "\n\t ") {
		return problem(http.StatusBadRequest, "valid wordId, mode, answer and eventId (1–128 characters without whitespace) are required")
	}
	tx, err := a.db.BeginTx(r.Context(), nil)
	if err != nil {
		return err
	}
	defer tx.Rollback()
	// Check the stored request before the dictionary, so a retry still succeeds after word deletion.
	var previous answerInput
	err = tx.QueryRowContext(r.Context(), "SELECT word_id,mode,answer FROM events WHERE user_id=? AND event_id=?", u.ID, input.EventID).Scan(&previous.WordID, &previous.Mode, &previous.Answer)
	if err == nil {
		if previous.WordID != input.WordID || previous.Mode != input.Mode || previous.Answer != input.Answer {
			return problem(http.StatusConflict, "eventId was already used for a different answer")
		}
		return ok(w)
	}
	if !errors.Is(err, sql.ErrNoRows) {
		return err
	}
	var text, meaning string
	if err = tx.QueryRowContext(r.Context(), "SELECT text,meaning FROM words WHERE id=?", input.WordID).Scan(&text, &meaning); err != nil {
		if errors.Is(err, sql.ErrNoRows) {
			return problem(http.StatusNotFound, "word not found")
		}
		return err
	}
	p := progress{Status: "new", Ease: 2.5}
	err = tx.QueryRowContext(r.Context(), `SELECT status,reinforce,due_at,repetitions,interval_days,ease FROM progress WHERE user_id=? AND word_id=?`, u.ID, input.WordID).Scan(&p.Status, &p.Reinforce, &p.Due, &p.Repetitions, &p.IntervalDays, &p.Ease)
	if err != nil && !errors.Is(err, sql.ErrNoRows) {
		return err
	}
	now := a.now()
	updated := nextProgress(p, input.Mode, input.Answer, now)
	if updated != p {
		_, err = tx.ExecContext(r.Context(), `INSERT INTO progress(user_id,word_id,status,reinforce,due_at,repetitions,interval_days,ease)
 VALUES(?,?,?,?,?,?,?,?) ON CONFLICT(user_id,word_id) DO UPDATE SET status=excluded.status,reinforce=excluded.reinforce,due_at=excluded.due_at,
 repetitions=excluded.repetitions,interval_days=excluded.interval_days,ease=excluded.ease`, u.ID, input.WordID, updated.Status, updated.Reinforce, updated.Due, updated.Repetitions, updated.IntervalDays, updated.Ease)
		if err != nil {
			return err
		}
	}
	_, err = tx.ExecContext(r.Context(), `INSERT INTO events(user_id,event_id,word_id,mode,answer,text,meaning,created_at) VALUES(?,?,?,?,?,?,?,?)`, u.ID, input.EventID, input.WordID, input.Mode, input.Answer, text, meaning, now.Unix())
	if err != nil {
		return err
	}
	if err = tx.Commit(); err != nil {
		return err
	}
	return ok(w)
}
