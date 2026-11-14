package app

import (
	"crypto/rand"
	"crypto/sha256"
	"database/sql"
	"encoding/base64"
	"encoding/hex"
	"errors"
	"net/http"
	"net/mail"
	"strings"
	"time"
	"unicode"
	"unicode/utf8"

	"golang.org/x/crypto/bcrypt"
)

const sessionCookie = "word_session"
const sessionLifetime = 30 * 24 * time.Hour

func newToken() (string, error) {
	var token [32]byte
	if _, err := rand.Read(token[:]); err != nil {
		return "", err
	}
	return base64.RawURLEncoding.EncodeToString(token[:]), nil
}

func tokenHash(token string) string {
	hash := sha256.Sum256([]byte(token))
	return hex.EncodeToString(hash[:])
}

func (a *App) currentUser(r *http.Request) (User, error) {
	cookie, err := r.Cookie(sessionCookie)
	if err != nil || len(cookie.Value) != 43 {
		return User{}, problem(http.StatusUnauthorized, "authentication required")
	}
	u, err := scanUser(a.db.QueryRowContext(r.Context(), "SELECT "+userColumns+" FROM users u JOIN sessions s ON s.user_id=u.id WHERE s.token_hash=? AND s.expires_at>?", tokenHash(cookie.Value), a.now().Unix()))
	if errors.Is(err, sql.ErrNoRows) {
		return User{}, problem(http.StatusUnauthorized, "session expired or invalid")
	}
	return u, err
}

func optionalUser(a *App, r *http.Request) (User, error) {
	u, err := a.currentUser(r)
	var public *apiError
	if errors.As(err, &public) && public.status == http.StatusUnauthorized {
		return User{}, nil
	}
	return u, err
}

// createSession rotates the incoming session and stores only a digest of its random token.
func (a *App) createSession(tx *sql.Tx, r *http.Request, userID int64) (string, error) {
	token, err := newToken()
	if err != nil {
		return "", err
	}
	if cookie, err := r.Cookie(sessionCookie); err == nil {
		if _, err = tx.ExecContext(r.Context(), "DELETE FROM sessions WHERE token_hash=?", tokenHash(cookie.Value)); err != nil {
			return "", err
		}
	}
	if _, err = tx.ExecContext(r.Context(), "DELETE FROM sessions WHERE expires_at<=?", a.now().Unix()); err != nil {
		return "", err
	}
	_, err = tx.ExecContext(r.Context(), "INSERT INTO sessions(token_hash,user_id,expires_at) VALUES(?,?,?)", tokenHash(token), userID, a.now().Add(sessionLifetime).Unix())
	return token, err
}

func (a *App) setCookie(w http.ResponseWriter, token string) {
	cookie := &http.Cookie{Name: sessionCookie, Value: token, Path: "/", HttpOnly: true, Secure: a.cfg.CookieSecure, SameSite: http.SameSiteLaxMode, MaxAge: int(sessionLifetime.Seconds()), Expires: a.now().Add(sessionLifetime)}
	if token == "" {
		cookie.MaxAge = -1
		cookie.Expires = time.Unix(1, 0)
	}
	http.SetCookie(w, cookie)
}

func (a *App) guest(w http.ResponseWriter, r *http.Request) error {
	u, err := optionalUser(a, r)
	if err != nil {
		return err
	}
	if u.ID != 0 {
		return jsonResponse(w, http.StatusOK, u)
	}
	tx, err := a.db.BeginTx(r.Context(), nil)
	if err != nil {
		return err
	}
	defer tx.Rollback()
	result, err := tx.ExecContext(r.Context(), "INSERT INTO users(name,guest,active_book_id,created_at) VALUES('访客',1,(SELECT MIN(id) FROM books),?)", a.now().Unix())
	if err != nil {
		return err
	}
	id, err := result.LastInsertId()
	if err != nil {
		return err
	}
	return a.finishAuth(w, r, tx, id)
}

func (a *App) finishAuth(w http.ResponseWriter, r *http.Request, tx *sql.Tx, id int64) error {
	token, err := a.createSession(tx, r, id)
	if err != nil {
		return err
	}
	u, err := scanUser(tx.QueryRowContext(r.Context(), "SELECT "+userColumns+" FROM users u WHERE u.id=?", id))
	if err != nil {
		return err
	}
	if err = tx.Commit(); err != nil {
		return err
	}
	a.setCookie(w, token)
	return jsonResponse(w, http.StatusOK, u)
}

func (a *App) register(w http.ResponseWriter, r *http.Request) error {
	var input struct{ Name, Email, Password string }
	if err := decode(w, r, &input); err != nil {
		return err
	}
	input.Name = strings.TrimSpace(input.Name)
	if !validText(input.Name, 1, 80) || !validPassword(input.Password, 8) {
		return problem(http.StatusBadRequest, "name must contain 1–80 characters; password must contain at least 8 characters and at most 72 bytes")
	}
	email, err := normalizeEmail(input.Email)
	if err != nil {
		return problem(http.StatusBadRequest, "invalid email")
	}
	u, err := optionalUser(a, r)
	if err != nil {
		return err
	}
	if u.ID != 0 && !u.Guest {
		return problem(http.StatusConflict, "already registered; log out to create another account")
	}
	hash, err := bcrypt.GenerateFromPassword([]byte(input.Password), bcrypt.DefaultCost)
	if err != nil {
		return err
	}
	tx, err := a.db.BeginTx(r.Context(), nil)
	if err != nil {
		return err
	}
	defer tx.Rollback()
	var exists int
	if err = tx.QueryRowContext(r.Context(), "SELECT COUNT(*) FROM users WHERE email=?", email).Scan(&exists); err != nil {
		return err
	}
	if exists != 0 {
		return problem(http.StatusConflict, "email is already registered")
	}
	id := u.ID
	if u.Guest {
		result, err := tx.ExecContext(r.Context(), "UPDATE users SET name=?,email=?,password_hash=?,guest=0 WHERE id=? AND guest=1", input.Name, email, string(hash), id)
		if err != nil {
			return err
		}
		count, err := result.RowsAffected()
		if err != nil {
			return err
		}
		if count != 1 {
			return problem(http.StatusConflict, "guest was already registered")
		}
		if _, err = tx.ExecContext(r.Context(), "DELETE FROM sessions WHERE user_id=?", id); err != nil {
			return err
		}
	} else {
		result, err := tx.ExecContext(r.Context(), "INSERT INTO users(name,email,password_hash,active_book_id,created_at) VALUES(?,?,?,(SELECT MIN(id) FROM books),?)", input.Name, email, string(hash), a.now().Unix())
		if err != nil {
			return err
		}
		id, err = result.LastInsertId()
		if err != nil {
			return err
		}
	}
	return a.finishAuth(w, r, tx, id)
}

func (a *App) login(w http.ResponseWriter, r *http.Request) error {
	var input struct{ Email, Password string }
	if err := decode(w, r, &input); err != nil {
		return err
	}
	if len(input.Password) > 72 {
		return problem(http.StatusUnauthorized, "invalid email or password")
	}
	email, _ := normalizeEmail(input.Email)
	var id int64
	var hash string
	err := a.db.QueryRowContext(r.Context(), "SELECT id,password_hash FROM users WHERE email=? AND guest=0", email).Scan(&id, &hash)
	if err != nil && !errors.Is(err, sql.ErrNoRows) {
		return err
	}
	if id == 0 {
		hash = string(a.dummyHash)
	}
	if err := bcrypt.CompareHashAndPassword([]byte(hash), []byte(input.Password)); err != nil || id == 0 {
		return problem(http.StatusUnauthorized, "invalid email or password")
	}
	tx, err := a.db.BeginTx(r.Context(), nil)
	if err != nil {
		return err
	}
	defer tx.Rollback()
	return a.finishAuth(w, r, tx, id)
}

func (a *App) logout(w http.ResponseWriter, r *http.Request) error {
	if cookie, err := r.Cookie(sessionCookie); err == nil {
		if _, err = a.db.ExecContext(r.Context(), "DELETE FROM sessions WHERE token_hash=?", tokenHash(cookie.Value)); err != nil {
			return err
		}
	}
	a.setCookie(w, "")
	return ok(w)
}

func (a *App) me(w http.ResponseWriter, r *http.Request, u User) error {
	return jsonResponse(w, http.StatusOK, u)
}

func (a *App) patchMe(w http.ResponseWriter, r *http.Request, u User) error {
	var input struct {
		Name         *string `json:"name"`
		DailyGoal    *int    `json:"dailyGoal"`
		ExamDate     *string `json:"examDate"`
		ActiveBookID *int64  `json:"activeBookId"`
	}
	if err := decode(w, r, &input); err != nil {
		return err
	}
	if input.Name != nil {
		*input.Name = strings.TrimSpace(*input.Name)
		if !validText(*input.Name, 1, 80) {
			return problem(http.StatusBadRequest, "name must contain 1–80 characters")
		}
	}
	if input.DailyGoal != nil && (*input.DailyGoal < 1 || *input.DailyGoal > 1000) {
		return problem(http.StatusBadRequest, "dailyGoal must be between 1 and 1000")
	}
	if input.ExamDate != nil && *input.ExamDate != "" {
		if _, err := time.Parse("2006-01-02", *input.ExamDate); err != nil {
			return problem(http.StatusBadRequest, "examDate must be YYYY-MM-DD or empty")
		}
	}
	tx, err := a.db.BeginTx(r.Context(), nil)
	if err != nil {
		return err
	}
	defer tx.Rollback()
	if input.ActiveBookID != nil {
		var exists int
		if err := tx.QueryRowContext(r.Context(), "SELECT COUNT(*) FROM books WHERE id=?", *input.ActiveBookID).Scan(&exists); err != nil {
			return err
		}
		if exists == 0 {
			return problem(http.StatusNotFound, "book not found")
		}
	}
	_, err = tx.ExecContext(r.Context(), `UPDATE users SET name=COALESCE(?,name),daily_goal=COALESCE(?,daily_goal),exam_date=COALESCE(?,exam_date),active_book_id=COALESCE(?,active_book_id) WHERE id=?`, input.Name, input.DailyGoal, input.ExamDate, input.ActiveBookID, u.ID)
	if err != nil {
		return err
	}
	updated, err := scanUser(tx.QueryRowContext(r.Context(), "SELECT "+userColumns+" FROM users u WHERE u.id=?", u.ID))
	if err != nil {
		return err
	}
	if err = tx.Commit(); err != nil {
		return err
	}
	return jsonResponse(w, http.StatusOK, updated)
}

func normalizeEmail(raw string) (string, error) {
	email := strings.ToLower(strings.TrimSpace(raw))
	addr, err := mail.ParseAddress(email)
	if err != nil || len(email) > 254 || addr.Address != email || addr.Name != "" {
		return "", errors.New("invalid email")
	}
	return email, nil
}

func validPassword(password string, min int) bool {
	return utf8.ValidString(password) && utf8.RuneCountInString(password) >= min && len(password) <= 72
}

func validText(value string, min, max int) bool {
	if !utf8.ValidString(value) || utf8.RuneCountInString(value) < min || utf8.RuneCountInString(value) > max {
		return false
	}
	for _, r := range value {
		if unicode.IsControl(r) && r != '\n' && r != '\t' {
			return false
		}
	}
	return true
}
