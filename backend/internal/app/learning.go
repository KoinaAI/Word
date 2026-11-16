package app

import (
	"context"
	"database/sql"
	"encoding/json"
	"errors"
	"math"
	"net/http"
	"strconv"
	"strings"
	"time"
)

const bookColumns = `SELECT b.id,b.title,b.subtitle,b.description,b.category,b.color,COUNT(w.id),COALESCE(SUM(CASE WHEN p.status='mastered' THEN 1 ELSE 0 END),0),COALESCE(SUM(CASE WHEN p.due_at<>'' AND p.due_at<=? THEN 1 ELSE 0 END),0),
COALESCE(SUM(CASE WHEN w.id IS NOT NULL AND COALESCE(p.status,'new')='new' THEN 1 ELSE 0 END),0),
COALESCE(SUM(CASE WHEN p.status='learning' OR (COALESCE(p.status,'new')='new' AND lp.stage=1) THEN 1 ELSE 0 END),0),
COALESCE(SUM(CASE WHEN p.reinforce=1 THEN 1 ELSE 0 END),0),
COALESCE(SUM(CASE WHEN w.id IS NOT NULL AND COALESCE(p.status,'new')<>'mastered' AND COALESCE(p.reinforce,0)=0 THEN 1 ELSE 0 END),0),
COALESCE(SUM(CASE WHEN w.id IS NOT NULL AND COALESCE(p.status,'new')='new' AND COALESCE(lp.stage,0)=0 THEN 1 ELSE 0 END),0)
FROM books b LEFT JOIN words w ON w.book_id=b.id LEFT JOIN progress p ON p.word_id=w.id AND p.user_id=? LEFT JOIN learn_progress lp ON lp.word_id=w.id AND lp.user_id=? `
const wordJoins = ` FROM words w LEFT JOIN progress p ON p.word_id=w.id AND p.user_id=? LEFT JOIN learn_progress lp ON lp.word_id=w.id AND lp.user_id=? `
const wordColumns = `SELECT w.id,w.book_id,w.text,w.phonetic,w.meaning,w.example,w.example_meaning,EXISTS(SELECT 1 FROM favorites f WHERE f.word_id=w.id AND f.user_id=?),COALESCE(p.status,'new'),COALESCE(p.reinforce,0),COALESCE(p.due_at,''),COALESCE(lp.stage,0),COALESCE(lp.revision,0),w.content_version,COALESCE((SELECT revision FROM favorite_revisions fr WHERE fr.user_id=? AND fr.word_id=w.id),0)` + wordJoins

type scanner interface{ Scan(...any) error }

func scanBook(s scanner) (Book, error) {
	b := Book{}
	e := s.Scan(&b.ID, &b.Title, &b.Subtitle, &b.Description, &b.Category, &b.Color, &b.WordCount, &b.LearnedCount, &b.DueCount, &b.NewCount, &b.LearningCount, &b.ReinforceCount, &b.SprintCount, &b.UnstartedCount)
	return b, e
}
func scanWord(s scanner) (Word, error) {
	w := Word{}
	e := s.Scan(&w.ID, &w.BookID, &w.Text, &w.Phonetic, &w.Meaning, &w.Example, &w.ExampleMeaning, &w.Favorite, &w.Status, &w.Reinforce, &w.DueAt, &w.LearnStage, &w.LearnRevision, &w.ContentVersion, &w.FavoriteRevision)
	return w, e
}
func currentID(r *http.Request) int64 {
	if u := userFrom(r); u != nil {
		return u.ID
	}
	return 0
}
func (a *App) readBook(ctx context.Context, id, userID int64) (Book, error) {
	return scanBook(a.db.QueryRowContext(ctx, bookColumns+"WHERE b.id=? GROUP BY b.id", stamp(time.Now()), userID, userID, id))
}
func (a *App) readWords(ctx context.Context, userID int64, where string, args ...any) ([]Word, error) {
	params := []any{userID, userID, userID, userID}
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
	rows, e := a.db.QueryContext(r.Context(), bookColumns+"WHERE (?='' OR b.title LIKE ? OR b.description LIKE ?) AND (?='' OR b.category=?) GROUP BY b.id ORDER BY b.id", stamp(time.Now()), currentID(r), currentID(r), query, "%"+query+"%", "%"+query+"%", category, category)
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

// pageBounds rejects malformed and excessive requests instead of silently truncating them.
func pageBounds(r *http.Request, defaultLimit int) (limit, offset int, ok bool) {
	limit, offset = defaultLimit, 0
	var err error
	if raw := r.URL.Query().Get("limit"); raw != "" {
		limit, err = strconv.Atoi(raw)
		if err != nil {
			return 0, 0, false
		}
	}
	if raw := r.URL.Query().Get("offset"); raw != "" {
		offset, err = strconv.Atoi(raw)
		if err != nil {
			return 0, 0, false
		}
	}
	return limit, offset, limit >= 1 && limit <= 200 && offset >= 0 && offset <= 10000000
}

func wordFilter(r *http.Request) (string, []any, bool) {
	query := strings.TrimSpace(r.URL.Query().Get("q"))
	if len(query) > 200 {
		return "", nil, false
	}
	where := ""
	args := []any{}
	if query != "" {
		where += " AND (w.text LIKE ? OR w.meaning LIKE ?)"
		args = append(args, "%"+query+"%", "%"+query+"%")
	}
	switch r.URL.Query().Get("status") {
	case "", "all":
	case "new":
		where += " AND COALESCE(p.status,'new')='new' AND COALESCE(lp.stage,0)=0"
	case "learning":
		where += " AND (p.status='learning' OR (COALESCE(p.status,'new')='new' AND lp.stage=1))"
	case "mastered":
		where += " AND p.status='mastered'"
	case "reinforce":
		where += " AND p.reinforce=1"
	default:
		return "", nil, false
	}
	return where, args, true
}

func (a *App) countWords(ctx context.Context, userID int64, where string, args ...any) (int, error) {
	params := append([]any{userID, userID}, args...)
	var total int
	err := a.db.QueryRowContext(ctx, "SELECT COUNT(*)"+wordJoins+where, params...).Scan(&total)
	return total, err
}

func (a *App) bookDetail(w http.ResponseWriter, r *http.Request) {
	id, ok := pathID(w, r)
	if !ok {
		return
	}
	limit, offset, ok := pageBounds(r, 50)
	filter, args, valid := wordFilter(r)
	if !ok || !valid {
		fail(w, 400, "分页或筛选参数无效")
		return
	}
	userID := currentID(r)
	book, e := a.readBook(r.Context(), id, userID)
	if errors.Is(e, sql.ErrNoRows) {
		fail(w, 404, "词书不存在")
		return
	}
	if e != nil {
		internal(w, e)
		return
	}
	where := "WHERE w.book_id=?" + filter
	params := append([]any{id}, args...)
	total, e := a.countWords(r.Context(), userID, where, params...)
	if e != nil {
		internal(w, e)
		return
	}
	params = append(params, limit, offset)
	words, e := a.readWords(r.Context(), userID, where+" ORDER BY w.id LIMIT ? OFFSET ?", params...)
	if e != nil {
		internal(w, e)
		return
	}
	writeJSON(w, 200, map[string]any{"book": book, "words": words, "total": total, "wordTotal": total, "offset": offset, "limit": limit, "hasMore": offset+len(words) < total})
}

// study returns a bounded round; non-learning modes use a stable word-ID cursor so
// unchanged unknown answers do not reappear while continuing the same pass.
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
	limit, _, ok := pageBounds(r, 100)
	var after int64
	if raw := r.URL.Query().Get("after"); raw != "" {
		after, e = strconv.ParseInt(raw, 10, 64)
		if e != nil || after < 0 {
			ok = false
		}
	}
	if !ok {
		fail(w, 400, "分页参数无效")
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
	where := "WHERE w.book_id=?"
	args := []any{id}
	order := " ORDER BY w.id"
	switch mode {
	case "learn":
		where += " AND COALESCE(p.status,'new')='new'"
		order = " ORDER BY CASE WHEN lp.stage=1 THEN 0 ELSE 1 END,w.id"
		limit = min(limit, u.DailyGoal)
	case "review":
		where += " AND p.due_at<>'' AND p.due_at<=?"
		args = append(args, stamp(time.Now()))
	case "sprint":
		where += " AND COALESCE(p.status,'new')<>'mastered' AND COALESCE(p.reinforce,0)=0"
	case "reinforce":
		where += " AND p.reinforce=1"
	}
	if mode != "learn" && after > 0 {
		where += " AND w.id>?"
		args = append(args, after)
	}
	total, e := a.countWords(r.Context(), u.ID, where, args...)
	if e != nil {
		internal(w, e)
		return
	}
	words, e := a.readWords(r.Context(), u.ID, where+order+" LIMIT ?", append(args, limit)...)
	if e != nil {
		internal(w, e)
		return
	}
	vocabulary := []Word{}
	if mode != "sprint" {
		vocabulary, e = a.quizVocabulary(r.Context(), id, words)
		if e != nil {
			internal(w, e)
			return
		}
	}
	nextAfter := after
	for _, word := range words {
		if word.ID > nextAfter {
			nextAfter = word.ID
		}
	}
	writeJSON(w, 200, map[string]any{"book": book, "words": words, "vocabulary": vocabulary, "total": total, "hasMore": len(words) < total, "nextAfter": nextAfter})
}

// quizVocabulary transmits only the fields needed to generate choices, with a
// fixed cap independent of the full wordbook and its example-text volume.
func (a *App) quizVocabulary(ctx context.Context, bookID int64, targets []Word) ([]Word, error) {
	pool := make([]Word, 0, 200)
	seen := map[int64]bool{}
	for _, word := range targets {
		if len(pool) == 200 {
			break
		}
		seen[word.ID] = true
		pool = append(pool, Word{ID: word.ID, BookID: word.BookID, Text: word.Text, Meaning: word.Meaning, ContentVersion: word.ContentVersion, Favorite: word.Favorite, FavoriteRevision: word.FavoriteRevision})
	}
	rows, e := a.db.QueryContext(ctx, "SELECT id,book_id,text,meaning,content_version FROM words WHERE book_id=? ORDER BY id LIMIT 200", bookID)
	if e != nil {
		return nil, e
	}
	defer rows.Close()
	for rows.Next() {
		var word Word
		if e = rows.Scan(&word.ID, &word.BookID, &word.Text, &word.Meaning, &word.ContentVersion); e != nil {
			return nil, e
		}
		if !seen[word.ID] && len(pool) < 200 {
			pool = append(pool, word)
			seen[word.ID] = true
		}
	}
	return pool, rows.Err()
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
		WordID         int64  `json:"wordId"`
		Mode           string `json:"mode"`
		Answer         string `json:"answer"`
		EventID        string `json:"eventId"`
		LearnStage     *int   `json:"learnStage"`
		LearnRevision  *int64 `json:"learnRevision"`
		ContentVersion *int64 `json:"contentVersion"`
	}
	if !decode(w, r, &req) {
		return
	}
	if (req.ContentVersion != nil && *req.ContentVersion < 1) || req.WordID < 1 || !validMode(req.Mode) || !validAnswer(req.Answer) || len(req.EventID) < 8 || len(req.EventID) > 128 || strings.TrimSpace(req.EventID) != req.EventID {
		fail(w, 400, "学习记录参数无效")
		return
	}
	if req.Mode != "sprint" && strings.HasPrefix(req.Answer, "unsure-") {
		fail(w, 400, "该模式不支持不确定评分")
		return
	}
	if req.Mode == "learn" {
		if req.LearnStage == nil || req.LearnRevision == nil || *req.LearnStage < 0 || *req.LearnStage > 1 || *req.LearnRevision < 0 || *req.LearnRevision >= 9007199254740991 {
			fail(w, 400, "新词练习需要有效的阶段进度，请刷新学习页面")
			return
		}
	} else if req.LearnStage != nil || req.LearnRevision != nil {
		fail(w, 400, "只有新词练习支持阶段进度")
		return
	}
	u := userFrom(r)
	tx, e := a.db.BeginTx(r.Context(), nil)
	if e != nil {
		internal(w, e)
		return
	}
	defer tx.Rollback()
	var previousID, previousWord int64
	var previousMode, previousAnswer string
	var previousUndone bool
	e = tx.QueryRow("SELECT id,submitted_word_id,mode,answer,undone FROM answers WHERE user_id=? AND event_id=?", u.ID, req.EventID).Scan(&previousID, &previousWord, &previousMode, &previousAnswer, &previousUndone)
	if e == nil {
		if previousUndone {
			fail(w, 409, "这次评分已撤销，请重新作答")
			return
		}
		if previousWord != req.WordID || previousMode != req.Mode || previousAnswer != req.Answer {
			fail(w, 409, "记录编号已用于其他评分")
			return
		}
		if req.Mode == "learn" {
			var stage, resultStage int
			var revision, resultRevision int64
			e = tx.QueryRow("SELECT request_stage,request_revision,result_stage,result_revision FROM learn_answer_steps WHERE answer_id=?", previousID).Scan(&stage, &revision, &resultStage, &resultRevision)
			if errors.Is(e, sql.ErrNoRows) || (e == nil && (stage != *req.LearnStage || revision != *req.LearnRevision)) {
				fail(w, 409, "记录编号已用于其他阶段，请刷新学习页面")
				return
			}
			if e != nil {
				internal(w, e)
				return
			}
			writeLearnResult(w, resultStage, resultRevision)
		} else {
			writeJSON(w, 200, map[string]bool{"ok": true})
		}
		return
	} else if !errors.Is(e, sql.ErrNoRows) {
		internal(w, e)
		return
	}
	var text, meaning string
	var contentVersion int64
	e = tx.QueryRow("SELECT text,meaning,content_version FROM words WHERE id=?", req.WordID).Scan(&text, &meaning, &contentVersion)
	if errors.Is(e, sql.ErrNoRows) {
		fail(w, 404, "单词不存在")
		return
	}
	if e != nil {
		internal(w, e)
		return
	}
	if req.ContentVersion != nil && *req.ContentVersion != contentVersion {
		fail(w, 409, "单词内容已更新，请刷新当前题目")
		return
	}
	old := memoryState{}
	var oldUpdatedAt string
	e = tx.QueryRow("SELECT status,reinforce,due_at,repetitions,interval_days,ease,updated_at FROM progress WHERE user_id=? AND word_id=?", u.ID, req.WordID).Scan(&old.status, &old.reinforce, &old.due, &old.repetitions, &old.interval, &old.ease, &oldUpdatedAt)
	if e != nil && !errors.Is(e, sql.ErrNoRows) {
		internal(w, e)
		return
	}
	progressExisted := e == nil
	var priorStage stageSnapshot
	if req.Mode == "sprint" {
		e = tx.QueryRow("SELECT stage,revision,updated_at FROM learn_progress WHERE user_id=? AND word_id=?", u.ID, req.WordID).Scan(&priorStage.Stage, &priorStage.Revision, &priorStage.UpdatedAt)
		if e != nil && !errors.Is(e, sql.ErrNoRows) {
			internal(w, e)
			return
		}
		priorStage.Exists = e == nil
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
	var resultStage int
	var resultRevision int64
	next, change := old, false
	if req.Mode == "learn" {
		var stage int
		var revision int64
		e = tx.QueryRow("SELECT stage,revision FROM learn_progress WHERE user_id=? AND word_id=?", u.ID, req.WordID).Scan(&stage, &revision)
		if e != nil && !errors.Is(e, sql.ErrNoRows) {
			internal(w, e)
			return
		}
		if stage != *req.LearnStage || revision != *req.LearnRevision {
			fail(w, 409, "这个单词的练习进度已更新，请刷新学习队列")
			return
		}
		resultRevision = revision + 1
		if req.Answer == "known" {
			resultStage = stage + 1
		}
		if _, e = tx.Exec(`INSERT INTO learn_progress(user_id,word_id,stage,revision,updated_at) VALUES(?,?,?,?,?) ON CONFLICT(user_id,word_id) DO UPDATE SET stage=excluded.stage,revision=excluded.revision,updated_at=excluded.updated_at`, u.ID, req.WordID, resultStage, resultRevision, stamp(now)); e != nil {
			internal(w, e)
			return
		}
		// A wrong answer restarts this word; only completing both directions schedules review.
		if resultStage == 2 {
			next, change = nextMemory(old, req.Mode, "known", now)
		}
	} else {
		next, change = nextMemory(old, req.Mode, req.Answer, now)
	}
	if change {
		_, e = tx.Exec(`INSERT INTO progress(user_id,word_id,status,reinforce,due_at,repetitions,interval_days,ease,updated_at) VALUES(?,?,?,?,?,?,?,?,?) ON CONFLICT(user_id,word_id) DO UPDATE SET status=excluded.status,reinforce=excluded.reinforce,due_at=excluded.due_at,repetitions=excluded.repetitions,interval_days=excluded.interval_days,ease=excluded.ease,updated_at=excluded.updated_at`, u.ID, req.WordID, next.status, next.reinforce, next.due, next.repetitions, next.interval, next.ease, stamp(now))
		if e != nil {
			internal(w, e)
			return
		}
		if req.Mode != "learn" {
			// Keep revision monotonic when another mode moves a word out of and back into new learning.
			if _, e = tx.Exec(`INSERT INTO learn_progress(user_id,word_id,stage,revision,updated_at) VALUES(?,?,0,1,?) ON CONFLICT(user_id,word_id) DO UPDATE SET stage=0,revision=learn_progress.revision+1,updated_at=excluded.updated_at`, u.ID, req.WordID, stamp(now)); e != nil {
				internal(w, e)
				return
			}
		}
	}
	result, e := tx.Exec("INSERT INTO answers(user_id,word_id,submitted_word_id,word_text,word_meaning,mode,answer,event_id,created_at) VALUES(?,?,?,?,?,?,?,?,?)", u.ID, req.WordID, req.WordID, text, meaning, req.Mode, req.Answer, req.EventID, stamp(now))
	if e != nil {
		internal(w, e)
		return
	}
	if req.Mode == "sprint" {
		answerID, err := result.LastInsertId()
		if err != nil {
			internal(w, err)
			return
		}
		var revision int64
		err = tx.QueryRow("SELECT COALESCE((SELECT revision FROM learn_progress WHERE user_id=? AND word_id=?),0)", u.ID, req.WordID).Scan(&revision)
		if err != nil {
			internal(w, err)
			return
		}
		before, _ := json.Marshal(progressSnapshot{Exists: progressExisted, Status: old.status, Reinforce: old.reinforce, Due: old.due, Repetitions: old.repetitions, Interval: old.interval, Ease: old.ease, UpdatedAt: oldUpdatedAt, ContentVersion: contentVersion})
		stage, _ := json.Marshal(priorStage)
		if _, err = tx.Exec("INSERT INTO sprint_undo(answer_id,previous_progress,previous_stage,result_revision) VALUES(?,?,?,?)", answerID, string(before), string(stage), revision); err != nil {
			internal(w, err)
			return
		}
	}
	if req.Mode == "learn" {
		answerID, e := result.LastInsertId()
		if e == nil {
			_, e = tx.Exec("INSERT INTO learn_answer_steps(answer_id,request_stage,request_revision,result_stage,result_revision) VALUES(?,?,?,?,?)", answerID, *req.LearnStage, *req.LearnRevision, resultStage, resultRevision)
		}
		if e != nil {
			internal(w, e)
			return
		}
	}
	if e = tx.Commit(); e != nil {
		internal(w, e)
		return
	}
	if req.Mode == "learn" {
		writeLearnResult(w, resultStage, resultRevision)
	} else {
		writeJSON(w, 200, map[string]bool{"ok": true})
	}
}

func writeLearnResult(w http.ResponseWriter, stage int, revision int64) {
	writeJSON(w, 200, map[string]any{"ok": true, "learnStage": stage, "learnRevision": revision, "completed": stage == 2})
}
func (a *App) favorites(w http.ResponseWriter, r *http.Request) {
	limit, offset, ok := pageBounds(r, 50)
	query := strings.TrimSpace(r.URL.Query().Get("q"))
	if !ok || len(query) > 200 {
		fail(w, 400, "分页或搜索参数无效")
		return
	}
	userID := currentID(r)
	// Drive from the user's indexed favorites, never from the entire vocabulary.
	from := ` FROM favorites selected JOIN words w ON w.id=selected.word_id LEFT JOIN progress p ON p.word_id=w.id AND p.user_id=? LEFT JOIN learn_progress lp ON lp.word_id=w.id AND lp.user_id=? WHERE selected.user_id=?`
	args := []any{userID, userID, userID}
	if query != "" {
		from += " AND (w.text LIKE ? OR w.meaning LIKE ?)"
		args = append(args, "%"+query+"%", "%"+query+"%")
	}
	var total int
	if e := a.db.QueryRowContext(r.Context(), "SELECT COUNT(*)"+from, args...).Scan(&total); e != nil {
		internal(w, e)
		return
	}
	selectCols := `SELECT w.id,w.book_id,w.text,w.phonetic,w.meaning,w.example,w.example_meaning,1,COALESCE(p.status,'new'),COALESCE(p.reinforce,0),COALESCE(p.due_at,''),COALESCE(lp.stage,0),COALESCE(lp.revision,0),w.content_version,COALESCE((SELECT revision FROM favorite_revisions fr WHERE fr.user_id=selected.user_id AND fr.word_id=w.id),0)`
	rows, e := a.db.QueryContext(r.Context(), selectCols+from+" ORDER BY w.id LIMIT ? OFFSET ?", append(args, limit, offset)...)
	if e != nil {
		internal(w, e)
		return
	}
	defer rows.Close()
	words := []Word{}
	for rows.Next() {
		word, e := scanWord(rows)
		if e != nil {
			internal(w, e)
			return
		}
		words = append(words, word)
	}
	if e = rows.Err(); e != nil {
		internal(w, e)
		return
	}
	if r.URL.Query().Get("paged") == "1" {
		writeJSON(w, 200, map[string]any{"items": words, "total": total, "offset": offset, "limit": limit, "hasMore": offset+len(words) < total})
	} else {
		writeJSON(w, 200, words)
	}
}

// favoriteState reads the saved bit and its durable revision in the same snapshot.
// Revisions remain present after removals so stale writes cannot recreate a word.
func (a *App) favoriteState(w http.ResponseWriter, r *http.Request) {
	id, ok := pathID(w, r)
	if !ok {
		return
	}
	var favorite bool
	var revision int64
	e := a.db.QueryRowContext(r.Context(), `SELECT EXISTS(SELECT 1 FROM favorites f WHERE f.user_id=? AND f.word_id=w.id),COALESCE((SELECT revision FROM favorite_revisions fr WHERE fr.user_id=? AND fr.word_id=w.id),0) FROM words w WHERE w.id=?`, currentID(r), currentID(r), id).Scan(&favorite, &revision)
	if errors.Is(e, sql.ErrNoRows) {
		fail(w, 404, "单词不存在")
		return
	}
	if e != nil {
		internal(w, e)
		return
	}
	writeJSON(w, 200, map[string]any{"wordId": id, "favorite": favorite, "revision": revision})
}

// favorite applies a compare-and-swap when expectedRevision is supplied. Even a
// no-op advances the fence: a later "remove" must invalidate an older pending
// "add" when both originally observed an absent favorite.
func (a *App) favorite(w http.ResponseWriter, r *http.Request) {
	id, ok := pathID(w, r)
	if !ok {
		return
	}
	var req struct {
		Favorite         *bool  `json:"favorite"`
		ExpectedRevision *int64 `json:"expectedRevision"`
	}
	if !decode(w, r, &req) {
		return
	}
	if req.Favorite == nil || (req.ExpectedRevision != nil && (*req.ExpectedRevision < 0 || *req.ExpectedRevision >= 9007199254740991)) {
		fail(w, 400, "favorite 和收藏版本参数无效")
		return
	}
	tx, e := a.db.BeginTx(r.Context(), nil)
	if e != nil {
		internal(w, e)
		return
	}
	defer tx.Rollback()
	userID := currentID(r)
	var favorite bool
	var revision int64
	e = tx.QueryRowContext(r.Context(), `SELECT EXISTS(SELECT 1 FROM favorites f WHERE f.user_id=? AND f.word_id=w.id),COALESCE((SELECT revision FROM favorite_revisions fr WHERE fr.user_id=? AND fr.word_id=w.id),0) FROM words w WHERE w.id=?`, userID, userID, id).Scan(&favorite, &revision)
	if errors.Is(e, sql.ErrNoRows) {
		fail(w, 404, "单词不存在")
		return
	}
	if e != nil {
		internal(w, e)
		return
	}
	if req.ExpectedRevision != nil && *req.ExpectedRevision != revision {
		writeJSON(w, 409, map[string]any{"error": "收藏状态已更新，请重新确认", "favorite": favorite, "revision": revision})
		return
	}
	next := revision + 1
	if _, e = tx.ExecContext(r.Context(), "INSERT INTO favorite_revisions(user_id,word_id,revision) VALUES(?,?,?) ON CONFLICT(user_id,word_id) DO UPDATE SET revision=excluded.revision", userID, id, next); e != nil {
		internal(w, e)
		return
	}
	if *req.Favorite {
		_, e = tx.ExecContext(r.Context(), "INSERT OR IGNORE INTO favorites(user_id,word_id) VALUES(?,?)", userID, id)
	} else {
		_, e = tx.ExecContext(r.Context(), "DELETE FROM favorites WHERE user_id=? AND word_id=?", userID, id)
	}
	if e != nil {
		internal(w, e)
		return
	}
	if e = tx.Commit(); e != nil {
		internal(w, e)
		return
	}
	writeJSON(w, 200, map[string]any{"ok": true, "favorite": *req.Favorite, "revision": next})
}

// Snapshots retain absence as well as values: undoing a first-ever sprint must
// restore a genuinely unstarted word rather than manufacture progress history.
type progressSnapshot struct {
	Exists         bool
	Status         string
	Reinforce      bool
	Due            string
	Repetitions    int
	Interval, Ease float64
	UpdatedAt      string
	ContentVersion int64
}
type stageSnapshot struct {
	Exists    bool
	Stage     int
	Revision  int64
	UpdatedAt string
}

// undoAnswer reverses only the caller's latest sprint event for this word within
// two minutes. A revision check prevents undo from replacing subsequent practice.
// The answer stays in history with an undone marker so retries remain identifiable.
func (a *App) undoAnswer(w http.ResponseWriter, r *http.Request) {
	var req struct {
		EventID string `json:"eventId"`
	}
	if !decode(w, r, &req) {
		return
	}
	if len(req.EventID) < 8 || len(req.EventID) > 128 || strings.TrimSpace(req.EventID) != req.EventID {
		fail(w, 400, "撤销记录编号无效")
		return
	}
	u := userFrom(r)
	tx, e := a.db.BeginTx(r.Context(), nil)
	if e != nil {
		internal(w, e)
		return
	}
	defer tx.Rollback()
	var answerID, wordID, revision int64
	var mode, created, progressJSON, stageJSON string
	var undone bool
	e = tx.QueryRow(`SELECT a.id,a.submitted_word_id,a.mode,a.created_at,a.undone,s.previous_progress,s.previous_stage,s.result_revision
 FROM answers a JOIN sprint_undo s ON s.answer_id=a.id WHERE a.user_id=? AND a.event_id=?`, u.ID, req.EventID).Scan(&answerID, &wordID, &mode, &created, &undone, &progressJSON, &stageJSON, &revision)
	if errors.Is(e, sql.ErrNoRows) {
		fail(w, 404, "没有找到可以撤销的评分")
		return
	}
	if e != nil {
		internal(w, e)
		return
	}
	if undone {
		writeJSON(w, 200, map[string]bool{"ok": true})
		return
	}
	at, e := time.Parse("2006-01-02T15:04:05.000Z", created)
	if e != nil || mode != "sprint" || time.Since(at) > 2*time.Minute || time.Since(at) < -time.Second {
		fail(w, 409, "已超过撤销时间，请在复习中重新判断")
		return
	}
	var latest, currentRevision, currentContent int64
	if e = tx.QueryRow("SELECT MAX(id) FROM answers WHERE user_id=? AND submitted_word_id=?", u.ID, wordID).Scan(&latest); e != nil {
		internal(w, e)
		return
	}
	if e = tx.QueryRow("SELECT COALESCE((SELECT revision FROM learn_progress WHERE user_id=? AND word_id=?),0)", u.ID, wordID).Scan(&currentRevision); e != nil {
		internal(w, e)
		return
	}
	var before progressSnapshot
	var stage stageSnapshot
	if json.Unmarshal([]byte(progressJSON), &before) != nil || json.Unmarshal([]byte(stageJSON), &stage) != nil {
		fail(w, 500, "撤销记录损坏")
		return
	}
	e = tx.QueryRow("SELECT content_version FROM words WHERE id=?", wordID).Scan(&currentContent)
	if errors.Is(e, sql.ErrNoRows) {
		fail(w, 409, "单词已删除，无法撤销")
		return
	}
	if e != nil {
		internal(w, e)
		return
	}
	if latest != answerID || currentRevision != revision || currentContent != before.ContentVersion {
		fail(w, 409, "该单词已有后续练习或内容更新，无法撤销旧评分")
		return
	}
	if before.Exists {
		_, e = tx.Exec(`INSERT INTO progress(user_id,word_id,status,reinforce,due_at,repetitions,interval_days,ease,updated_at) VALUES(?,?,?,?,?,?,?,?,?) ON CONFLICT(user_id,word_id) DO UPDATE SET status=excluded.status,reinforce=excluded.reinforce,due_at=excluded.due_at,repetitions=excluded.repetitions,interval_days=excluded.interval_days,ease=excluded.ease,updated_at=excluded.updated_at`, u.ID, wordID, before.Status, before.Reinforce, before.Due, before.Repetitions, before.Interval, before.Ease, before.UpdatedAt)
	} else {
		_, e = tx.Exec("DELETE FROM progress WHERE user_id=? AND word_id=?", u.ID, wordID)
	}
	if e != nil {
		internal(w, e)
		return
	}
	// Never roll the revision backward; any page predating this correction is stale.
	_, e = tx.Exec(`INSERT INTO learn_progress(user_id,word_id,stage,revision,updated_at) VALUES(?,?,?,?,?) ON CONFLICT(user_id,word_id) DO UPDATE SET stage=excluded.stage,revision=excluded.revision,updated_at=excluded.updated_at`, u.ID, wordID, stage.Stage, currentRevision+1, stamp(time.Now()))
	if e != nil {
		internal(w, e)
		return
	}
	if _, e = tx.Exec("UPDATE answers SET undone=1 WHERE id=?", answerID); e != nil {
		internal(w, e)
		return
	}
	if _, e = tx.Exec("UPDATE sprint_undo SET undone=1 WHERE answer_id=?", answerID); e != nil {
		internal(w, e)
		return
	}
	if e = tx.Commit(); e != nil {
		internal(w, e)
		return
	}
	writeJSON(w, 200, map[string]bool{"ok": true})
}
