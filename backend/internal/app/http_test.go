package app

import (
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"testing"
)

func TestHTTPServingAndValidation(t *testing.T) {
	a := testApp(t)
	root := t.TempDir()
	if err := os.WriteFile(filepath.Join(root, "index.html"), []byte("<html>SPA entry</html>"), 0600); err != nil {
		t.Fatal(err)
	}
	outside := filepath.Join(t.TempDir(), "secret.txt")
	if err := os.WriteFile(outside, []byte("private data"), 0600); err != nil {
		t.Fatal(err)
	}
	if err := os.Symlink(outside, filepath.Join(root, "escape.txt")); err != nil {
		t.Fatal(err)
	}
	a.cfg.WebDir = root
	for _, path := range []string{"/", "/study", "/admin/books", "/index.html"} {
		w := request(t, a, "GET", path, "", nil, "")
		expectStatus(t, w, 200)
		if !strings.Contains(w.Body.String(), "SPA entry") || !strings.Contains(w.Header().Get("Content-Type"), "text/html") {
			t.Fatalf("SPA fallback failed for %s", path)
		}
	}
	for _, path := range []string{"/escape.txt", "/.env", "/missing.js", "/api/missing", "/api"} {
		expectStatus(t, request(t, a, "GET", path, "", nil, ""), 404)
	}
	for _, path := range []string{"/api/health", "/health"} {
		value := decodeResponse[map[string]string](t, request(t, a, "GET", path, "", nil, ""))
		if value["status"] != "ok" {
			t.Fatal("health response differs from contract")
		}
	}
	w := request(t, a, "PUT", "/api/me", "{}", nil, "")
	expectStatus(t, w, 405)
	if !strings.Contains(w.Body.String(), `"error"`) {
		t.Fatal("method error must be JSON")
	}
	cookie, _ := guestSession(t, a)
	for _, body := range []string{`{"dailyGoal":0}`, `{"examDate":"2026-02-30"}`, `{"activeBookId":-1}`, `{"role":"admin"}`, `{} {}`} {
		w := request(t, a, "PATCH", "/api/me", body, cookie, "")
		if w.Code != 400 && w.Code != 404 {
			t.Fatalf("invalid profile patch succeeded: %s %s", body, w.Body.String())
		}
	}
	r := httptest.NewRequest("POST", "http://word.test/api/auth/guest", nil)
	r.Header.Set("Sec-Fetch-Site", "cross-site")
	w = httptest.NewRecorder()
	a.Handler().ServeHTTP(w, r)
	expectStatus(t, w, 403)
	a.cfg.CookieSecure = true
	w = request(t, a, "POST", "/api/auth/guest", "{}", nil, "https://word.test")
	expectStatus(t, w, 200)
	if !w.Result().Cookies()[0].Secure || w.Result().Cookies()[0].SameSite != http.SameSiteLaxMode {
		t.Fatal("production cookie flags missing")
	}
	expectStatus(t, request(t, a, "POST", "/api/auth/guest", "{}", nil, "http://word.test"), 403)
}
