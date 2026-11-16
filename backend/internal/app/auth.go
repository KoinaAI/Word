package app

import (
	"database/sql"
	"errors"
	"net/http"
	"net/mail"
	"strconv"
	"strings"
	"time"
	"unicode/utf8"

	"golang.org/x/crypto/bcrypt"
)

func (a *App) guest(w http.ResponseWriter, r *http.Request) {
	if u := userFrom(r); u != nil {
		writeJSON(w, 200, u)
		return
	}
	if !a.limitAuth(w, r) {
		return
	}
	res, e := a.db.ExecContext(r.Context(), "INSERT INTO users(name,created_at) VALUES('学习者',?)", stamp(time.Now()))
	if e != nil {
		internal(w, e)
		return
	}
	id, _ := res.LastInsertId()
	if e = a.issueSession(w, r, id); e != nil {
		internal(w, e)
		return
	}
	u, e := a.getUser(r.Context(), id)
	if e != nil {
		internal(w, e)
		return
	}
	writeJSON(w, 201, u)
}
func validEmail(email string) bool {
	v, e := mail.ParseAddress(email)
	return e == nil && v.Address == email && len(email) <= 254 && strings.Contains(email, "@")
}
func (a *App) register(w http.ResponseWriter, r *http.Request) {
	if !a.limitAuth(w, r) {
		return
	}
	var req struct {
		Name     string `json:"name"`
		Email    string `json:"email"`
		Password string `json:"password"`
	}
	if !decode(w, r, &req) {
		return
	}
	req.Name = strings.TrimSpace(req.Name)
	req.Email = strings.ToLower(strings.TrimSpace(req.Email))
	if req.Name == "" || utf8.RuneCountInString(req.Name) > 40 || !validEmail(req.Email) || len(req.Password) < 8 || len(req.Password) > 72 {
		fail(w, 400, "姓名需为 1–40 字，邮箱需有效，密码需为 8–72 字节")
		return
	}
	existing := userFrom(r)
	if existing != nil && !existing.Guest {
		fail(w, 409, "当前已登录正式账户，请先退出后注册")
		return
	}
	hash, e := bcrypt.GenerateFromPassword([]byte(req.Password), bcrypt.DefaultCost)
	if e != nil {
		internal(w, e)
		return
	}
	tx, e := a.db.BeginTx(r.Context(), nil)
	if e != nil {
		internal(w, e)
		return
	}
	defer tx.Rollback()
	var id int64
	if existing != nil {
		id = existing.ID
		var result sql.Result
		result, e = tx.Exec("UPDATE users SET name=?,email=?,password_hash=?,guest=0 WHERE id=? AND guest=1", req.Name, req.Email, string(hash), id)
		if e == nil {
			n, _ := result.RowsAffected()
			if n != 1 {
				fail(w, 409, "访客账户已经完成注册，请重新登录")
				return
			}
		}
	} else {
		var result sql.Result
		result, e = tx.Exec("INSERT INTO users(name,email,password_hash,guest,created_at) VALUES(?,?,?,0,?)", req.Name, req.Email, string(hash), stamp(time.Now()))
		if e == nil {
			id, _ = result.LastInsertId()
		}
	}
	if e != nil {
		if strings.Contains(e.Error(), "UNIQUE") {
			fail(w, 409, "该邮箱已注册")
		} else {
			internal(w, e)
		}
		return
	}
	if e = tx.Commit(); e != nil {
		internal(w, e)
		return
	}
	if e = a.issueSession(w, r, id); e != nil {
		internal(w, e)
		return
	}
	u, e := a.getUser(r.Context(), id)
	if e != nil {
		internal(w, e)
		return
	}
	writeJSON(w, 201, u)
}
func (a *App) login(w http.ResponseWriter, r *http.Request) {
	if !a.limitAuth(w, r) {
		return
	}
	var req struct {
		Email    string `json:"email"`
		Password string `json:"password"`
	}
	if !decode(w, r, &req) {
		return
	}
	req.Email = strings.ToLower(strings.TrimSpace(req.Email))
	if !validEmail(req.Email) || len(req.Password) > 72 {
		fail(w, 401, "邮箱或密码不正确")
		return
	}
	var id int64
	var hash string
	e := a.db.QueryRowContext(r.Context(), "SELECT id,password_hash FROM users WHERE email=? AND guest=0", req.Email).Scan(&id, &hash)
	if e != nil && !errors.Is(e, sql.ErrNoRows) {
		internal(w, e)
		return
	}
	if errors.Is(e, sql.ErrNoRows) {
		bcrypt.CompareHashAndPassword([]byte("$2a$10$7EqJtq98hPqEX7fNZaFWoO5y1a7wNAak.gM7sUeaAK3FfCJO2k.Lu"), []byte(req.Password))
		fail(w, 401, "邮箱或密码不正确")
		return
	}
	if bcrypt.CompareHashAndPassword([]byte(hash), []byte(req.Password)) != nil {
		fail(w, 401, "邮箱或密码不正确")
		return
	}
	if e = a.issueSession(w, r, id); e != nil {
		internal(w, e)
		return
	}
	u, e := a.getUser(r.Context(), id)
	if e != nil {
		internal(w, e)
		return
	}
	writeJSON(w, 200, u)
}
func (a *App) logout(w http.ResponseWriter, r *http.Request) {
	if c, e := r.Cookie("word_session"); e == nil {
		if _, e = a.db.ExecContext(r.Context(), "DELETE FROM sessions WHERE token_hash=?", tokenHash(c.Value)); e != nil {
			internal(w, e)
			return
		}
	}
	http.SetCookie(w, &http.Cookie{Name: "word_session", Path: "/", HttpOnly: true, Secure: a.cfg.CookieSecure, SameSite: http.SameSiteLaxMode, MaxAge: -1})
	writeJSON(w, 200, map[string]bool{"ok": true})
}
func (a *App) me(w http.ResponseWriter, r *http.Request) { writeJSON(w, 200, userFrom(r)) }
func (a *App) updateMe(w http.ResponseWriter, r *http.Request) {
	var req struct {
		DailyGoal    *int    `json:"dailyGoal"`
		ExamDate     *string `json:"examDate"`
		ActiveBookID *int64  `json:"activeBookId"`
		Name         *string `json:"name"`
	}
	if !decode(w, r, &req) {
		return
	}
	u := userFrom(r)
	if u == nil {
		fail(w, http.StatusUnauthorized, "请先登录或开始访客体验")
		return
	}
	set := []string{}
	args := []any{}
	if req.DailyGoal != nil {
		if *req.DailyGoal < 1 || *req.DailyGoal > 500 {
			fail(w, 400, "每日目标需为 1–500")
			return
		}
		set = append(set, "daily_goal=?")
		args = append(args, *req.DailyGoal)
		u.DailyGoal = *req.DailyGoal
	}
	if req.ExamDate != nil {
		if *req.ExamDate != "" {
			d, e := time.Parse("2006-01-02", *req.ExamDate)
			if e != nil || d.Format("2006-01-02") != *req.ExamDate {
				fail(w, 400, "考试日期格式应为 YYYY-MM-DD")
				return
			}
		}
		set = append(set, "exam_date=?")
		args = append(args, *req.ExamDate)
		u.ExamDate = *req.ExamDate
	}
	if req.Name != nil {
		name := strings.TrimSpace(*req.Name)
		if name == "" || utf8.RuneCountInString(name) > 40 {
			fail(w, 400, "姓名需为 1–40 字")
			return
		}
		set = append(set, "name=?")
		args = append(args, name)
		u.Name = name
	}
	if req.ActiveBookID != nil {
		if *req.ActiveBookID < 0 {
			fail(w, 400, "词书编号无效")
			return
		}
		if *req.ActiveBookID > 0 {
			var exists int
			e := a.db.QueryRowContext(r.Context(), "SELECT 1 FROM books WHERE id=?", *req.ActiveBookID).Scan(&exists)
			if errors.Is(e, sql.ErrNoRows) {
				fail(w, 404, "词书不存在")
				return
			}
			if e != nil {
				internal(w, e)
				return
			}
		}
		set = append(set, "active_book_id=?")
		if *req.ActiveBookID == 0 {
			args = append(args, nil)
		} else {
			args = append(args, *req.ActiveBookID)
		}
		u.ActiveBookID = *req.ActiveBookID
	}
	if len(set) == 0 {
		writeJSON(w, 200, *u)
		return
	}
	args = append(args, u.ID)
	if _, e := a.db.ExecContext(r.Context(), "UPDATE users SET "+strings.Join(set, ",")+" WHERE id=?", args...); e != nil {
		internal(w, e)
		return
	}
	updated, e := a.getUser(r.Context(), u.ID)
	if e != nil {
		internal(w, e)
		return
	}
	writeJSON(w, 200, updated)
}
func pathID(w http.ResponseWriter, r *http.Request) (int64, bool) {
	id, e := strconv.ParseInt(r.PathValue("id"), 10, 64)
	if e != nil || id <= 0 {
		fail(w, 400, "编号无效")
		return 0, false
	}
	return id, true
}
