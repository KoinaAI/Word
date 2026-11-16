package app

import (
	"bytes"
	"context"
	"encoding/json"
	"net/http/httptest"
	"testing"
	"time"
)

func TestAnswerRejectsChangedContent(t *testing.T) {
	a := testApp(t)
	cookie, _ := guestCookie(t, a)
	if _, err := a.db.Exec("UPDATE words SET content_version=2,meaning='已更新释义' WHERE id=1"); err != nil {
		t.Fatal(err)
	}
	payload := map[string]any{"wordId": 1, "mode": "sprint", "answer": "known", "eventId": "audit-content-stale", "contentVersion": 1}
	if rec := request(t, a, "POST", "/api/study/answer", payload, cookie); rec.Code != 409 {
		t.Fatalf("stale content accepted: %s", rec.Body.String())
	}
	payload["contentVersion"] = 2
	if rec := request(t, a, "POST", "/api/study/answer", payload, cookie); rec.Code != 200 {
		t.Fatal(rec.Body.String())
	}
}

func undoDirect(t *testing.T, a *App, userID int64, event string) *httptest.ResponseRecorder {
	t.Helper()
	req := httptest.NewRequest("POST", "/api/study/answer/undo", nil)
	raw, _ := json.Marshal(map[string]string{"eventId": event})
	req = httptest.NewRequest("POST", "/api/study/answer/undo", bytes.NewReader(raw))
	req.Header.Set("Content-Type", "application/json")
	req = req.WithContext(context.WithValue(req.Context(), userKey{}, &User{ID: userID}))
	rec := httptest.NewRecorder()
	a.undoAnswer(rec, req)
	return rec
}

func TestSprintUndoRestoresStateAndRejectsNewerPractice(t *testing.T) {
	a := testApp(t)
	cookie, user := guestCookie(t, a)
	_, other := guestCookie(t, a)
	payload := map[string]any{"wordId": 1, "mode": "sprint", "answer": "known", "eventId": "audit-undo-known-1", "contentVersion": 1}
	if rec := request(t, a, "POST", "/api/study/answer", payload, cookie); rec.Code != 200 {
		t.Fatal(rec.Body.String())
	}
	if rec := undoDirect(t, a, other.ID, "audit-undo-known-1"); rec.Code != 404 {
		t.Fatalf("cross-user undo accepted: %d", rec.Code)
	}
	for range 2 {
		if rec := undoDirect(t, a, user.ID, "audit-undo-known-1"); rec.Code != 200 {
			t.Fatal(rec.Body.String())
		}
	}
	var count, revision int
	if err := a.db.QueryRow("SELECT COUNT(*) FROM progress WHERE user_id=? AND word_id=1", user.ID).Scan(&count); err != nil || count != 0 {
		t.Fatalf("progress not restored to absence: %d %v", count, err)
	}
	if err := a.db.QueryRow("SELECT revision FROM learn_progress WHERE user_id=? AND word_id=1", user.ID).Scan(&revision); err != nil || revision != 2 {
		t.Fatalf("revision moved backwards: %d %v", revision, err)
	}
	if rec := request(t, a, "POST", "/api/study/answer", payload, cookie); rec.Code != 409 {
		t.Fatal("replayed undone answer accepted")
	}
	payload["eventId"] = "audit-undo-known-2"
	if rec := request(t, a, "POST", "/api/study/answer", payload, cookie); rec.Code != 200 {
		t.Fatal(rec.Body.String())
	}
	// A newer observational unknown is still an event and prevents reverting through it.
	payload["eventId"] = "audit-undo-later-3"
	payload["answer"] = "unknown"
	if rec := request(t, a, "POST", "/api/study/answer", payload, cookie); rec.Code != 200 {
		t.Fatal(rec.Body.String())
	}
	if rec := undoDirect(t, a, user.ID, "audit-undo-known-2"); rec.Code != 409 {
		t.Fatal("undo overwrote subsequent practice")
	}
	if rec := undoDirect(t, a, user.ID, "audit-undo-later-3"); rec.Code != 200 {
		t.Fatal(rec.Body.String())
	}
	if _, err := a.db.Exec("UPDATE answers SET created_at=? WHERE event_id='audit-undo-known-2'", stamp(time.Now().Add(-3*time.Minute))); err != nil {
		t.Fatal(err)
	}
	if rec := undoDirect(t, a, user.ID, "audit-undo-known-2"); rec.Code != 409 {
		t.Fatal("expired undo accepted")
	}
}
