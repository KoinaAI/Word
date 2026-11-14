package app

import (
	"context"
	"database/sql"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"log/slog"
	"mime"
	"net/http"
	"os"
	"path/filepath"
	"strconv"
	"strings"
	"sync"
	"time"

	"golang.org/x/crypto/bcrypt"
)

// App owns the persistent database and HTTP handlers. Close it after HTTP shutdown.
type App struct {
	db        *sql.DB
	cfg       Config
	now       func() time.Time
	dummyHash []byte
	limiter   rateLimiter
}

// Open initializes schema and the administrator, failing closed on invalid initial credentials.
func Open(ctx context.Context, c Config) (*App, error) {
	db, err := openStore(ctx, c, time.Now().UTC())
	if err != nil {
		return nil, err
	}
	secret, err := newToken()
	if err != nil {
		db.Close()
		return nil, err
	}
	dummy, err := bcrypt.GenerateFromPassword([]byte(secret), bcrypt.DefaultCost)
	if err != nil {
		db.Close()
		return nil, err
	}
	c.AdminPassword = ""
	return &App{db: db, cfg: c, now: func() time.Time { return time.Now().UTC() }, dummyHash: dummy, limiter: rateLimiter{entries: make(map[string]rateEntry)}}, nil
}

// Close releases the SQLite connection after outstanding requests have finished.
func (a *App) Close() error { return a.db.Close() }

type endpoint func(http.ResponseWriter, *http.Request) error
type authenticatedEndpoint func(http.ResponseWriter, *http.Request, User) error

type apiError struct {
	status int
	text   string
}

func (e *apiError) Error() string           { return e.text }
func problem(status int, text string) error { return &apiError{status, text} }

func jsonResponse(w http.ResponseWriter, status int, value any) error {
	w.Header().Set("Content-Type", "application/json; charset=utf-8")
	w.WriteHeader(status)
	return json.NewEncoder(w).Encode(value)
}

func ok(w http.ResponseWriter) error {
	return jsonResponse(w, http.StatusOK, map[string]bool{"ok": true})
}

func decode(w http.ResponseWriter, r *http.Request, dst any) error {
	media, _, err := mime.ParseMediaType(r.Header.Get("Content-Type"))
	if err != nil || media != "application/json" {
		return problem(http.StatusUnsupportedMediaType, "Content-Type must be application/json")
	}
	decoder := json.NewDecoder(http.MaxBytesReader(w, r.Body, 32<<20))
	decoder.DisallowUnknownFields()
	if err := decoder.Decode(dst); err != nil {
		var tooLarge *http.MaxBytesError
		if errors.As(err, &tooLarge) {
			return problem(http.StatusRequestEntityTooLarge, "request body is too large")
		}
		return problem(http.StatusBadRequest, "invalid JSON body")
	}
	if err := decoder.Decode(new(any)); err != io.EOF {
		return problem(http.StatusBadRequest, "body must contain one JSON object")
	}
	return nil
}

func (a *App) wrap(fn endpoint) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		if err := fn(w, r); err != nil {
			var public *apiError
			if errors.As(err, &public) {
				_ = jsonResponse(w, public.status, map[string]string{"error": public.text})
				return
			}
			slog.Error("request failed", "method", r.Method, "path", r.URL.Path, "error", err)
			_ = jsonResponse(w, http.StatusInternalServerError, map[string]string{"error": "internal server error"})
		}
	}
}

func (a *App) require(admin bool, fn authenticatedEndpoint) http.HandlerFunc {
	return a.wrap(func(w http.ResponseWriter, r *http.Request) error {
		u, err := a.currentUser(r)
		if err != nil {
			return err
		}
		if admin && u.Role != "admin" {
			return problem(http.StatusForbidden, "administrator access required")
		}
		return fn(w, r, u)
	})
}

// Handler exposes the contract API and, when configured, a static SPA with safe fallback routing.
func (a *App) Handler() http.Handler {
	mux := http.NewServeMux()
	mux.HandleFunc("GET /api/health", a.wrap(a.health))
	mux.HandleFunc("GET /health", a.wrap(a.health))
	mux.HandleFunc("POST /api/auth/guest", a.authRate(a.guest))
	mux.HandleFunc("POST /api/auth/register", a.authRate(a.register))
	mux.HandleFunc("POST /api/auth/login", a.authRate(a.login))
	mux.HandleFunc("POST /api/auth/logout", a.wrap(a.logout))
	mux.HandleFunc("GET /api/me", a.require(false, a.me))
	mux.HandleFunc("PATCH /api/me", a.require(false, a.patchMe))
	mux.HandleFunc("GET /api/books", a.require(false, a.books))
	mux.HandleFunc("GET /api/books/{id}", a.require(false, a.bookDetail))
	mux.HandleFunc("GET /api/study", a.require(false, a.study))
	mux.HandleFunc("POST /api/study/answer", a.require(false, a.answer))
	mux.HandleFunc("GET /api/favorites", a.require(false, a.favorites))
	mux.HandleFunc("POST /api/favorites/{id}", a.require(false, a.setFavorite))
	mux.HandleFunc("GET /api/stats", a.require(false, a.stats))
	mux.HandleFunc("GET /api/admin/stats", a.require(true, a.adminStats))
	mux.HandleFunc("GET /api/admin/books", a.require(true, a.adminBooks))
	mux.HandleFunc("POST /api/admin/books", a.require(true, a.createBook))
	mux.HandleFunc("PATCH /api/admin/books/{id}", a.require(true, a.patchBook))
	mux.HandleFunc("DELETE /api/admin/books/{id}", a.require(true, a.deleteBook))
	mux.HandleFunc("POST /api/admin/books/{id}/words", a.require(true, a.importWords))
	mux.HandleFunc("DELETE /api/admin/words/{id}", a.require(true, a.deleteWord))
	mux.HandleFunc("GET /api/admin/users", a.require(true, a.adminUsers))
	mux.HandleFunc("GET /api/admin/navigation", a.require(true, a.navigation))
	mux.HandleFunc("PUT /api/admin/navigation", a.require(true, a.putNavigation))
	mux.HandleFunc("/api", a.wrap(func(w http.ResponseWriter, r *http.Request) error {
		return problem(http.StatusNotFound, "API route not found")
	}))
	mux.HandleFunc("/api/", a.wrap(func(w http.ResponseWriter, r *http.Request) error {
		// Keep errors JSON even when a known endpoint receives an unsupported method.
		for _, method := range []string{"GET", "POST", "PATCH", "PUT", "DELETE"} {
			probe := r.Clone(r.Context())
			probe.Method = method
			_, pattern := mux.Handler(probe)
			if pattern != "" && pattern != "/api/" {
				return problem(http.StatusMethodNotAllowed, "method not allowed")
			}
		}
		return problem(http.StatusNotFound, "API route not found")
	}))
	mux.HandleFunc("/", a.serveSPA)
	return a.security(mux)
}

func (a *App) health(w http.ResponseWriter, r *http.Request) error {
	if err := a.db.PingContext(r.Context()); err != nil {
		return problem(http.StatusServiceUnavailable, "database unavailable")
	}
	return jsonResponse(w, http.StatusOK, map[string]string{"status": "ok"})
}

func (a *App) security(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("X-Content-Type-Options", "nosniff")
		w.Header().Set("Referrer-Policy", "same-origin")
		if strings.HasPrefix(r.URL.Path, "/api") {
			w.Header().Set("Cache-Control", "no-store")
		}
		origin := r.Header.Get("Origin")
		allowed := a.allowedOrigin(r, origin)
		mutation := r.Method != "GET" && r.Method != "HEAD" && r.Method != "OPTIONS"
		if (mutation || r.Method == "OPTIONS") && ((origin != "" && !allowed) || (origin == "" && r.Header.Get("Sec-Fetch-Site") == "cross-site")) {
			_ = jsonResponse(w, http.StatusForbidden, map[string]string{"error": "cross-origin request rejected"})
			return
		}
		if origin != "" {
			w.Header().Add("Vary", "Origin")
			if allowed {
				w.Header().Set("Access-Control-Allow-Origin", origin)
				w.Header().Set("Access-Control-Allow-Credentials", "true")
			}
		}
		if r.Method == "OPTIONS" {
			w.Header().Set("Access-Control-Allow-Methods", "GET, POST, PATCH, PUT, DELETE, OPTIONS")
			w.Header().Set("Access-Control-Allow-Headers", "Content-Type")
			w.WriteHeader(http.StatusNoContent)
			return
		}
		next.ServeHTTP(w, r)
	})
}

func (a *App) allowedOrigin(r *http.Request, origin string) bool {
	u, err := parseOrigin(origin)
	if err != nil {
		return false
	}
	if a.cfg.DevOrigin != "" && !a.cfg.CookieSecure && origin == a.cfg.DevOrigin {
		return true
	}
	scheme := "http"
	if r.TLS != nil || a.cfg.CookieSecure {
		scheme = "https"
	}
	return u.Scheme == scheme && strings.EqualFold(u.Host, r.Host)
}

func (a *App) serveSPA(w http.ResponseWriter, r *http.Request) {
	if (r.Method != "GET" && r.Method != "HEAD") || a.cfg.WebDir == "" || r.URL.Path == "/api" {
		_ = jsonResponse(w, http.StatusNotFound, map[string]string{"error": "not found"})
		return
	}
	// os.Root prevents symlinks and path traversal from exposing files outside WEB_DIR.
	root, err := os.OpenRoot(a.cfg.WebDir)
	if err != nil {
		_ = jsonResponse(w, http.StatusServiceUnavailable, map[string]string{"error": "web assets unavailable"})
		return
	}
	defer root.Close()
	name := strings.TrimPrefix(r.URL.Path, "/")
	if name == "" {
		name = "index.html"
	}
	for _, part := range strings.Split(name, "/") {
		if strings.HasPrefix(part, ".") || strings.Contains(part, "\\") {
			http.NotFound(w, r)
			return
		}
	}
	f, err := root.Open(name)
	if err != nil && errors.Is(err, os.ErrNotExist) && filepath.Ext(name) == "" {
		f, err = root.Open("index.html")
		name = "index.html"
	}
	if err != nil {
		http.NotFound(w, r)
		return
	}
	defer f.Close()
	info, err := f.Stat()
	if err != nil || !info.Mode().IsRegular() {
		http.NotFound(w, r)
		return
	}
	if name == "index.html" {
		w.Header().Set("Cache-Control", "no-cache")
	}
	http.ServeContent(w, r, name, info.ModTime(), f)
}

func pathID(r *http.Request) (int64, error) {
	id, err := strconv.ParseInt(r.PathValue("id"), 10, 64)
	if err != nil || id < 1 {
		return 0, problem(http.StatusBadRequest, "invalid id")
	}
	return id, nil
}

type rateEntry struct {
	count int
	until time.Time
}
type rateLimiter struct {
	mu      sync.Mutex
	entries map[string]rateEntry
}

func (l *rateLimiter) allow(key string, now time.Time) bool {
	l.mu.Lock()
	defer l.mu.Unlock()
	entry := l.entries[key]
	if !now.Before(entry.until) {
		if len(l.entries) >= 8192 {
			for k, v := range l.entries {
				if !now.Before(v.until) {
					delete(l.entries, k)
				}
			}
			if len(l.entries) >= 8192 {
				return false
			}
		}
		entry = rateEntry{until: now.Add(time.Minute)}
	}
	entry.count++
	l.entries[key] = entry
	return entry.count <= 20
}

func (a *App) authRate(fn endpoint) http.HandlerFunc {
	return a.wrap(func(w http.ResponseWriter, r *http.Request) error {
		if !a.limiter.allow(remoteIP(r.RemoteAddr), a.now()) {
			w.Header().Set("Retry-After", "60")
			return problem(http.StatusTooManyRequests, "too many authentication attempts; try again in a minute")
		}
		return fn(w, r)
	})
}

func requireChanged(result sql.Result, err error, label string) error {
	if err != nil {
		return err
	}
	n, err := result.RowsAffected()
	if err != nil {
		return err
	}
	if n == 0 {
		return problem(http.StatusNotFound, fmt.Sprintf("%s not found", label))
	}
	return nil
}
