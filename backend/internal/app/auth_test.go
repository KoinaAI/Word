package app

import (
	"bytes"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"path/filepath"
	"testing"
)

func testApp(t *testing.T) *App {
	t.Helper()
	a, err := New(Config{DBPath: filepath.Join(t.TempDir(), "word.db")})
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { a.Close() })
	return a
}
func request(t *testing.T, a *App, method, path string, body any, cookie *http.Cookie) *httptest.ResponseRecorder {
	t.Helper()
	var raw []byte
	if body != nil {
		var err error
		raw, err = json.Marshal(body)
		if err != nil {
			t.Fatal(err)
		}
	}
	req := httptest.NewRequest(method, path, bytes.NewReader(raw))
	if body != nil {
		req.Header.Set("Content-Type", "application/json")
	}
	if cookie != nil {
		req.AddCookie(cookie)
	}
	rec := httptest.NewRecorder()
	a.Handler().ServeHTTP(rec, req)
	return rec
}
func guestCookie(t *testing.T, a *App) (*http.Cookie, User) {
	t.Helper()
	rec := request(t, a, "POST", "/api/auth/guest", nil, nil)
	if rec.Code != 201 {
		t.Fatalf("guest %d %s", rec.Code, rec.Body.String())
	}
	var u User
	if err := json.Unmarshal(rec.Body.Bytes(), &u); err != nil {
		t.Fatal(err)
	}
	return rec.Result().Cookies()[0], u
}
func TestGuestConversionIsolationAndOrigin(t *testing.T) {
	a := testApp(t)
	c1, u1 := guestCookie(t, a)
	c2, u2 := guestCookie(t, a)
	if u1.ID == u2.ID {
		t.Fatal("guests share identity")
	}
	if !c1.HttpOnly || c1.SameSite != http.SameSiteLaxMode {
		t.Fatal("unsafe session cookie")
	}
	rec := request(t, a, "PATCH", "/api/me", map[string]any{"name": "Alice", "dailyGoal": 35}, c1)
	if rec.Code != 200 {
		t.Fatal(rec.Body.String())
	}
	rec = request(t, a, "GET", "/api/me", nil, c2)
	var other User
	json.Unmarshal(rec.Body.Bytes(), &other)
	if other.DailyGoal != 20 {
		t.Fatal("profile leaked across users")
	}
	rec = request(t, a, "POST", "/api/auth/register", map[string]any{"name": "Alice", "email": "alice@example.test", "password": "long-password"}, c1)
	if rec.Code != 201 {
		t.Fatal(rec.Body.String())
	}
	var registered User
	json.Unmarshal(rec.Body.Bytes(), &registered)
	if registered.ID != u1.ID || registered.Guest || registered.DailyGoal != 35 {
		t.Fatal("guest conversion lost profile")
	}
	if request(t, a, "GET", "/api/me", nil, c1).Code != 401 {
		t.Fatal("old session remained active")
	}
	if request(t, a, "POST", "/api/auth/login", map[string]string{"email": "alice@example.test", "password": "wrong"}, nil).Code != 401 {
		t.Fatal("invalid password accepted")
	}
	rec = request(t, a, "POST", "/api/auth/login", map[string]string{"email": "alice@example.test", "password": "long-password"}, nil)
	if rec.Code != 200 {
		t.Fatal(rec.Body.String())
	}
	req := httptest.NewRequest("POST", "/api/auth/guest", nil)
	req.Header.Set("Origin", "https://attacker.test")
	rec = httptest.NewRecorder()
	a.Handler().ServeHTTP(rec, req)
	if rec.Code != 403 {
		t.Fatal("cross-origin mutation accepted")
	}
}

func TestAdminRoutesRequireRole(t *testing.T) {
	a := testApp(t)
	cookie, _ := guestCookie(t, a)
	for _, path := range []string{"/api/admin/stats", "/api/admin/books", "/api/admin/users", "/api/admin/navigation"} {
		if got := request(t, a, "GET", path, nil, nil).Code; got != 401 {
			t.Fatalf("anonymous %s: %d", path, got)
		}
		if got := request(t, a, "GET", path, nil, cookie).Code; got != 403 {
			t.Fatalf("guest %s: %d", path, got)
		}
	}
}

func TestRelativeDatabasePath(t *testing.T) {
	t.Chdir(t.TempDir())
	a, err := New(Config{DBPath: "nested/word.db"})
	if err != nil {
		t.Fatal(err)
	}
	defer a.Close()
	if got := request(t, a, "GET", "/api/health", nil, nil).Code; got != 200 {
		t.Fatalf("health status %d", got)
	}
}
