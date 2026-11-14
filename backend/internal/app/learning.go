package app

import (
	"context"
	"database/sql"
	"errors"
	"math"
	"net/http"
	"strconv"
	"strings"
	"time"
)

const bookColumns = `SELECT b.id,b.title,b.subtitle,b.description,b.category,b.color,COUNT(w.id),COALESCE(SUM(CASE WHEN p.status='mastered' THEN 1 ELSE 0 END),0),COALESCE(SUM(CASE WHEN p.due_at<>'' AND p.due_at<=? THEN 1 ELSE 0 END),0) FROM books b LEFT JOIN words w ON w.book_id=b.id LEFT JOIN progress p ON p.word_id=w.id AND p.user_id=? `
const wordColumns = `SELECT w.id,w.book_id,w.text,w.phonetic,w.meaning,w.example,w.example_meaning,EXISTS(SELECT 1 FROM favorites f WHERE f.word_id=w.id AND f.user_id=?),COALESCE(p.status,'new'),COALESCE(p.reinforce,0),COALESCE(p.due_at,'') FROM words w LEFT JOIN progress p ON p.word_id=w.id AND p.user_id=? `

type scanner interface{ Scan(...any) error }

func scanBook(s scanner) (Book, error) {
	b := Book{}
	e := s.Scan(&b.ID, &b.Title, &b.Subtitle, &b.Description, &b.Category, &b.Color, &b.WordCount, &b.LearnedCount, &b.DueCount)
	return b, e
}
func scanWord(s scanner) (Word, error) {
	w := Word{}
	e := s.Scan(&w.ID, &w.BookID, &w.Text, &w.Phonetic, &w.Meaning, &w.Example, &w.ExampleMeaning, &w.Favorite, &w.Status, &w.Reinforce, &w.DueAt)
	return w, e
}
func currentID(r *http.Request) int64 {
	if u := userFrom(r); u != nil {
		return u.ID
	}
	return 0
}
func (a *App) readBook(ctx context.Context, id, userID int64) (Book, error) {
	return scanBook(a.db.QueryRowContext(ctx, bookColumns+"WHERE b.id=? GROUP BY b.id", stamp(time.Now()), userID, id))
}
func (a *App) readWords(ctx context.Context, userID int64, where string, args ...any) ([]Word, error) {
	params := []any{userID, userID}
	params = append(params, args...)
	rows, e := a.db.QueryContext(ctx, wordColumns+where, params...)
	if e != nil {
		return nil, e
	}
	defer rows.Close()
	result := []Word{}
	for rows.Next() {
		w, e := scanWord(rows)
		if e != nil {
			return nil, e
		}
		result = append(result, w)
	}
	return result, rows.Err()
}
func (a *App) books(w http.ResponseWriter, r *http.Request) {
	query := strings.TrimSpace(r.URL.Query().Get("q"))
	category := strings.TrimSpace(r.URL.Query().Get("category"))
	if len(query) > 200 || len(category) > 80 {
		fail(w, 400, "搜索条件过长")
		return
	}
	rows, e := a.db.QueryContext(r.Context(), bookColumns+"WHERE (?='' OR b.title LIKE ? OR b.description LIKE ?) AND (?='' OR b.category=?) GROUP BY b.id ORDER BY b.id", stamp(time.Now()), currentID(r), query, "%"+query+"%", "%"+query+"%", category, category)
	if e != nil {
		internal(w, e)
		return
	}
	defer rows.Close()
	books := []Book{}
	for rows.Next() {
		b, e := scanBook(rows)
		if e != nil {
			internal(w, e)
			return
		}
		books = append(books, b)
	}
	if e = rows.Err(); e != nil {
		internal(w, e)
		return
	}
	writeJSON(w, 200, books)
}
func (a *App) bookDetail(w http.ResponseWriter, r *http.Request) {
	id, ok := pathID(w, r)
	if !ok {
		return
	}
	book, e := a.readBook(r.Context(), id, currentID(r))
	if errors.Is(e, sql.ErrNoRows) {
		fail(w, 404, "词书不存在")
		return
	}
	if e != nil {
		internal(w, e)
		return
	}
	words, e := a.readWords(r.Context(), currentID(r), "WHERE w.book_id=? ORDER BY w.id", id)
	if e != nil {
		internal(w, e)
		return
	}
	writeJSON(w, 200, map[string]any{"book": book, "words": words})
}
func (a *App) study(w http.ResponseWriter, r *http.Request) {
	id, e := strconv.ParseInt(r.URL.Query().Get("bookId"), 10, 64)
	if e != nil || id < 1 {
		fail(w, 400, "请选择词书")
		return
	}
	mode := r.URL.Query().Get("mode")
	if !validMode(mode) {
		fail(w, 400, "学习模式无效")
		return
	}
	u := userFrom(r)
	book, e := a.readBook(r.Context(), id, u.ID)
	if errors.Is(e, sql.ErrNoRows) {
		fail(w, 404, "词书不存在")
		return
	}
	if e != nil {
		internal(w, e)
		return
	}
	where := "WHERE w.book_id=? "
	args := []any{id}
	switch mode {
	case "learn":
		where += "AND COALESCE(p.status,'new')='new' ORDER BY w.id LIMIT ?"
		args = append(args, u.DailyGoal)
	case "review":
		where += "AND p.due_at<>'' AND p.due_at<=? ORDER BY p.due_at,w.id"
		args = append(args, stamp(time.Now()))
	case "sprint":
		where += "AND COALESCE(p.status,'new')<>'mastered' AND COALESCE(p.reinforce,0)=0 ORDER BY w.id"
	case "reinforce":
		where += "AND p.reinforce=1 ORDER BY p.updated_at,w.id"
	}
	words, e := a.readWords(r.Context(), u.ID, where, args...)
	if e != nil {
		internal(w, e)
		return
	}
	writeJSON(w, 200, map[string]any{"book": book, "words": words, "total": len(words)})
}
func validMode(s string) bool {
	return s == "learn" || s == "review" || s == "sprint" || s == "reinforce"
}
func validAnswer(s string) bool {
	return s == "known" || s == "unknown" || s == "unsure-known" || s == "unsure-unknown"
}

type memoryState struct {
	status         string
	reinforce      bool
	due            string
	repetitions    int
	interval, ease float64
}

// nextMemory keeps sprint triage separate from recall ratings. A failed sprint never
// downgrades learned progress, while a revealed success enters a dedicated queue.
func nextMemory(old memoryState, mode, answer string, now time.Time) (memoryState, bool) {
	if old.status == "" {
		old.status = "new"
	}
	if old.ease == 0 {
		old.ease = 2.5
	}
	if mode == "sprint" && (answer == "unknown" || answer == "unsure-unknown") {
		return old, false
	}
	next := old
	if answer == "unknown" || answer == "unsure-unknown" {
		if mode == "reinforce" {
			next.reinforce = false
			next.status = "new"
			next.due = ""
			next.repetitions = 0
			next.interval = 0
			return next, true
		}
		next.status = "learning"
		next.repetitions = 0
		next.interval = 0
		next.ease = math.Max(1.3, next.ease-.2)
		next.due = stamp(now.Add(10 * time.Minute))
		return next, true
	}
	if answer == "unsure-known" {
		next.status = "learning"
		next.reinforce = true
		next.due = stamp(now.Add(24 * time.Hour))
		next.repetitions = 0
		next.interval = 1
		return next, true
	}
	next.status = "mastered"
	next.reinforce = false
	switch old.repetitions {
	case 0:
		next.interval = 1
	case 1:
		next.interval = 3
	case 2:
		next.interval = 7
	default:
		next.interval = math.Min(365, math.Round(math.Max(1, old.interval)*old.ease))
	}
	next.repetitions++
	next.due = stamp(now.Add(time.Duration(next.interval*24) * time.Hour))
	return next, true
}
func (a *App) answer(w http.ResponseWriter, r *http.Request) {
	var req struct {
		WordID  int64  `json:"wordId"`
		Mode    string `json:"mode"`
		Answer  string `json:"answer"`
		EventID string `json:"eventId"`
	}
	if !decode(w, r, &req) {
		return
	}
	if req.WordID < 1 || !validMode(req.Mode) || !validAnswer(req.Answer) || len(req.EventID) < 8 || len(req.EventID) > 128 || strings.TrimSpace(req.EventID) != req.EventID {
		fail(w, 400, "学习记录参数无效")
		return
	}
	if req.Mode != "sprint" && strings.HasPrefix(req.Answer, "unsure-") {
		fail(w, 400, "该模式不支持不确定评分")
		return
	}
	u := userFrom(r)
	tx, e := a.db.BeginTx(r.Context(), nil)
	if e != nil {
		internal(w, e)
		return
	}
	defer tx.Rollback()
	var previousWord int64
	var previousMode, previousAnswer string
	e = tx.QueryRow("SELECT submitted_word_id,mode,answer FROM answers WHERE user_id=? AND event_id=?", u.ID, req.EventID).Scan(&previousWord, &previousMode, &previousAnswer)
	if e == nil {
		if previousWord != req.WordID || previousMode != req.Mode || previousAnswer != req.Answer {
			fail(w, 409, "记录编号已用于其他评分")
			return
		}
		writeJSON(w, 200, map[string]bool{"ok": true})
		return
	} else if !errors.Is(e, sql.ErrNoRows) {
		internal(w, e)
		return
	}
	var text, meaning string
	e = tx.QueryRow("SELECT text,meaning FROM words WHERE id=?", req.WordID).Scan(&text, &meaning)
	if errors.Is(e, sql.ErrNoRows) {
		fail(w, 404, "单词不存在")
		return
	}
	if e != nil {
		internal(w, e)
		return
	}
	old := memoryState{}
	e = tx.QueryRow("SELECT status,reinforce,due_at,repetitions,interval_days,ease FROM progress WHERE user_id=? AND word_id=?", u.ID, req.WordID).Scan(&old.status, &old.reinforce, &old.due, &old.repetitions, &old.interval, &old.ease)
	if e != nil && !errors.Is(e, sql.ErrNoRows) {
		internal(w, e)
		return
	}
	if req.Mode == "sprint" && (req.Answer == "known" || req.Answer == "unsure-known") && (old.status == "mastered" || old.reinforce) {
		fail(w, 409, "该单词已完成速刷，请刷新当前队列")
		return
	}
	if req.Mode == "learn" && old.status != "" && old.status != "new" {
		fail(w, 409, "该单词已进入复习或巩固队列")
		return
	}
	if req.Mode == "reinforce" && !old.reinforce {
		fail(w, 409, "该单词已不在巩固列表中")
		return
	}
	if req.Mode == "review" && (old.due == "" || old.due > stamp(time.Now())) {
		fail(w, 409, "该单词尚未到复习时间")
		return
	}
	now := time.Now()
	next, change := nextMemory(old, req.Mode, req.Answer, now)
	if change {
		_, e = tx.Exec(`INSERT INTO progress(user_id,word_id,status,reinforce,due_at,repetitions,interval_days,ease,updated_at) VALUES(?,?,?,?,?,?,?,?,?) ON CONFLICT(user_id,word_id) DO UPDATE SET status=excluded.status,reinforce=excluded.reinforce,due_at=excluded.due_at,repetitions=excluded.repetitions,interval_days=excluded.interval_days,ease=excluded.ease,updated_at=excluded.updated_at`, u.ID, req.WordID, next.status, next.reinforce, next.due, next.repetitions, next.interval, next.ease, stamp(now))
		if e != nil {
			internal(w, e)
			return
		}
	}
	if _, e = tx.Exec("INSERT INTO answers(user_id,word_id,submitted_word_id,word_text,word_meaning,mode,answer,event_id,created_at) VALUES(?,?,?,?,?,?,?,?,?)", u.ID, req.WordID, req.WordID, text, meaning, req.Mode, req.Answer, req.EventID, stamp(now)); e != nil {
		internal(w, e)
		return
	}
	if e = tx.Commit(); e != nil {
		internal(w, e)
		return
	}
	writeJSON(w, 200, map[string]bool{"ok": true})
}
func (a *App) favorites(w http.ResponseWriter, r *http.Request) {
	words, e := a.readWords(r.Context(), currentID(r), "WHERE EXISTS(SELECT 1 FROM favorites f WHERE f.word_id=w.id AND f.user_id=?) ORDER BY w.id", currentID(r))
	if e != nil {
		internal(w, e)
		return
	}
	writeJSON(w, 200, words)
}
func (a *App) favorite(w http.ResponseWriter, r *http.Request) {
	id, ok := pathID(w, r)
	if !ok {
		return
	}
	var req struct {
		Favorite *bool `json:"favorite"`
	}
	if !decode(w, r, &req) {
		return
	}
	if req.Favorite == nil {
		fail(w, 400, "favorite 字段必填")
		return
	}
	var exists int
	e := a.db.QueryRowContext(r.Context(), "SELECT 1 FROM words WHERE id=?", id).Scan(&exists)
	if errors.Is(e, sql.ErrNoRows) {
		fail(w, 404, "单词不存在")
		return
	}
	if e != nil {
		internal(w, e)
		return
	}
	if *req.Favorite {
		_, e = a.db.ExecContext(r.Context(), "INSERT OR IGNORE INTO favorites(user_id,word_id) VALUES(?,?)", currentID(r), id)
	} else {
		_, e = a.db.ExecContext(r.Context(), "DELETE FROM favorites WHERE user_id=? AND word_id=?", currentID(r), id)
	}
	if e != nil {
		internal(w, e)
		return
	}
	writeJSON(w, 200, map[string]bool{"ok": true})
}
