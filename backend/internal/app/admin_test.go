package app

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"net/http/httptest"
	"testing"
)

func adminRequest(t *testing.T, handler http.HandlerFunc, method string, id int64, body any) *httptest.ResponseRecorder {
	t.Helper()
	var raw []byte
	if body != nil {
		var err error
		raw, err = json.Marshal(body)
		if err != nil {
			t.Fatal(err)
		}
	}
	req := httptest.NewRequest(method, "/", bytes.NewReader(raw))
	req.Header.Set("Content-Type", "application/json")
	if id != 0 {
		req.SetPathValue("id", fmt.Sprint(id))
	}
	req = req.WithContext(context.WithValue(req.Context(), userKey{}, &User{ID: 1, Role: "admin"}))
	rec := httptest.NewRecorder()
	handler(rec, req)
	return rec
}

func TestAdminImportAtomicityAndIdentity(t *testing.T) {
	a := testApp(t)
	var countBefore int
	if err := a.db.QueryRow("SELECT COUNT(*) FROM words WHERE book_id=1").Scan(&countBefore); err != nil {
		t.Fatal(err)
	}
	invalid := map[string]any{"words": []importWord{{Text: "newword", Meaning: "新单词"}, {Text: "invalid", Meaning: ""}}}
	rec := adminRequest(t, a.importWords, "POST", 1, invalid)
	if rec.Code != 400 {
		t.Fatalf("invalid import accepted: %d %s", rec.Code, rec.Body.String())
	}
	var countAfter int
	a.db.QueryRow("SELECT COUNT(*) FROM words WHERE book_id=1").Scan(&countAfter)
	if countAfter != countBefore {
		t.Fatal("invalid import partially persisted")
	}
	var id int64
	var text string
	if err := a.db.QueryRow("SELECT id,text FROM words WHERE book_id=1 ORDER BY id LIMIT 1").Scan(&id, &text); err != nil {
		t.Fatal(err)
	}
	_, u := guestCookie(t, a)
	if _, err := a.db.Exec("INSERT INTO progress(user_id,word_id,status,updated_at) VALUES(?,?,'mastered',?)", u.ID, id, "2026-11-14T00:00:00.000Z"); err != nil {
		t.Fatal(err)
	}
	rec = adminRequest(t, a.importWords, "POST", 1, map[string]any{"words": []importWord{{Text: text, Meaning: "更新后的释义"}, {Text: "newword", Meaning: "新单词"}}})
	if rec.Code != 200 {
		t.Fatal(rec.Body.String())
	}
	var existingID int64
	var meaning, status string
	if err := a.db.QueryRow("SELECT w.id,w.meaning,p.status FROM words w JOIN progress p ON p.word_id=w.id WHERE w.id=? AND p.user_id=?", id, u.ID).Scan(&existingID, &meaning, &status); err != nil {
		t.Fatal(err)
	}
	if existingID != id || meaning != "更新后的释义" || status != "mastered" {
		t.Fatal("upsert lost identity or progress")
	}
	a.db.QueryRow("SELECT COUNT(*) FROM words WHERE book_id=1").Scan(&countAfter)
	if countAfter != countBefore+1 {
		t.Fatal("upsert created duplicates")
	}
	rec = adminRequest(t, a.importWords, "POST", 1, map[string]any{"words": []importWord{{Text: "dup", Meaning: "一"}, {Text: "DUP", Meaning: "二"}}})
	if rec.Code != 400 {
		t.Fatal("duplicate import accepted")
	}
	rec = adminRequest(t, a.deleteBook, "DELETE", 1, nil)
	if rec.Code != 200 {
		t.Fatal(rec.Body.String())
	}
	var remaining int
	a.db.QueryRow("SELECT COUNT(*) FROM progress WHERE word_id=?", id).Scan(&remaining)
	if remaining != 0 {
		t.Fatal("book deletion left orphaned progress")
	}
}

func TestAdminNavigationValidationAndPersistence(t *testing.T) {
	a := testApp(t)
	original := defaultNavigation()
	changed := append([]Navigation(nil), original...)
	changed[0].Path = "https://example.test"
	rec := adminRequest(t, a.saveNavigation, "PUT", 0, map[string]any{"items": changed, "version": 0})
	if rec.Code != 400 {
		t.Fatal("unregistered route accepted")
	}
	changed = append([]Navigation(nil), original...)
	changed[3].Enabled = false
	rec = adminRequest(t, a.saveNavigation, "PUT", 0, map[string]any{"items": changed, "version": 0})
	if rec.Code != 400 {
		t.Fatal("configuration route could be disabled")
	}
	changed = append([]Navigation(nil), original...)
	changed[0].SortOrder = 1
	rec = adminRequest(t, a.saveNavigation, "PUT", 0, map[string]any{"items": changed, "version": 0})
	if rec.Code != 400 {
		t.Fatal("ambiguous sort order accepted")
	}
	changed = append([]Navigation(nil), original...)
	changed[0].Label = "概览"
	changed[0].Enabled = false
	changed[0].SortOrder = 2
	changed[2].SortOrder = 0
	rec = adminRequest(t, a.saveNavigation, "PUT", 0, map[string]any{"items": changed, "version": 0})
	if rec.Code != 200 {
		t.Fatal(rec.Body.String())
	}
	rec = adminRequest(t, a.navigation, "GET", 0, nil)
	var result []Navigation
	if err := json.Unmarshal(rec.Body.Bytes(), &result); err != nil {
		t.Fatal(err)
	}
	if len(result) != 4 || result[0].ID != "users" || result[2].Label != "概览" || result[2].Enabled {
		t.Fatal("navigation changes not persisted in requested order")
	}
}
