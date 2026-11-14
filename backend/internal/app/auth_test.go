package app

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"path/filepath"
	"strings"
	"testing"
	"time"
)

const testPassword = "test-only-long-password"

func testApp(t *testing.T) *App {
	t.Helper()
	a, err := Open(context.Background(), Config{DBPath: filepath.Join(t.TempDir(), "test.db"), AdminEmail: "admin@word.local", AdminPassword: testPassword})
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = a.Close() })
	a.now = func() time.Time { return time.Date(2026, 11, 14, 9, 0, 0, 0, time.UTC) }
	return a
}

func request(t *testing.T, a *App, method, path, body string, cookie *http.Cookie, origin string) *httptest.ResponseRecorder {
	t.Helper()
	r := httptest.NewRequest(method, "http://word.test"+path, strings.NewReader(body))
	r.Header.Set("Content-Type", "application/json")
	if cookie != nil {
		r.AddCookie(cookie)
	}
	if origin != "" {
		r.Header.Set("Origin", origin)
	}
	w := httptest.NewRecorder()
	a.Handler().ServeHTTP(w, r)
	return w
}

func expectStatus(t *testing.T, w *httptest.ResponseRecorder, code int) {
	t.Helper()
	if w.Code != code {
		t.Fatalf("status=%d, want %d: %s", w.Code, code, w.Body.String())
	}
}

func responseUser(t *testing.T, w *httptest.ResponseRecorder) User {
	t.Helper()
	expectStatus(t, w, http.StatusOK)
	var u User
	if err := json.Unmarshal(w.Body.Bytes(), &u); err != nil {
		t.Fatal(err)
	}
	return u
}

func guestSession(t *testing.T, a *App) (*http.Cookie, User) {
	t.Helper()
	w := request(t, a, "POST", "/api/auth/guest", "{}", nil, "")
	u := responseUser(t, w)
	return w.Result().Cookies()[0], u
}

func TestAuthLifecycleAndIsolation(t *testing.T) {
	a := testApp(t)
	expectStatus(t, request(t, a, "GET", "/api/me", "", nil, ""), 401)
	cookie, guest := guestSession(t, a)
	if !guest.Guest || guest.Role != "user" || !cookie.HttpOnly || cookie.SameSite != http.SameSiteLaxMode || cookie.Secure {
		t.Fatalf("unexpected guest or cookie: %+v %+v", guest, cookie)
	}
	if got := responseUser(t, request(t, a, "POST", "/api/auth/guest", "{}", cookie, "")); got.ID != guest.ID {
		t.Fatal("guest endpoint replaced an existing session")
	}
	otherCookie, other := guestSession(t, a)
	if other.ID == guest.ID {
		t.Fatal("guests share identity")
	}
	expectStatus(t, request(t, a, "PATCH", "/api/me", `{"dailyGoal":37,"examDate":"2027-06-01"}`, cookie, ""), 200)
	if got := responseUser(t, request(t, a, "GET", "/api/me", "", otherCookie, "")); got.DailyGoal != 20 {
		t.Fatal("profile mutation leaked across users")
	}
	w := request(t, a, "POST", "/api/auth/register", `{"name":"Alice","email":"ALICE@example.com","password":"unique-test-password"}`, cookie, "http://word.test")
	registered := responseUser(t, w)
	if registered.ID != guest.ID || registered.Guest || registered.Email != "alice@example.com" || registered.DailyGoal != 37 {
		t.Fatalf("guest conversion did not preserve identity/profile: %+v", registered)
	}
	registeredCookie := w.Result().Cookies()[0]
	expectStatus(t, request(t, a, "GET", "/api/me", "", cookie, ""), 401)
	expectStatus(t, request(t, a, "POST", "/api/auth/register", `{"name":"Other","email":"alice@example.com","password":"unique-test-password"}`, otherCookie, ""), 409)
	expectStatus(t, request(t, a, "POST", "/api/auth/login", `{"email":"alice@example.com","password":"wrong"}`, nil, ""), 401)
	w = request(t, a, "POST", "/api/auth/login", `{"email":"alice@example.com","password":"unique-test-password"}`, nil, "")
	if responseUser(t, w).ID != guest.ID {
		t.Fatal("login changed user identity")
	}
	loginCookie := w.Result().Cookies()[0]
	expectStatus(t, request(t, a, "POST", "/api/auth/logout", "{}", loginCookie, ""), 200)
	expectStatus(t, request(t, a, "GET", "/api/me", "", loginCookie, ""), 401)
	// bcrypt compares only 72 bytes; reject longer inputs rather than accepting an appended suffix.
	longPassword := strings.Repeat("a", 72)
	expectStatus(t, request(t, a, "POST", "/api/auth/register", `{"name":"Long","email":"long@example.com","password":"`+longPassword+`"}`, otherCookie, ""), 200)
	expectStatus(t, request(t, a, "POST", "/api/auth/login", `{"email":"long@example.com","password":"`+longPassword+`x"}`, nil, ""), 401)
	expectStatus(t, request(t, a, "POST", "/api/auth/login", `{"email":"long@example.com","password":"`+longPassword+`"}`, nil, ""), 200)
	a.now = func() time.Time { return time.Date(2027, 1, 1, 0, 0, 0, 0, time.UTC) }
	expectStatus(t, request(t, a, "GET", "/api/me", "", registeredCookie, ""), 401)
}

func TestOriginAndAuthGuards(t *testing.T) {
	a := testApp(t)
	for _, origin := range []string{"https://evil.test", "null", "http://word.test.evil.test", "http://word.test:5173", "http://word.test/path"} {
		expectStatus(t, request(t, a, "POST", "/api/auth/guest", "{}", nil, origin), 403)
	}
	expectStatus(t, request(t, a, "POST", "/api/auth/guest", "{}", nil, "http://localhost:5173"), 403)
	a.cfg.DevOrigin = "http://localhost:5173"
	w := request(t, a, "OPTIONS", "/api/auth/guest", "", nil, a.cfg.DevOrigin)
	expectStatus(t, w, 204)
	if w.Header().Get("Access-Control-Allow-Credentials") != "true" {
		t.Fatal("missing credentialed CORS")
	}
	expectStatus(t, request(t, a, "POST", "/api/auth/guest", "{}", nil, a.cfg.DevOrigin), 200)
	cookie, _ := guestSession(t, a)
	guard := a.require(true, func(w http.ResponseWriter, r *http.Request, u User) error { return ok(w) })
	r := httptest.NewRequest("GET", "http://word.test/", nil)
	r.AddCookie(cookie)
	w = httptest.NewRecorder()
	guard.ServeHTTP(w, r)
	expectStatus(t, w, 403)
	w = request(t, a, "POST", "/api/auth/login", `{"email":"admin@word.local","password":"`+testPassword+`"}`, nil, "")
	if responseUser(t, w).Role != "admin" {
		t.Fatal("administrator login missing role")
	}
	r = httptest.NewRequest("GET", "http://word.test/", nil)
	r.AddCookie(w.Result().Cookies()[0])
	w = httptest.NewRecorder()
	guard.ServeHTTP(w, r)
	expectStatus(t, w, 200)
	for i := 0; i < 20; i++ {
		_ = request(t, a, "POST", "/api/auth/guest", "{}", cookie, "")
	}
	expectStatus(t, request(t, a, "POST", "/api/auth/guest", "{}", cookie, ""), 429)
}

func TestAdminInitializationAndPersistence(t *testing.T) {
	cfg := Config{DBPath: filepath.Join(t.TempDir(), "persist.db"), AdminEmail: "admin@word.local"}
	for _, password := range []string{"", "123456789"} {
		cfg.AdminPassword = password
		if db, err := openStore(context.Background(), cfg, time.Now()); err == nil {
			db.Close()
			t.Fatal("initialization accepted missing/short password")
		}
	}
	cfg.AdminPassword = testPassword
	a, err := Open(context.Background(), cfg)
	if err != nil {
		t.Fatal(err)
	}
	cookie, user := guestSession(t, a)
	if err = a.Close(); err != nil {
		t.Fatal(err)
	}
	cfg.AdminPassword = ""
	a, err = Open(context.Background(), cfg)
	if err != nil {
		t.Fatal(err)
	}
	defer a.Close()
	if got := responseUser(t, request(t, a, "GET", "/api/me", "", cookie, "")); got.ID != user.ID {
		t.Fatal("restart lost the persisted session")
	}
}
