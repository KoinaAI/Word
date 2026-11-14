package app

import (
	"context"
	"database/sql"
	"errors"
	"net/http"
	"strconv"
	"strings"
)

type querier interface {
	QueryContext(context.Context, string, ...any) (*sql.Rows, error)
	QueryRowContext(context.Context, string, ...any) *sql.Row
}

const bookSelect = `SELECT b.id,b.title,b.subtitle,b.description,b.category,b.color,
 COUNT(w.id),COALESCE(SUM(p.status='mastered'),0),COALESCE(SUM(p.due_at<=?),0)
 FROM books b LEFT JOIN words w ON w.book_id=b.id
 LEFT JOIN progress p ON p.word_id=w.id AND p.user_id=?`

func scanBook(row scanner) (Book, error) {
	var b Book
	err := row.Scan(&b.ID, &b.Title, &b.Subtitle, &b.Description, &b.Category, &b.Color, &b.WordCount, &b.LearnedCount, &b.DueCount)
	return b, err
}

func (a *App) getBook(ctx context.Context, db querier, userID, bookID int64) (Book, error) {
	b, err := scanBook(db.QueryRowContext(ctx, bookSelect+" WHERE b.id=? GROUP BY b.id", a.now().Unix(), userID, bookID))
	if errors.Is(err, sql.ErrNoRows) {
		return b, problem(http.StatusNotFound, "book not found")
	}
	return b, err
}

func (a *App) listBooks(r *http.Request, userID int64, includeEmpty bool) ([]Book, error) {
	query := bookSelect + ` WHERE 1=1`
	args := []any{a.now().Unix(), userID}
	if q := strings.TrimSpace(r.URL.Query().Get("q")); q != "" {
		if !validText(q, 1, 200) {
			return nil, problem(http.StatusBadRequest, "search query is too long")
		}
		query += ` AND (instr(lower(b.title),lower(?))>0 OR instr(lower(b.subtitle),lower(?))>0 OR instr(lower(b.description),lower(?))>0)`
		args = append(args, q, q, q)
	}
	if category := r.URL.Query().Get("category"); category != "" {
		query += " AND b.category=?"
		args = append(args, category)
	}
	query += " GROUP BY b.id"
	if !includeEmpty {
		query += " HAVING COUNT(w.id)>0"
	}
	query += " ORDER BY b.id"
	rows, err := a.db.QueryContext(r.Context(), query, args...)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	books := []Book{}
	for rows.Next() {
		b, err := scanBook(rows)
		if err != nil {
			return nil, err
		}
		books = append(books, b)
	}
	return books, rows.Err()
}

func (a *App) books(w http.ResponseWriter, r *http.Request, u User) error {
	books, err := a.listBooks(r, u.ID, false)
	if err != nil {
		return err
	}
	return jsonResponse(w, http.StatusOK, books)
}

func (a *App) bookDetail(w http.ResponseWriter, r *http.Request, u User) error {
	id, err := pathID(r)
	if err != nil {
		return err
	}
	tx, err := a.db.BeginTx(r.Context(), &sql.TxOptions{ReadOnly: true})
	if err != nil {
		return err
	}
	defer tx.Rollback()
	book, err := a.getBook(r.Context(), tx, u.ID, id)
	if err != nil {
		return err
	}
	words, err := readWords(r.Context(), tx, u.ID, "w.book_id=?", id)
	if err != nil {
		return err
	}
	if err = tx.Commit(); err != nil {
		return err
	}
	return jsonResponse(w, http.StatusOK, struct {
		Book  Book   `json:"book"`
		Words []Word `json:"words"`
	}{book, words})
}

func readWords(ctx context.Context, db querier, userID int64, where string, args ...any) ([]Word, error) {
	query := `SELECT w.id,w.book_id,w.text,w.phonetic,w.meaning,w.example,w.example_meaning,
 COALESCE(p.favorite,0),COALESCE(p.status,'new'),COALESCE(p.reinforce,0),p.due_at
 FROM words w LEFT JOIN progress p ON p.word_id=w.id AND p.user_id=? WHERE ` + where + ` ORDER BY w.id`
	rows, err := db.QueryContext(ctx, query, append([]any{userID}, args...)...)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	words := []Word{}
	for rows.Next() {
		var word Word
		var due sql.NullInt64
		if err := rows.Scan(&word.ID, &word.BookID, &word.Text, &word.Phonetic, &word.Meaning, &word.Example, &word.ExampleMeaning, &word.Favorite, &word.Status, &word.Reinforce, &due); err != nil {
			return nil, err
		}
		if due.Valid {
			word.DueAt = isoTime(due.Int64)
		}
		words = append(words, word)
	}
	return words, rows.Err()
}

func (a *App) study(w http.ResponseWriter, r *http.Request, u User) error {
	bookID := u.ActiveBookID
	if raw := r.URL.Query().Get("bookId"); raw != "" {
		var err error
		bookID, err = strconv.ParseInt(raw, 10, 64)
		if err != nil || bookID < 1 {
			return problem(http.StatusBadRequest, "invalid bookId")
		}
	}
	if bookID == 0 {
		return problem(http.StatusBadRequest, "select a book first")
	}
	mode := r.URL.Query().Get("mode")
	if mode == "" {
		mode = "learn"
	}
	where := "w.book_id=?"
	args := []any{bookID}
	switch mode {
	case "learn":
		where += " AND (COALESCE(p.status,'new')='new' OR (p.status='learning' AND p.due_at<=?)) AND COALESCE(p.reinforce,0)=0"
		args = append(args, a.now().Unix())
	case "sprint":
		where += " AND COALESCE(p.status,'new')<>'mastered' AND COALESCE(p.reinforce,0)=0"
	case "review":
		where += " AND p.due_at<=?"
		args = append(args, a.now().Unix())
	case "reinforce":
		where += " AND p.reinforce=1"
	default:
		return problem(http.StatusBadRequest, "invalid study mode")
	}
	tx, err := a.db.BeginTx(r.Context(), &sql.TxOptions{ReadOnly: true})
	if err != nil {
		return err
	}
	defer tx.Rollback()
	book, err := a.getBook(r.Context(), tx, u.ID, bookID)
	if err != nil {
		return err
	}
	words, err := readWords(r.Context(), tx, u.ID, where, args...)
	if err != nil {
		return err
	}
	if err = tx.Commit(); err != nil {
		return err
	}
	return jsonResponse(w, http.StatusOK, struct {
		Book  Book   `json:"book"`
		Words []Word `json:"words"`
		Total int    `json:"total"`
	}{book, words, len(words)})
}

func (a *App) favorites(w http.ResponseWriter, r *http.Request, u User) error {
	words, err := readWords(r.Context(), a.db, u.ID, "p.favorite=1")
	if err != nil {
		return err
	}
	return jsonResponse(w, http.StatusOK, words)
}

func (a *App) setFavorite(w http.ResponseWriter, r *http.Request, u User) error {
	id, err := pathID(r)
	if err != nil {
		return err
	}
	var input struct {
		Favorite *bool `json:"favorite"`
	}
	if err := decode(w, r, &input); err != nil {
		return err
	}
	if input.Favorite == nil {
		return problem(http.StatusBadRequest, "favorite boolean is required")
	}
	result, err := a.db.ExecContext(r.Context(), `INSERT INTO progress(user_id,word_id,favorite)
 SELECT ?,id,? FROM words WHERE id=? ON CONFLICT(user_id,word_id) DO UPDATE SET favorite=excluded.favorite`, u.ID, *input.Favorite, id)
	if err = requireChanged(result, err, "word"); err != nil {
		return err
	}
	return ok(w)
}
