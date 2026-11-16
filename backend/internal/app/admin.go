package app

import (
	"context"
	"database/sql"
	"errors"
	"fmt"
	"net/http"
	"regexp"
	"sort"
	"strconv"
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

// importWordPatch distinguishes an omitted optional field from an explicit clear.
// New words use an empty value when the optional field is absent.
type importWordPatch struct {
	Text           string  `json:"text"`
	Phonetic       *string `json:"phonetic"`
	Meaning        string  `json:"meaning"`
	Example        *string `json:"example"`
	ExampleMeaning *string `json:"exampleMeaning"`
}

func importError(w http.ResponseWriter, index int, word, field, message string) {
	writeJSON(w, http.StatusBadRequest, map[string]any{
		"error": fmt.Sprintf("第 %d 项（%s）%s：%s", index+1, word, field, message),
		"index": index, "word": word, "field": field,
	})
}

// importWords validates the whole batch before writing. An upsert preserves IDs
// and omitted optional fields; changing content invalidates old quiz snapshots.
func (a *App) importWords(w http.ResponseWriter, r *http.Request) {
	id, ok := pathID(w, r)
	if !ok {
		return
	}
	var req struct {
		Words []importWordPatch `json:"words"`
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
		word.Meaning = strings.TrimSpace(word.Meaning)
		fields := []struct {
			name     string
			value    *string
			max      int
			required bool
		}{
			{"text", &word.Text, 128, true}, {"meaning", &word.Meaning, 2000, true},
			{"phonetic", word.Phonetic, 200, false}, {"example", word.Example, 2000, false},
			{"exampleMeaning", word.ExampleMeaning, 2000, false},
		}
		for _, field := range fields {
			if field.value == nil {
				continue
			}
			*field.value = strings.TrimSpace(*field.value)
			if (field.required && *field.value == "") || !validText(*field.value, field.max) {
				importError(w, i, word.Text, field.name, fmt.Sprintf("必填字段不能为空，最多 %d 字且不得含控制字符", field.max))
				return
			}
		}
		key := strings.ToLower(word.Text)
		if _, exists := seen[key]; exists {
			importError(w, i, word.Text, "text", "与本批次其他单词重复")
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
	stmt, err := tx.PrepareContext(r.Context(), `INSERT INTO words(book_id,text,phonetic,meaning,example,example_meaning)
 VALUES(?,?,COALESCE(?,''),?,COALESCE(?,''),COALESCE(?,''))
 ON CONFLICT(book_id,text) DO UPDATE SET
 text=excluded.text, meaning=excluded.meaning,
 phonetic=COALESCE(?,words.phonetic), example=COALESCE(?,words.example), example_meaning=COALESCE(?,words.example_meaning),
 content_version=words.content_version+CASE WHEN words.text COLLATE BINARY IS NOT excluded.text COLLATE BINARY OR words.meaning IS NOT excluded.meaning
 OR words.phonetic IS NOT COALESCE(?,words.phonetic) OR words.example IS NOT COALESCE(?,words.example)
 OR words.example_meaning IS NOT COALESCE(?,words.example_meaning) THEN 1 ELSE 0 END
 RETURNING id,content_version`)
	if err != nil {
		internal(w, err)
		return
	}
	defer stmt.Close()
	previous, err := tx.PrepareContext(r.Context(), "SELECT content_version FROM words WHERE book_id=? AND text=?")
	if err != nil {
		internal(w, err)
		return
	}
	defer previous.Close()
	for _, word := range req.Words {
		var oldVersion int64
		previousErr := previous.QueryRowContext(r.Context(), id, word.Text).Scan(&oldVersion)
		if previousErr != nil && !errors.Is(previousErr, sql.ErrNoRows) {
			internal(w, previousErr)
			return
		}
		var wordID, version int64
		if err = stmt.QueryRowContext(r.Context(), id, word.Text, word.Phonetic, word.Meaning, word.Example, word.ExampleMeaning, word.Phonetic, word.Example, word.ExampleMeaning, word.Phonetic, word.Example, word.ExampleMeaning).Scan(&wordID, &version); err != nil {
			internal(w, err)
			return
		}
		if previousErr == nil && version != oldVersion {
			// An unfinished recognition step cannot certify the replacement content.
			// Keep revisions monotonic so already-open legacy clients also conflict.
			if _, err = tx.ExecContext(r.Context(), `UPDATE learn_progress SET stage=0,revision=revision+1,updated_at=? WHERE word_id=? AND stage<2`, stamp(time.Now()), wordID); err != nil {
				internal(w, err)
				return
			}
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
	limit, offset, ok := pageBounds(r, 50)
	if !ok {
		fail(w, http.StatusBadRequest, "分页参数无效")
		return
	}
	paged := r.URL.Query().Get("paged") == "1"
	kind := r.URL.Query().Get("kind")
	if kind != "" && kind != "all" && kind != "guest" && kind != "registered" && kind != "admin" {
		fail(w, 400, "账户类型筛选无效")
		return
	}
	query := strings.TrimSpace(r.URL.Query().Get("q"))
	if len(query) > 200 {
		fail(w, 400, "搜索条件过长")
		return
	}
	where := []string{"1=1"}
	args := []any{}
	if query != "" {
		where = append(where, "(u.name LIKE ? OR COALESCE(u.email,'') LIKE ?)")
		args = append(args, "%"+query+"%", "%"+query+"%")
	}
	switch kind {
	case "guest":
		where = append(where, "u.guest=1")
	case "registered":
		where = append(where, "u.guest=0")
	case "admin":
		where = append(where, "u.role='admin'")
	}
	filter := strings.Join(where, " AND ")
	var total int
	if err := a.db.QueryRowContext(r.Context(), "SELECT COUNT(*) FROM users u WHERE "+filter, args...).Scan(&total); err != nil {
		internal(w, err)
		return
	}
	args = append(args, limit, offset)
	rows, err := a.db.QueryContext(r.Context(), `SELECT u.id,u.name,COALESCE(u.email,''),u.role,u.guest,u.daily_goal,
 (SELECT COUNT(*) FROM progress p WHERE p.user_id=u.id AND p.status='mastered'),u.created_at FROM users u WHERE `+filter+` ORDER BY u.id DESC LIMIT ? OFFSET ?`, args...)
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
	if paged {
		writeJSON(w, http.StatusOK, map[string]any{"items": users, "total": total, "offset": offset, "limit": limit, "hasMore": offset+len(users) < total})
		return
	}
	writeJSON(w, http.StatusOK, users)
}

func navigationVersion(ctx context.Context, q interface {
	QueryRowContext(context.Context, string, ...any) *sql.Row
}) (int64, error) {
	var raw string
	err := q.QueryRowContext(ctx, "SELECT value FROM metadata WHERE key='navigation_revision'").Scan(&raw)
	if errors.Is(err, sql.ErrNoRows) {
		return 0, nil
	}
	if err != nil {
		return 0, err
	}
	version, err := strconv.ParseInt(raw, 10, 64)
	if err != nil || version < 0 {
		return 0, errors.New("navigation revision is invalid")
	}
	return version, nil
}

func readNavigation(ctx context.Context, q interface {
	QueryContext(context.Context, string, ...any) (*sql.Rows, error)
}) ([]Navigation, error) {
	rows, err := q.QueryContext(ctx, "SELECT id,label,path,icon,enabled,sort_order FROM navigation ORDER BY sort_order,id")
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	items := []Navigation{}
	for rows.Next() {
		var item Navigation
		if err = rows.Scan(&item.ID, &item.Label, &item.Path, &item.Icon, &item.Enabled, &item.SortOrder); err != nil {
			return nil, err
		}
		items = append(items, item)
	}
	return items, rows.Err()
}

func (a *App) navigation(w http.ResponseWriter, r *http.Request) {
	// The version and rows must come from one snapshot; pairing old rows with a
	// newer version would otherwise allow a stale editor to overwrite changes.
	tx, err := a.db.BeginTx(r.Context(), &sql.TxOptions{ReadOnly: true})
	if err != nil {
		internal(w, err)
		return
	}
	defer tx.Rollback()
	items, err := readNavigation(r.Context(), tx)
	if err != nil {
		internal(w, err)
		return
	}
	version, err := navigationVersion(r.Context(), tx)
	if err != nil {
		internal(w, err)
		return
	}
	if err = tx.Commit(); err != nil {
		internal(w, err)
		return
	}
	if r.URL.Query().Get("versioned") == "1" {
		writeJSON(w, http.StatusOK, map[string]any{"items": items, "version": version})
		return
	}
	writeJSON(w, http.StatusOK, items)
}

// saveNavigation uses a metadata revision as a compare-and-swap token.
func (a *App) saveNavigation(w http.ResponseWriter, r *http.Request) {
	var req struct {
		Items   []Navigation `json:"items"`
		Version *int64       `json:"version"`
	}
	if !decode(w, r, &req) {
		return
	}
	if req.Version == nil || *req.Version < 0 {
		fail(w, http.StatusPreconditionRequired, "导航配置版本号必填，请刷新后重试")
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
	current, err := navigationVersion(r.Context(), tx)
	if err != nil {
		internal(w, err)
		return
	}
	if current != *req.Version {
		fail(w, http.StatusConflict, "导航配置已被其他管理员修改，请刷新后重试")
		return
	}
	for _, item := range req.Items {
		if _, err = tx.ExecContext(r.Context(), "UPDATE navigation SET label=?,icon=?,enabled=?,sort_order=? WHERE id=?", item.Label, item.Icon, item.Enabled, item.SortOrder, item.ID); err != nil {
			internal(w, err)
			return
		}
	}
	next := current + 1
	if _, err = tx.ExecContext(r.Context(), "INSERT INTO metadata(key,value) VALUES('navigation_revision',?) ON CONFLICT(key) DO UPDATE SET value=excluded.value", strconv.FormatInt(next, 10)); err != nil {
		internal(w, err)
		return
	}
	if err = tx.Commit(); err != nil {
		internal(w, err)
		return
	}
	sort.Slice(req.Items, func(i, j int) bool { return req.Items[i].SortOrder < req.Items[j].SortOrder })
	writeJSON(w, http.StatusOK, map[string]any{"items": req.Items, "version": next})
}
