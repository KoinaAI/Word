package app

import (
	"database/sql"
	"net/http"
	"strings"
	"time"
)

type bookInput struct {
	Title       *string `json:"title"`
	Subtitle    *string `json:"subtitle"`
	Description *string `json:"description"`
	Category    *string `json:"category"`
	Color       *string `json:"color"`
}

func (input *bookInput) validate(create bool) error {
	if create && input.Title == nil {
		return problem(http.StatusBadRequest, "title is required")
	}
	for _, field := range []struct {
		name  string
		value *string
		min   int
		max   int
	}{
		{"title", input.Title, 1, 150}, {"subtitle", input.Subtitle, 0, 250},
		{"description", input.Description, 0, 5000}, {"category", input.Category, 0, 80}, {"color", input.Color, 0, 64},
	} {
		if field.value != nil {
			*field.value = strings.TrimSpace(*field.value)
			if !validText(*field.value, field.min, field.max) {
				return problem(http.StatusBadRequest, "invalid "+field.name)
			}
		}
	}
	return nil
}

func (a *App) adminBooks(w http.ResponseWriter, r *http.Request, u User) error {
	books, err := a.listBooks(r, u.ID, true)
	if err != nil {
		return err
	}
	return jsonResponse(w, http.StatusOK, books)
}

func (a *App) createBook(w http.ResponseWriter, r *http.Request, u User) error {
	var input bookInput
	if err := decode(w, r, &input); err != nil {
		return err
	}
	if err := input.validate(true); err != nil {
		return err
	}
	tx, err := a.db.BeginTx(r.Context(), nil)
	if err != nil {
		return err
	}
	defer tx.Rollback()
	result, err := tx.ExecContext(r.Context(), `INSERT INTO books(title,subtitle,description,category,color) VALUES(?,COALESCE(?,''),COALESCE(?,''),COALESCE(?,''),COALESCE(?,''))`, input.Title, input.Subtitle, input.Description, input.Category, input.Color)
	if err != nil {
		return err
	}
	id, err := result.LastInsertId()
	if err != nil {
		return err
	}
	book, err := a.getBook(r.Context(), tx, u.ID, id)
	if err != nil {
		return err
	}
	if err = tx.Commit(); err != nil {
		return err
	}
	return jsonResponse(w, http.StatusOK, book)
}

func (a *App) patchBook(w http.ResponseWriter, r *http.Request, u User) error {
	id, err := pathID(r)
	if err != nil {
		return err
	}
	var input bookInput
	if err := decode(w, r, &input); err != nil {
		return err
	}
	if err := input.validate(false); err != nil {
		return err
	}
	tx, err := a.db.BeginTx(r.Context(), nil)
	if err != nil {
		return err
	}
	defer tx.Rollback()
	result, err := tx.ExecContext(r.Context(), `UPDATE books SET title=COALESCE(?,title),subtitle=COALESCE(?,subtitle),description=COALESCE(?,description),category=COALESCE(?,category),color=COALESCE(?,color) WHERE id=?`, input.Title, input.Subtitle, input.Description, input.Category, input.Color, id)
	if err = requireChanged(result, err, "book"); err != nil {
		return err
	}
	book, err := a.getBook(r.Context(), tx, u.ID, id)
	if err != nil {
		return err
	}
	if err = tx.Commit(); err != nil {
		return err
	}
	return jsonResponse(w, http.StatusOK, book)
}

func (a *App) deleteBook(w http.ResponseWriter, r *http.Request, u User) error {
	id, err := pathID(r)
	if err != nil {
		return err
	}
	result, err := a.db.ExecContext(r.Context(), "DELETE FROM books WHERE id=?", id)
	if err = requireChanged(result, err, "book"); err != nil {
		return err
	}
	return ok(w)
}

type importedWord struct {
	Text           string `json:"text"`
	Phonetic       string `json:"phonetic"`
	Meaning        string `json:"meaning"`
	Example        string `json:"example"`
	ExampleMeaning string `json:"exampleMeaning"`
}

// importWords validates the whole batch before an atomic upsert; existing IDs and progress survive edits.
func (a *App) importWords(w http.ResponseWriter, r *http.Request, u User) error {
	id, err := pathID(r)
	if err != nil {
		return err
	}
	var input struct {
		Words []importedWord `json:"words"`
	}
	if err := decode(w, r, &input); err != nil {
		return err
	}
	if len(input.Words) < 1 || len(input.Words) > 5000 {
		return problem(http.StatusBadRequest, "words must contain between 1 and 5000 entries")
	}
	seen := make(map[string]bool, len(input.Words))
	for i := range input.Words {
		word := &input.Words[i]
		word.Text = strings.TrimSpace(word.Text)
		word.Phonetic = strings.TrimSpace(word.Phonetic)
		word.Meaning = strings.TrimSpace(word.Meaning)
		word.Example = strings.TrimSpace(word.Example)
		word.ExampleMeaning = strings.TrimSpace(word.ExampleMeaning)
		if !validText(word.Text, 1, 200) || strings.ContainsAny(word.Text, "\n\t") || !validText(word.Phonetic, 0, 200) || !validText(word.Meaning, 1, 2000) || !validText(word.Example, 0, 4000) || !validText(word.ExampleMeaning, 0, 4000) {
			return problem(http.StatusBadRequest, "each word needs text (1–200 characters) and meaning (1–2000); phonetic is limited to 200 and examples to 4000 characters")
		}
		key := strings.ToLower(word.Text)
		if seen[key] {
			return problem(http.StatusBadRequest, "duplicate word text in import")
		}
		seen[key] = true
	}
	tx, err := a.db.BeginTx(r.Context(), nil)
	if err != nil {
		return err
	}
	defer tx.Rollback()
	if _, err := a.getBook(r.Context(), tx, u.ID, id); err != nil {
		return err
	}
	statement, err := tx.PrepareContext(r.Context(), `INSERT INTO words(book_id,text,phonetic,meaning,example,example_meaning)
 VALUES(?,?,?,?,?,?) ON CONFLICT(book_id,text) DO UPDATE SET text=excluded.text,phonetic=excluded.phonetic,
 meaning=excluded.meaning,example=excluded.example,example_meaning=excluded.example_meaning`)
	if err != nil {
		return err
	}
	defer statement.Close()
	for _, word := range input.Words {
		if _, err = statement.ExecContext(r.Context(), id, word.Text, word.Phonetic, word.Meaning, word.Example, word.ExampleMeaning); err != nil {
			return err
		}
	}
	if err = tx.Commit(); err != nil {
		return err
	}
	return jsonResponse(w, http.StatusOK, map[string]int{"imported": len(input.Words)})
}

func (a *App) deleteWord(w http.ResponseWriter, r *http.Request, u User) error {
	id, err := pathID(r)
	if err != nil {
		return err
	}
	result, err := a.db.ExecContext(r.Context(), "DELETE FROM words WHERE id=?", id)
	if err = requireChanged(result, err, "word"); err != nil {
		return err
	}
	return ok(w)
}

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

func (a *App) adminUsers(w http.ResponseWriter, r *http.Request, u User) error {
	rows, err := a.db.QueryContext(r.Context(), `SELECT u.id,u.name,COALESCE(u.email,''),u.role,u.guest,u.daily_goal,COALESCE(SUM(p.status='mastered'),0),u.created_at
 FROM users u LEFT JOIN progress p ON p.user_id=u.id GROUP BY u.id ORDER BY u.created_at DESC,u.id DESC`)
	if err != nil {
		return err
	}
	defer rows.Close()
	users := []adminUser{}
	for rows.Next() {
		var user adminUser
		var created int64
		if err := rows.Scan(&user.ID, &user.Name, &user.Email, &user.Role, &user.Guest, &user.DailyGoal, &user.LearnedCount, &created); err != nil {
			return err
		}
		user.CreatedAt = isoTime(created)
		users = append(users, user)
	}
	if err = rows.Err(); err != nil {
		return err
	}
	return jsonResponse(w, http.StatusOK, users)
}

type adminStats struct {
	Users       int            `json:"users"`
	Books       int            `json:"books"`
	Words       int            `json:"words"`
	Answers     int            `json:"answers"`
	ActiveToday int            `json:"activeToday"`
	Activity    []activityDay  `json:"activity"`
	Recent      []recentAnswer `json:"recent"`
}

func (a *App) adminStats(w http.ResponseWriter, r *http.Request, u User) error {
	tx, err := a.db.BeginTx(r.Context(), &sql.TxOptions{ReadOnly: true})
	if err != nil {
		return err
	}
	defer tx.Rollback()
	now := a.now().UTC()
	today := time.Date(now.Year(), now.Month(), now.Day(), 0, 0, 0, 0, time.UTC)
	var stats adminStats
	err = tx.QueryRowContext(r.Context(), `SELECT (SELECT COUNT(*) FROM users),(SELECT COUNT(*) FROM books),(SELECT COUNT(*) FROM words),
 (SELECT COUNT(*) FROM events),(SELECT COUNT(DISTINCT user_id) FROM events WHERE created_at>=? AND created_at<?)`, today.Unix(), today.AddDate(0, 0, 1).Unix()).Scan(&stats.Users, &stats.Books, &stats.Words, &stats.Answers, &stats.ActiveToday)
	if err != nil {
		return err
	}
	stats.Activity, stats.Recent, err = readActivity(r.Context(), tx, now, 0)
	if err != nil {
		return err
	}
	if err = tx.Commit(); err != nil {
		return err
	}
	return jsonResponse(w, http.StatusOK, stats)
}
