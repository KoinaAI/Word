package app

import (
	"bytes"
	"context"
	"encoding/json"
	"net/http/httptest"
	"testing"
)

func favoriteDirect(t *testing.T, a *App, userID int64, method string, payload any) *httptest.ResponseRecorder {
	t.Helper()
	raw, _ := json.Marshal(payload)
	req := httptest.NewRequest(method, "/api/favorites/1", bytes.NewReader(raw))
	req.Header.Set("Content-Type", "application/json")
	req.SetPathValue("id", "1")
	req = req.WithContext(context.WithValue(req.Context(), userKey{}, &User{ID: userID}))
	rec := httptest.NewRecorder()
	if method == "GET" {
		a.favoriteState(rec, req)
	} else {
		a.favorite(rec, req)
	}
	return rec
}

func TestFavoriteRevisionFencesLateWritesAndSurvivesRemoval(t *testing.T) {
	a := testApp(t)
	cookie, user := guestCookie(t, a)
	_, other := guestCookie(t, a)
	check := func(owner int64, favorite bool, revision int64) {
		t.Helper()
		rec := favoriteDirect(t, a, owner, "GET", nil)
		var state struct {
			Favorite bool
			Revision int64
		}
		if json.Unmarshal(rec.Body.Bytes(), &state) != nil || rec.Code != 200 || state.Favorite != favorite || state.Revision != revision {
			t.Fatalf("state: %d %s", rec.Code, rec.Body.String())
		}
	}
	write := func(value bool, revision int64, want int) {
		t.Helper()
		rec := favoriteDirect(t, a, user.ID, "POST", map[string]any{"favorite": value, "expectedRevision": revision})
		if rec.Code != want {
			t.Fatalf("CAS: %d %s expected%d", rec.Code, rec.Body.String(), want)
		}
	}
	check(user.ID, false, 0)
	// The newest remove can reach the server before the timed-out old add.
	// A no-op must still advance the revision to fence that delayed request.
	write(false, 0, 200)
	write(true, 0, 409)
	check(user.ID, false, 1)
	write(true, 1, 200)
	write(false, 2, 200)
	// Removing the row must retain v3, rather than returning to v0 (ABA).
	write(true, 0, 409)
	write(true, 1, 409)
	check(user.ID, false, 3)
	check(other.ID, false, 0)
	// Legacy writes remain supported but invalidate existing CAS observations.
	rec := favoriteDirect(t, a, user.ID, "POST", map[string]any{"favorite": true})
	if rec.Code != 200 {
		t.Fatal(rec.Body.String())
	}
	write(false, 3, 409)
	check(user.ID, true, 4)
	detail := request(t, a, "GET", "/api/books/1?limit=1", nil, cookie)
	var book struct{ Words []Word }
	if json.Unmarshal(detail.Body.Bytes(), &book) != nil || len(book.Words) != 1 || book.Words[0].FavoriteRevision != 4 {
		t.Fatalf("word lacks revision: %s", detail.Body.String())
	}
}

func TestFavoriteRevisionMigrationBackfillsVersionOneStores(t *testing.T) {
	a := testApp(t)
	_, user := guestCookie(t, a)
	if _, err := a.db.Exec("INSERT INTO favorites(user_id,word_id) VALUES(?,1)", user.ID); err != nil {
		t.Fatal(err)
	}
	if _, err := a.db.Exec("DROP TABLE favorite_revisions; PRAGMA user_version=1"); err != nil {
		t.Fatal(err)
	}
	cfg := a.cfg
	if err := a.Close(); err != nil {
		t.Fatal(err)
	}
	reopened, err := New(cfg)
	if err != nil {
		t.Fatal(err)
	}
	defer reopened.Close()
	var version, revision int
	if err = reopened.db.QueryRow("PRAGMA user_version").Scan(&version); err != nil || version != 2 {
		t.Fatalf("version%d %v", version, err)
	}
	if err = reopened.db.QueryRow("SELECT revision FROM favorite_revisions WHERE user_id=? AND word_id=1", user.ID).Scan(&revision); err != nil || revision != 1 {
		t.Fatalf("revision%d %v", revision, err)
	}
	rec := favoriteDirect(t, reopened, user.ID, "GET", nil)
	var state struct {
		Favorite bool
		Revision int64
	}
	if json.Unmarshal(rec.Body.Bytes(), &state) != nil || !state.Favorite || state.Revision != 1 {
		t.Fatal(rec.Body.String())
	}
}
