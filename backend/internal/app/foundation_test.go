package app

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"net/http/httptest"
	"path/filepath"
	"strings"
	"testing"
	"time"
)

func TestProfilePatchPreservesColumnsFromStaleRequest(t *testing.T) {
	a := testApp(t)
	_, user := guestCookie(t, a)
	stale := user
	if _, err := a.db.Exec("UPDATE users SET name='New Name', daily_goal=45, active_book_id=2 WHERE id=?", user.ID); err != nil {
		t.Fatal(err)
	}
	req := httptest.NewRequest("PATCH", "/api/me", strings.NewReader(`{"examDate":"2027-01-01"}`))
	req.Header.Set("Content-Type", "application/json")
	req = req.WithContext(context.WithValue(req.Context(), userKey{}, &stale))
	rec := httptest.NewRecorder()
	a.updateMe(rec, req)
	if rec.Code != 200 {
		t.Fatalf("patch failed: %d %s", rec.Code, rec.Body.String())
	}
	actual, err := a.getUser(context.Background(), user.ID)
	if err != nil || actual.Name != "New Name" || actual.DailyGoal != 45 || actual.ActiveBookID != 2 || actual.ExamDate != "2027-01-01" {
		t.Fatalf("stale PATCH lost unrelated columns: %+v %v", actual, err)
	}
}

func TestExpectedIdentityRejectsCrossTabWrites(t *testing.T) {
	a := testApp(t)
	cookie, user := guestCookie(t, a)
	req := httptest.NewRequest("PATCH", "/api/me", strings.NewReader(`{"name":"wrong account"}`))
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("X-Word-User-ID", fmt.Sprint(user.ID+1))
	req.AddCookie(cookie)
	rec := httptest.NewRecorder()
	a.Handler().ServeHTTP(rec, req)
	var payload map[string]string
	json.Unmarshal(rec.Body.Bytes(), &payload)
	if rec.Code != 409 || payload["code"] != "SESSION_CHANGED" {
		t.Fatalf("old identity write accepted: %d %s", rec.Code, rec.Body.String())
	}
	actual, _ := a.getUser(context.Background(), user.ID)
	if actual.Name == "wrong account" {
		t.Fatal("identity guard wrote before rejecting")
	}
	req = httptest.NewRequest("PATCH", "/api/me", strings.NewReader(`{"name":"same account"}`))
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("X-Word-User-ID", fmt.Sprint(user.ID))
	req.AddCookie(cookie)
	rec = httptest.NewRecorder()
	a.Handler().ServeHTTP(rec, req)
	if rec.Code != 200 {
		t.Fatalf("valid identity rejected: %d %s", rec.Code, rec.Body.String())
	}
}

func TestActiveSessionRenewsOnlyThroughCoordinatedIdentityRead(t *testing.T) {
	a := testApp(t)
	cookie, user := guestCookie(t, a)
	before := stamp(time.Now().Add(2 * 24 * time.Hour))
	if _, err := a.db.Exec("UPDATE sessions SET expires_at=? WHERE user_id=?", before, user.ID); err != nil {
		t.Fatal(err)
	}
	rec := request(t, a, "GET", "/api/stats", nil, cookie)
	if rec.Code != 200 {
		t.Fatal(rec.Body.String())
	}
	if len(rec.Result().Cookies()) != 0 {
		t.Fatal("ordinary delayed response can overwrite a newly logged-in cookie")
	}
	var after string
	a.db.QueryRow("SELECT expires_at FROM sessions WHERE user_id=?", user.ID).Scan(&after)
	if after < stamp(time.Now().Add(29*24*time.Hour)) {
		t.Fatalf("active server session was not extended: %s", after)
	}
	rec = request(t, a, "GET", "/api/me", nil, cookie)
	if len(rec.Result().Cookies()) != 0 {
		t.Fatal("uncoordinated identity read resent old credentials")
	}
	req := httptest.NewRequest("GET", "/api/me", nil)
	req.Header.Set("X-Word-Session-Renew", "1")
	req.AddCookie(cookie)
	rec = httptest.NewRecorder()
	a.Handler().ServeHTTP(rec, req)
	cookies := rec.Result().Cookies()
	if len(cookies) != 1 || cookies[0].Value != cookie.Value || cookies[0].MaxAge < 29*24*60*60 {
		t.Fatalf("coordinated cookie expiry not synchronized: %+v", cookies)
	}
	var unchanged string
	a.db.QueryRow("SELECT expires_at FROM sessions WHERE user_id=?", user.ID).Scan(&unchanged)
	if unchanged != after {
		t.Fatal("healthy identity read rewrote server expiry")
	}
}

func TestTrustedProxyClientAddressAndThrottleIsolation(t *testing.T) {
	prefixes, err := parseTrustedProxies("10.0.0.0/8, 127.0.0.1")
	if err != nil {
		t.Fatal(err)
	}
	a := testApp(t)
	a.trustedProxies = prefixes
	cases := []struct{ peer, xff, want string }{
		{"192.0.2.4:4000", "203.0.113.1", "192.0.2.4"},
		{"10.1.1.1:4000", "203.0.113.1, 10.2.2.2", "203.0.113.1"},
		{"10.1.1.1:4000", "198.51.100.99, 192.0.2.5", "192.0.2.5"},
		{"10.1.1.1:4000", "invalid", "10.1.1.1"},
	}
	for _, c := range cases {
		req := httptest.NewRequest("POST", "/", nil)
		req.RemoteAddr = c.peer
		req.Header.Set("X-Forwarded-For", c.xff)
		if got := a.clientAddress(req); got != c.want {
			t.Errorf("%s + %s: %s != %s", c.peer, c.xff, got, c.want)
		}
	}
	for index := 0; index < 31; index++ {
		req := httptest.NewRequest("POST", "/", nil)
		req.RemoteAddr = "10.1.1.1:4000"
		req.Header.Set("X-Forwarded-For", "203.0.113.10")
		rec := httptest.NewRecorder()
		ok := a.limitAuth(rec, req)
		if (index < 30) != ok {
			t.Fatalf("unexpected throttle at %d", index)
		}
	}
	req := httptest.NewRequest("POST", "/", nil)
	req.RemoteAddr = "10.1.1.1:4000"
	req.Header.Set("X-Forwarded-For", "203.0.113.11")
	if !a.limitAuth(httptest.NewRecorder(), req) {
		t.Fatal("another proxy client shared exhausted throttle")
	}
}

func TestInitializationRejectsInvalidAdminAndProxyConfiguration(t *testing.T) {
	for _, cfg := range []Config{{DBPath: filepath.Join(t.TempDir(), "bad-admin.db"), AdminEmail: "admin", AdminPassword: "valid-password-123"}, {DBPath: filepath.Join(t.TempDir(), "bad-proxy.db"), TrustedProxies: "not-an-address"}} {
		app, err := New(cfg)
		if err == nil {
			app.Close()
			t.Fatal("invalid config accepted")
		}
	}
}

func TestStaticAssetsSkipSessionLookupAndDatabaseErrorsStayErrors(t *testing.T) {
	dir := t.TempDir()
	a := testApp(t)
	a.cfg.WebDir = dir
	cookie, _ := guestCookie(t, a)
	if err := a.db.Close(); err != nil {
		t.Fatal(err)
	}
	// A database fault must not be interpreted as an anonymous account conversion.
	rec := request(t, a, "GET", "/api/me", nil, cookie)
	if rec.Code != 500 {
		t.Fatalf("database fault became anonymous: %d", rec.Code)
	}
	req := httptest.NewRequest("GET", "/missing.js", bytes.NewReader(nil))
	req.AddCookie(cookie)
	rec = httptest.NewRecorder()
	a.Handler().ServeHTTP(rec, req)
	if rec.Code != 404 {
		t.Fatalf("static asset performed database auth: %d", rec.Code)
	}
}
