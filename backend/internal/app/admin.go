package app

import (
	"context"
	"database/sql"
	"errors"
	"net/http"
	"regexp"
	"sort"
	"strings"
	"time"
	"unicode"
	"unicode/utf8"
)

var bookColorPattern = regexp.MustCompile(`^#[0-9a-fA-F]{6}$`)

type bookInput struct {
	Title       string `json:"title"`
	Subtitle    string `json:"subtitle"`
	Description string `json:"description"`
	Category    string `json:"category"`
	Color       string `json:"color"`
}

func validText(value string, max int) bool {
	return utf8.ValidString(value) && utf8.RuneCountInString(value) <= max && strings.IndexFunc(value, func(r rune) bool { return unicode.IsControl(r) && r != '\n' && r != '\r' && r != '\t' }) < 0
}

func normalizeBook(b *bookInput) bool {
	b.Title = strings.TrimSpace(b.Title)
	b.Subtitle = strings.TrimSpace(b.Subtitle)
	b.Description = strings.TrimSpace(b.Description)
	b.Category = strings.TrimSpace(b.Category)
	b.Color = strings.ToLower(strings.TrimSpace(b.Color))
	if b.Color == "" {
		b.Color = "#397d67"
	}
	return b.Title != "" && validText(b.Title, 120) && validText(b.Subtitle, 200) && validText(b.Description, 2000) && validText(b.Category, 40) && bookColorPattern.MatchString(b.Color)
}

func (a *App) adminBooks(w http.ResponseWriter, r *http.Request) {
	userID := userFrom(r).ID
	rows, err := a.db.QueryContext(r.Context(), `SELECT b.id,b.title,b.subtitle,b.description,b.category,b.color,
 (SELECT COUNT(*) FROM words WHERE book_id=b.id),
 (SELECT COUNT(*) FROM words w JOIN progress p ON p.word_id=w.id WHERE w.book_id=b.id AND p.user_id=? AND p.status='mastered'),
 (SELECT COUNT(*) FROM words w JOIN progress p ON p.word_id=w.id WHERE w.book_id=b.id AND p.user_id=? AND p.due_at<>'' AND p.due_at<=?)
 FROM books b ORDER BY b.id`, userID, userID, stamp(time.Now()))
	if err != nil {
		internal(w, err)
		return
	}
	defer rows.Close()
	books := []Book{}
	for rows.Next() {
		var b Book
		if err = rows.Scan(&b.ID, &b.Title, &b.Subtitle, &b.Description, &b.Category, &b.Color, &b.WordCount, &b.LearnedCount, &b.DueCount); err != nil {
			internal(w, err)
			return
		}
		books = append(books, b)
	}
	if err = rows.Err(); err != nil {
		internal(w, err)
		return
	}
	writeJSON(w, http.StatusOK, books)
}

type adminBookReader interface {
	QueryRowContext(context.Context, string, ...any) *sql.Row
}

func readAdminBook(ctx context.Context, q adminBookReader, id, userID int64) (Book, error) {
	var b Book
	err := q.QueryRowContext(ctx, `SELECT b.id,b.title,b.subtitle,b.description,b.category,b.color,
 (SELECT COUNT(*) FROM words WHERE book_id=b.id),
 (SELECT COUNT(*) FROM words w JOIN progress p ON p.word_id=w.id WHERE w.book_id=b.id AND p.user_id=? AND p.status='mastered'),
 (SELECT COUNT(*) FROM words w JOIN progress p ON p.word_id=w.id WHERE w.book_id=b.id AND p.user_id=? AND p.due_at<>'' AND p.due_at<=?)
 FROM books b WHERE b.id=?`, userID, userID, stamp(time.Now()), id).Scan(&b.ID, &b.Title, &b.Subtitle, &b.Description, &b.Category, &b.Color, &b.WordCount, &b.LearnedCount, &b.DueCount)
	return b, err
}

func (a *App) createBook(w http.ResponseWriter, r *http.Request) {
	var b bookInput
	if !decode(w, r, &b) {
		return
	}
	if !normalizeBook(&b) {
		fail(w, 400, "标题需为 1–120 字，分类不超过 40 字，颜色需为六位十六进制色值")
		return
	}
	result, err := a.db.ExecContext(r.Context(), "INSERT INTO books(title,subtitle,description,category,color,created_at) VALUES(?,?,?,?,?,?)", b.Title, b.Subtitle, b.Description, b.Category, b.Color, stamp(time.Now()))
	if err != nil {
		internal(w, err)
		return
	}
	id, err := result.LastInsertId()
	if err != nil {
		internal(w, err)
		return
	}
	writeJSON(w, http.StatusCreated, Book{ID: id, Title: b.Title, Subtitle: b.Subtitle, Description: b.Description, Category: b.Category, Color: b.Color})
}

func (a *App) updateBook(w http.ResponseWriter, r *http.Request) {
	id, ok := pathID(w, r)
	if !ok {
		return
	}
	var patch struct {
		Title       *string `json:"title"`
		Subtitle    *string `json:"subtitle"`
		Description *string `json:"description"`
		Category    *string `json:"category"`
		Color       *string `json:"color"`
	}
	if !decode(w, r, &patch) {
		return
	}
	tx, err := a.db.BeginTx(r.Context(), nil)
	if err != nil {
		internal(w, err)
		return
	}
	defer tx.Rollback()
	b, err := readAdminBook(r.Context(), tx, id, userFrom(r).ID)
	if errors.Is(err, sql.ErrNoRows) {
		fail(w, 404, "词书不存在")
		return
	}
	if err != nil {
		internal(w, err)
		return
	}
	updated := bookInput{Title: b.Title, Subtitle: b.Subtitle, Description: b.Description, Category: b.Category, Color: b.Color}
	if patch.Title != nil {
		updated.Title = *patch.Title
	}
	if patch.Subtitle != nil {
		updated.Subtitle = *patch.Subtitle
	}
	if patch.Description != nil {
		updated.Description = *patch.Description
	}
	if patch.Category != nil {
		updated.Category = *patch.Category
	}
	if patch.Color != nil {
		updated.Color = *patch.Color
	}
	if !normalizeBook(&updated) {
		fail(w, 400, "词书字段过长、标题为空或颜色格式无效")
		return
	}
	if _, err = tx.ExecContext(r.Context(), "UPDATE books SET title=?,subtitle=?,description=?,category=?,color=? WHERE id=?", updated.Title, updated.Subtitle, updated.Description, updated.Category, updated.Color, id); err != nil {
		internal(w, err)
		return
	}
	if err = tx.Commit(); err != nil {
		internal(w, err)
		return
	}
	b.Title = updated.Title
	b.Subtitle = updated.Subtitle
	b.Description = updated.Description
	b.Category = updated.Category
	b.Color = updated.Color
	writeJSON(w, 200, b)
}

func (a *App) deleteBook(w http.ResponseWriter, r *http.Request) {
	id, ok := pathID(w, r)
	if !ok {
		return
	}
	result, err := a.db.ExecContext(r.Context(), "DELETE FROM books WHERE id=?", id)
	if err != nil {
		internal(w, err)
		return
	}
	count, err := result.RowsAffected()
	if err != nil {
		internal(w, err)
		return
	}
	if count == 0 {
		fail(w, 404, "词书不存在")
		return
	}
	writeJSON(w, 200, map[string]bool{"ok": true})
}

type importWord struct {
	Text           string `json:"text"`
	Phonetic       string `json:"phonetic"`
	Meaning        string `json:"meaning"`
	Example        string `json:"example"`
	ExampleMeaning string `json:"exampleMeaning"`
}

// importWords validates the entire payload before atomically upserting words. An
// upsert retains each existing word's ID, preserving every learner's progress.
func (a *App) importWords(w http.ResponseWriter, r *http.Request) {
	id, ok := pathID(w, r)
	if !ok {
		return
	}
	var req struct {
		Words []importWord `json:"words"`
	}
	if !decode(w, r, &req) {
		return
	}
	if len(req.Words) == 0 || len(req.Words) > 5000 {
		fail(w, 400, "每次导入需包含 1–5000 个单词")
		return
	}
	seen := make(map[string]struct{}, len(req.Words))
	for i := range req.Words {
		word := &req.Words[i]
		word.Text = strings.TrimSpace(word.Text)
		word.Phonetic = strings.TrimSpace(word.Phonetic)
		word.Meaning = strings.TrimSpace(word.Meaning)
		word.Example = strings.TrimSpace(word.Example)
		word.ExampleMeaning = strings.TrimSpace(word.ExampleMeaning)
		if word.Text == "" || word.Meaning == "" || !validText(word.Text, 128) || !validText(word.Phonetic, 200) || !validText(word.Meaning, 2000) || !validText(word.Example, 2000) || !validText(word.ExampleMeaning, 2000) {
			fail(w, 400, "单词和释义不能为空，字段不得超长或含控制字符")
			return
		}
		key := strings.ToLower(word.Text)
		if _, exists := seen[key]; exists {
			fail(w, 400, "同一导入中不能包含重复单词")
			return
		}
		seen[key] = struct{}{}
	}
	tx, err := a.db.BeginTx(r.Context(), nil)
	if err != nil {
		internal(w, err)
		return
	}
	defer tx.Rollback()
	var exists int
	err = tx.QueryRowContext(r.Context(), "SELECT 1 FROM books WHERE id=?", id).Scan(&exists)
	if errors.Is(err, sql.ErrNoRows) {
		fail(w, 404, "词书不存在")
		return
	}
	if err != nil {
		internal(w, err)
		return
	}
	stmt, err := tx.PrepareContext(r.Context(), `INSERT INTO words(book_id,text,phonetic,meaning,example,example_meaning) VALUES(?,?,?,?,?,?) ON CONFLICT(book_id,text) DO UPDATE SET text=excluded.text,phonetic=excluded.phonetic,meaning=excluded.meaning,example=excluded.example,example_meaning=excluded.example_meaning`)
	if err != nil {
		internal(w, err)
		return
	}
	defer stmt.Close()
	for _, word := range req.Words {
		if _, err = stmt.ExecContext(r.Context(), id, word.Text, word.Phonetic, word.Meaning, word.Example, word.ExampleMeaning); err != nil {
			internal(w, err)
			return
		}
	}
	if err = tx.Commit(); err != nil {
		internal(w, err)
		return
	}
	writeJSON(w, 200, map[string]int{"imported": len(req.Words)})
}

func (a *App) deleteWord(w http.ResponseWriter, r *http.Request) {
	id, ok := pathID(w, r)
	if !ok {
		return
	}
	result, err := a.db.ExecContext(r.Context(), "DELETE FROM words WHERE id=?", id)
	if err != nil {
		internal(w, err)
		return
	}
	count, err := result.RowsAffected()
	if err != nil {
		internal(w, err)
		return
	}
	if count == 0 {
		fail(w, 404, "单词不存在")
		return
	}
	writeJSON(w, 200, map[string]bool{"ok": true})
}

func (a *App) adminUsers(w http.ResponseWriter, r *http.Request) {
	type adminUser struct {
		ID           int64  `json:"id"`
		Name         string `json:"name"`
		Email        string `json:"email"`
		Role         string `json:"role"`
		Guest        bool   `json:"guest"`
		DailyGoal    int    `json:"dailyGoal"`
		LearnedCount int    `json:"learnedCount"`
		CreatedAt    string `json:"createdAt"`
	}
	rows, err := a.db.QueryContext(r.Context(), `SELECT u.id,u.name,COALESCE(u.email,''),u.role,u.guest,u.daily_goal,(SELECT COUNT(*) FROM progress p WHERE p.user_id=u.id AND p.status='mastered'),u.created_at FROM users u ORDER BY u.id DESC`)
	if err != nil {
		internal(w, err)
		return
	}
	defer rows.Close()
	users := []adminUser{}
	for rows.Next() {
		var u adminUser
		if err = rows.Scan(&u.ID, &u.Name, &u.Email, &u.Role, &u.Guest, &u.DailyGoal, &u.LearnedCount, &u.CreatedAt); err != nil {
			internal(w, err)
			return
		}
		users = append(users, u)
	}
	if err = rows.Err(); err != nil {
		internal(w, err)
		return
	}
	writeJSON(w, 200, users)
}

func (a *App) navigation(w http.ResponseWriter, r *http.Request) {
	rows, err := a.db.QueryContext(r.Context(), "SELECT id,label,path,icon,enabled,sort_order FROM navigation ORDER BY sort_order,id")
	if err != nil {
		internal(w, err)
		return
	}
	defer rows.Close()
	items := []Navigation{}
	for rows.Next() {
		var item Navigation
		if err = rows.Scan(&item.ID, &item.Label, &item.Path, &item.Icon, &item.Enabled, &item.SortOrder); err != nil {
			internal(w, err)
			return
		}
		items = append(items, item)
	}
	if err = rows.Err(); err != nil {
		internal(w, err)
		return
	}
	writeJSON(w, 200, items)
}

// saveNavigation only configures modules compiled into the application. Keeping
// the navigation module enabled guarantees an administrator can undo changes.
func (a *App) saveNavigation(w http.ResponseWriter, r *http.Request) {
	var req struct {
		Items []Navigation `json:"items"`
	}
	if !decode(w, r, &req) {
		return
	}
	expected := map[string]string{}
	icons := map[string]bool{}
	for _, item := range defaultNavigation() {
		expected[item.ID] = item.Path
		icons[item.Icon] = true
	}
	if len(req.Items) != len(expected) {
		fail(w, 400, "导航设置必须包含全部四个后台模块")
		return
	}
	seenIDs := map[string]bool{}
	seenOrders := map[int]bool{}
	for i := range req.Items {
		item := &req.Items[i]
		item.Label = strings.TrimSpace(item.Label)
		if path, exists := expected[item.ID]; !exists || path != item.Path || seenIDs[item.ID] {
			fail(w, 400, "导航模块或路由无效，且不可重复")
			return
		}
		if item.Label == "" || !validText(item.Label, 40) || !icons[item.Icon] || item.SortOrder < 0 || item.SortOrder > 1000 || seenOrders[item.SortOrder] {
			fail(w, 400, "导航名称、图标或排序无效")
			return
		}
		if item.ID == "navigation" && !item.Enabled {
			fail(w, 400, "导航设置模块必须保持启用")
			return
		}
		seenIDs[item.ID] = true
		seenOrders[item.SortOrder] = true
	}
	tx, err := a.db.BeginTx(r.Context(), nil)
	if err != nil {
		internal(w, err)
		return
	}
	defer tx.Rollback()
	for _, item := range req.Items {
		if _, err = tx.ExecContext(r.Context(), "UPDATE navigation SET label=?,icon=?,enabled=?,sort_order=? WHERE id=?", item.Label, item.Icon, item.Enabled, item.SortOrder, item.ID); err != nil {
			internal(w, err)
			return
		}
	}
	if err = tx.Commit(); err != nil {
		internal(w, err)
		return
	}
	sort.Slice(req.Items, func(i, j int) bool { return req.Items[i].SortOrder < req.Items[j].SortOrder })
	writeJSON(w, 200, req.Items)
}
