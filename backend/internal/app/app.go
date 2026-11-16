// Package app provides the persistent vocabulary API and its same-origin SPA host.
package app

import (
	"context"
	"crypto/rand"
	"crypto/sha256"
	"database/sql"
	"embed"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"log/slog"
	"net"
	"net/http"
	"net/netip"
	"net/url"
	"os"
	"path/filepath"
	"strconv"
	"strings"
	"sync"
	"time"

	"golang.org/x/crypto/bcrypt"
	_ "modernc.org/sqlite"
)

//go:embed schema.sql seed_data.json
var assets embed.FS

// Config defines persistence, SPA assets and explicit security settings.
type Config struct {
	DBPath         string
	WebDir         string
	AdminEmail     string
	AdminPassword  string
	CookieSecure   bool
	DevOrigin      string
	TrustedProxies string
}

// App owns one SQLite pool and the HTTP handler. Close it after HTTP shutdown.
type App struct {
	db             *sql.DB
	cfg            Config
	mux            *http.ServeMux
	limiter        authLimiter
	trustedProxies []netip.Prefix
}

type rateEntry struct {
	count int
	until time.Time
}
type authLimiter struct {
	mu      sync.Mutex
	entries map[string]rateEntry
}

// New opens and initializes a durable store. An admin is created only with an explicit password.
func New(cfg Config) (*App, error) {
	if cfg.DBPath == "" {
		cfg.DBPath = "data/word.db"
	}
	if cfg.AdminEmail == "" {
		cfg.AdminEmail = "admin@word.local"
	}
	cfg.AdminEmail = strings.ToLower(strings.TrimSpace(cfg.AdminEmail))
	if cfg.AdminPassword != "" && !validEmail(cfg.AdminEmail) {
		return nil, errors.New("ADMIN_EMAIL must be a valid email address")
	}
	if cfg.DevOrigin != "" {
		u, e := url.Parse(cfg.DevOrigin)
		if e != nil || u.Scheme == "" || u.Host == "" || u.Path != "" {
			return nil, errors.New("DEV_ORIGIN must be an origin without a path")
		}
	}
	if cfg.DBPath != ":memory:" {
		absolute, err := filepath.Abs(cfg.DBPath)
		if err != nil {
			return nil, err
		}
		cfg.DBPath = absolute
		if err := os.MkdirAll(filepath.Dir(cfg.DBPath), 0700); err != nil {
			return nil, err
		}
	}
	dsn := cfg.DBPath + "?_pragma=foreign_keys(1)&_pragma=busy_timeout(5000)&_pragma=journal_mode(WAL)"
	if cfg.DBPath != ":memory:" {
		u := url.URL{Scheme: "file", Path: cfg.DBPath}
		q := url.Values{}
		q.Add("_pragma", "foreign_keys(1)")
		q.Add("_pragma", "busy_timeout(5000)")
		q.Add("_pragma", "journal_mode(WAL)")
		u.RawQuery = q.Encode()
		dsn = u.String()
	}
	trusted, err := parseTrustedProxies(cfg.TrustedProxies)
	if err != nil {
		return nil, err
	}
	db, err := sql.Open("sqlite", dsn)
	if err != nil {
		return nil, err
	}
	db.SetMaxOpenConns(1)
	a := &App{db: db, cfg: cfg, mux: http.NewServeMux(), limiter: authLimiter{entries: map[string]rateEntry{}}, trustedProxies: trusted}
	if err = a.initialize(); err != nil {
		db.Close()
		return nil, err
	}
	a.routes()
	return a, nil
}

// Close closes the database after all active HTTP requests finish.
func (a *App) Close() error { return a.db.Close() }

func (a *App) initialize() error {
	if err := a.migrate(); err != nil {
		return err
	}
	tx, err := a.db.Begin()
	if err != nil {
		return err
	}
	defer tx.Rollback()
	var done string
	err = tx.QueryRow("SELECT value FROM metadata WHERE key='seed_v1'").Scan(&done)
	if errors.Is(err, sql.ErrNoRows) {
		var seed []struct {
			Book
			Words []Word `json:"words"`
		}
		raw, _ := assets.ReadFile("seed_data.json")
		if err = json.Unmarshal(raw, &seed); err != nil {
			return err
		}
		for _, b := range seed {
			res, e := tx.Exec("INSERT INTO books(title,subtitle,description,category,color,created_at) VALUES(?,?,?,?,?,?)", b.Title, b.Subtitle, b.Description, b.Category, b.Color, stamp(time.Now()))
			if e != nil {
				return e
			}
			id, _ := res.LastInsertId()
			for _, w := range b.Words {
				if _, e = tx.Exec("INSERT INTO words(book_id,text,phonetic,meaning,example,example_meaning) VALUES(?,?,?,?,?,?)", id, w.Text, w.Phonetic, w.Meaning, w.Example, w.ExampleMeaning); e != nil {
					return e
				}
			}
		}
		for _, n := range defaultNavigation() {
			if _, e := tx.Exec("INSERT INTO navigation(id,label,path,icon,enabled,sort_order) VALUES(?,?,?,?,?,?)", n.ID, n.Label, n.Path, n.Icon, n.Enabled, n.SortOrder); e != nil {
				return e
			}
		}
		if _, err = tx.Exec("INSERT INTO metadata(key,value) VALUES('seed_v1','done')"); err != nil {
			return err
		}
	} else if err != nil {
		return err
	}
	if a.cfg.AdminPassword != "" {
		if len(a.cfg.AdminPassword) < 12 || len(a.cfg.AdminPassword) > 72 {
			return errors.New("ADMIN_PASSWORD must contain 12 to 72 bytes")
		}
		var role string
		err = tx.QueryRow("SELECT role FROM users WHERE email=?", a.cfg.AdminEmail).Scan(&role)
		if errors.Is(err, sql.ErrNoRows) {
			hash, e := bcrypt.GenerateFromPassword([]byte(a.cfg.AdminPassword), bcrypt.DefaultCost)
			if e != nil {
				return e
			}
			if _, err = tx.Exec("INSERT INTO users(name,email,password_hash,role,guest,created_at) VALUES(?,?,?,'admin',0,?)", "管理员", a.cfg.AdminEmail, string(hash), stamp(time.Now())); err != nil {
				return err
			}
		} else if err != nil {
			return err
		} else if role != "admin" {
			return errors.New("ADMIN_EMAIL belongs to a non-admin account; choose a different initialization email")
		}
	}
	return tx.Commit()
}

func defaultNavigation() []Navigation {
	return []Navigation{{"overview", "站点概览", "/admin", "chart-column", true, 0}, {"books", "词书管理", "/admin/books", "book-open", true, 1}, {"users", "用户管理", "/admin/users", "persons", true, 2}, {"navigation", "导航设置", "/admin/navigation", "sliders", true, 3}}
}

func (a *App) routes() {
	a.mux.HandleFunc("GET /api/health", func(w http.ResponseWriter, r *http.Request) {
		if err := a.db.PingContext(r.Context()); err != nil {
			fail(w, 503, "数据库暂时不可用")
			return
		}
		writeJSON(w, 200, map[string]string{"status": "ok"})
	})
	a.mux.HandleFunc("POST /api/auth/guest", a.guest)
	a.mux.HandleFunc("POST /api/auth/register", a.register)
	a.mux.HandleFunc("POST /api/auth/login", a.login)
	a.mux.HandleFunc("POST /api/auth/logout", a.logout)
	a.mux.HandleFunc("GET /api/me", a.auth(a.me, false))
	a.mux.HandleFunc("PATCH /api/me", a.auth(a.updateMe, false))
	a.mux.HandleFunc("GET /api/books", a.books)
	a.mux.HandleFunc("GET /api/books/{id}", a.bookDetail)
	a.mux.HandleFunc("GET /api/study", a.auth(a.study, false))
	a.mux.HandleFunc("POST /api/study/answer", a.auth(a.answer, false))
	a.mux.HandleFunc("GET /api/stats", a.auth(a.stats, false))
	a.mux.HandleFunc("GET /api/favorites", a.auth(a.favorites, false))
	a.mux.HandleFunc("POST /api/favorites/{id}", a.auth(a.favorite, false))
	a.mux.HandleFunc("GET /api/admin/stats", a.auth(a.adminStats, true))
	a.mux.HandleFunc("GET /api/admin/books", a.auth(a.adminBooks, true))
	a.mux.HandleFunc("POST /api/admin/books", a.auth(a.createBook, true))
	a.mux.HandleFunc("PATCH /api/admin/books/{id}", a.auth(a.updateBook, true))
	a.mux.HandleFunc("DELETE /api/admin/books/{id}", a.auth(a.deleteBook, true))
	a.mux.HandleFunc("POST /api/admin/books/{id}/words", a.auth(a.importWords, true))
	a.mux.HandleFunc("DELETE /api/admin/words/{id}", a.auth(a.deleteWord, true))
	a.mux.HandleFunc("GET /api/admin/users", a.auth(a.adminUsers, true))
	a.mux.HandleFunc("GET /api/admin/navigation", a.auth(a.navigation, true))
	a.mux.HandleFunc("PUT /api/admin/navigation", a.auth(a.saveNavigation, true))
	a.mux.HandleFunc("/api/", func(w http.ResponseWriter, r *http.Request) { fail(w, 404, "接口不存在") })
	a.mux.HandleFunc("/", a.spa)
}

// Handler applies origin checks and authentication context before routing requests.
func (a *App) Handler() http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("X-Content-Type-Options", "nosniff")
		w.Header().Set("Referrer-Policy", "strict-origin-when-cross-origin")
		w.Header().Set("X-Frame-Options", "DENY")
		if strings.HasPrefix(r.URL.Path, "/api/") {
			w.Header().Set("Cache-Control", "no-store")
		}
		origin := r.Header.Get("Origin")
		if a.cfg.DevOrigin != "" && origin == a.cfg.DevOrigin {
			w.Header().Set("Access-Control-Allow-Origin", origin)
			w.Header().Set("Access-Control-Allow-Credentials", "true")
			w.Header().Set("Vary", "Origin")
			w.Header().Set("Access-Control-Allow-Methods", "GET,POST,PATCH,PUT,DELETE,OPTIONS")
			w.Header().Set("Access-Control-Allow-Headers", "Content-Type, If-Match, X-Word-User-ID")
			w.Header().Set("Access-Control-Expose-Headers", "ETag, Allow, X-Word-User-ID")
			if r.Method == http.MethodOptions {
				w.WriteHeader(204)
				return
			}
		}
		if r.Method != "GET" && r.Method != "HEAD" && r.Method != "OPTIONS" {
			valid := origin == ""
			if origin != "" {
				u, e := url.Parse(origin)
				valid = e == nil && u.Host == r.Host && (u.Scheme == "http" || u.Scheme == "https") && u.Path == ""
				valid = valid || (a.cfg.DevOrigin != "" && origin == a.cfg.DevOrigin)
			}
			if !valid || (origin == "" && r.Header.Get("Sec-Fetch-Site") == "cross-site") {
				fail(w, 403, "请求来源不受信任")
				return
			}
		}
		// Static resources and the health probe need no user lookup, so a busy
		// learning transaction cannot hold up cached assets or extra auth reads.
		if strings.HasPrefix(r.URL.Path, "/api/") && r.URL.Path != "/api/health" {
			u, expires, lookupErr := a.sessionUser(r)
			if lookupErr != nil {
				internal(w, lookupErr)
				return
			}
			if u != nil {
				if err := a.renewSession(w, r, expires); err != nil {
					internal(w, err)
					return
				}
				r = r.WithContext(context.WithValue(r.Context(), userKey{}, u))
			}
		}
		if id := strings.TrimSpace(r.Header.Get("X-Word-User-ID")); id != "" && r.Method != http.MethodGet && r.Method != http.MethodHead && r.Method != http.MethodOptions {
			expected, parseErr := strconv.ParseInt(id, 10, 64)
			actual := currentID(r)
			if parseErr != nil || actual == 0 || expected != actual {
				writeJSON(w, http.StatusConflict, map[string]string{"error": "账号已变更，请重新载入页面", "code": "SESSION_CHANGED"})
				return
			}
		}
		defer func() {
			if p := recover(); p != nil {
				slog.Error("request panic", "error", p)
				fail(w, 500, "服务暂时不可用")
			}
		}()
		a.mux.ServeHTTP(w, r)
	})
}

type userKey struct{}

func userFrom(r *http.Request) *User { u, _ := r.Context().Value(userKey{}).(*User); return u }
func (a *App) auth(next http.HandlerFunc, admin bool) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		u := userFrom(r)
		if u == nil {
			fail(w, 401, "请先登录或开始访客体验")
			return
		}
		if admin && u.Role != "admin" {
			fail(w, 403, "需要管理员权限")
			return
		}
		next(w, r)
	}
}
func (a *App) currentUser(r *http.Request) *User {
	u, _, _ := a.sessionUser(r)
	return u
}

func (a *App) sessionUser(r *http.Request) (*User, string, error) {
	c, e := r.Cookie("word_session")
	if e != nil || len(c.Value) != 64 {
		return nil, "", nil
	}
	u := User{}
	var expires string
	e = a.db.QueryRowContext(r.Context(), `SELECT u.id,u.name,COALESCE(u.email,''),u.role,u.guest,u.daily_goal,u.exam_date,COALESCE(u.active_book_id,0),s.expires_at FROM users u JOIN sessions s ON s.user_id=u.id WHERE s.token_hash=? AND s.expires_at>?`, tokenHash(c.Value), stamp(time.Now())).Scan(&u.ID, &u.Name, &u.Email, &u.Role, &u.Guest, &u.DailyGoal, &u.ExamDate, &u.ActiveBookID, &expires)
	if errors.Is(e, sql.ErrNoRows) {
		return nil, "", nil
	}
	if e != nil {
		return nil, "", e
	}
	return &u, expires, nil
}

// renewSession gives active visitors a recoverable identity without writing on
// every read. The original token remains valid; only its expiry is extended.
func (a *App) renewSession(w http.ResponseWriter, r *http.Request, expires string) error {
	now := time.Now()
	if expires > stamp(now.Add(7*24*time.Hour)) {
		return nil
	}
	cookie, err := r.Cookie("word_session")
	if err != nil {
		return err
	}
	result, err := a.db.ExecContext(r.Context(), "UPDATE sessions SET expires_at=? WHERE token_hash=? AND expires_at=?", stamp(now.Add(30*24*time.Hour)), tokenHash(cookie.Value), expires)
	if err != nil {
		return err
	}
	count, err := result.RowsAffected()
	if err != nil {
		return err
	}
	if count == 1 {
		a.setSessionCookie(w, cookie.Value)
	}
	return nil
}

func (a *App) setSessionCookie(w http.ResponseWriter, raw string) {
	http.SetCookie(w, &http.Cookie{Name: "word_session", Value: raw, Path: "/", HttpOnly: true, Secure: a.cfg.CookieSecure, SameSite: http.SameSiteLaxMode, MaxAge: 30 * 24 * 60 * 60})
}

func (a *App) getUser(ctx context.Context, id int64) (User, error) {
	u := User{}
	err := a.db.QueryRowContext(ctx, "SELECT id,name,COALESCE(email,''),role,guest,daily_goal,exam_date,COALESCE(active_book_id,0) FROM users WHERE id=?", id).Scan(&u.ID, &u.Name, &u.Email, &u.Role, &u.Guest, &u.DailyGoal, &u.ExamDate, &u.ActiveBookID)
	return u, err
}
func (a *App) issueSession(w http.ResponseWriter, r *http.Request, id int64) error {
	token := make([]byte, 32)
	if _, e := rand.Read(token); e != nil {
		return e
	}
	raw := hex.EncodeToString(token)
	tx, e := a.db.BeginTx(r.Context(), nil)
	if e != nil {
		return e
	}
	defer tx.Rollback()
	if old, e := r.Cookie("word_session"); e == nil {
		if _, e = tx.Exec("DELETE FROM sessions WHERE token_hash=?", tokenHash(old.Value)); e != nil {
			return e
		}
	}
	now := time.Now()
	if _, e = tx.Exec("DELETE FROM sessions WHERE expires_at<=?", stamp(now)); e != nil {
		return e
	}
	if _, e = tx.Exec("INSERT INTO sessions(token_hash,user_id,expires_at) VALUES(?,?,?)", tokenHash(raw), id, stamp(now.Add(30*24*time.Hour))); e != nil {
		return e
	}
	if e = tx.Commit(); e != nil {
		return e
	}
	a.setSessionCookie(w, raw)
	return nil
}
func tokenHash(raw string) string {
	sum := sha256.Sum256([]byte(raw))
	return hex.EncodeToString(sum[:])
}
func stamp(t time.Time) string { return t.UTC().Format("2006-01-02T15:04:05.000Z") }
func writeJSON(w http.ResponseWriter, status int, v any) {
	w.Header().Set("Content-Type", "application/json; charset=utf-8")
	w.WriteHeader(status)
	if e := json.NewEncoder(w).Encode(v); e != nil {
		slog.Error("encode response", "error", e)
	}
}
func fail(w http.ResponseWriter, status int, message string) {
	writeJSON(w, status, map[string]string{"error": message})
}
func internal(w http.ResponseWriter, err error) {
	slog.Error("database operation", "error", err)
	fail(w, 500, "操作未完成，请稍后重试")
}
func decode(w http.ResponseWriter, r *http.Request, v any) bool {
	if ct := r.Header.Get("Content-Type"); !strings.HasPrefix(ct, "application/json") {
		fail(w, 415, "请使用 application/json")
		return false
	}
	r.Body = http.MaxBytesReader(w, r.Body, 8<<20)
	d := json.NewDecoder(r.Body)
	d.DisallowUnknownFields()
	if e := d.Decode(v); e != nil {
		fail(w, 400, "请求数据格式错误或包含不支持的字段")
		return false
	}
	if e := d.Decode(&struct{}{}); e != io.EOF {
		fail(w, 400, "请求必须只包含一个 JSON 对象")
		return false
	}
	return true
}
func parseTrustedProxies(raw string) ([]netip.Prefix, error) {
	var prefixes []netip.Prefix
	for _, value := range strings.Split(raw, ",") {
		value = strings.TrimSpace(value)
		if value == "" {
			continue
		}
		prefix, err := netip.ParsePrefix(value)
		if err != nil {
			addr, addrErr := netip.ParseAddr(value)
			if addrErr != nil {
				return nil, fmt.Errorf("invalid TRUSTED_PROXIES address %q", value)
			}
			prefix = netip.PrefixFrom(addr, addr.BitLen())
		}
		prefixes = append(prefixes, prefix.Masked())
	}
	return prefixes, nil
}

func (a *App) trustedProxy(addr netip.Addr) bool {
	for _, prefix := range a.trustedProxies {
		if prefix.Contains(addr) {
			return true
		}
	}
	return false
}

// clientAddress strips only explicitly trusted hops, working from the direct
// peer backwards. A caller outside that boundary cannot select its own bucket.
func (a *App) clientAddress(r *http.Request) string {
	host, _, err := net.SplitHostPort(r.RemoteAddr)
	if err != nil {
		host = r.RemoteAddr
	}
	peer, err := netip.ParseAddr(host)
	if err != nil {
		return host
	}
	peer = peer.Unmap()
	if !a.trustedProxy(peer) {
		return peer.String()
	}
	chain := strings.Split(r.Header.Get("X-Forwarded-For"), ",")
	for index := len(chain) - 1; index >= 0; index-- {
		if !a.trustedProxy(peer) {
			break
		}
		next, parseErr := netip.ParseAddr(strings.TrimSpace(chain[index]))
		if parseErr != nil {
			return host
		}
		peer = next.Unmap()
	}
	return peer.String()
}

func (a *App) limitAuth(w http.ResponseWriter, r *http.Request) bool {
	host := a.clientAddress(r)
	now := time.Now()
	a.limiter.mu.Lock()
	defer a.limiter.mu.Unlock()
	if len(a.limiter.entries) > 10000 {
		for k, v := range a.limiter.entries {
			if !v.until.After(now) {
				delete(a.limiter.entries, k)
			}
		}
		if len(a.limiter.entries) > 10000 {
			w.Header().Set("Retry-After", "60")
			fail(w, 429, "请求过于频繁，请稍后再试")
			return false
		}
	}
	entry := a.limiter.entries[host]
	if !entry.until.After(now) {
		entry = rateEntry{until: now.Add(5 * time.Minute)}
	}
	entry.count++
	a.limiter.entries[host] = entry
	if entry.count > 30 {
		w.Header().Set("Retry-After", fmt.Sprint(int(time.Until(entry.until).Seconds())+1))
		fail(w, 429, "请求过于频繁，请稍后再试")
		return false
	}
	return true
}
func (a *App) spa(w http.ResponseWriter, r *http.Request) {
	if r.Method != "GET" && r.Method != "HEAD" {
		fail(w, 405, "请求方法不支持")
		return
	}
	if a.cfg.WebDir == "" {
		fail(w, 404, "前端尚未构建")
		return
	}
	clean := filepath.Clean("/" + r.URL.Path)
	target := filepath.Join(a.cfg.WebDir, clean)
	st, e := os.Stat(target)
	if e == nil && !st.IsDir() {
		if strings.HasPrefix(clean, "/assets/") {
			w.Header().Set("Cache-Control", "public, max-age=31536000, immutable")
		}
		http.ServeFile(w, r, target)
		return
	}
	if filepath.Ext(clean) != "" {
		http.NotFound(w, r)
		return
	}
	w.Header().Set("Cache-Control", "no-cache")
	http.ServeFile(w, r, filepath.Join(a.cfg.WebDir, "index.html"))
}
