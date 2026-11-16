package app

import (
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"
)

func TestAdminImportPreservesOmittedFieldsAndVersionsContent(t *testing.T) {
	a := testApp(t)
	var id int64
	var text string
	if err := a.db.QueryRow("SELECT id,text FROM words WHERE book_id=1 ORDER BY id LIMIT 1").Scan(&id, &text); err != nil {
		t.Fatal(err)
	}
	if _, err := a.db.Exec("UPDATE words SET phonetic='original phonetic',example='original example',example_meaning='原例句' WHERE id=?", id); err != nil {
		t.Fatal(err)
	}
	importOne := func(word map[string]any) {
		t.Helper()
		rec := adminRequest(t, a.importWords, "POST", 1, map[string]any{"words": []any{word}})
		if rec.Code != http.StatusOK {
			t.Fatalf("import failed: %d %s", rec.Code, rec.Body.String())
		}
	}
	assertContent := func(phonetic, example, translated string, version int64) {
		t.Helper()
		var gotPhonetic, gotExample, gotTranslated string
		var gotVersion int64
		err := a.db.QueryRow("SELECT phonetic,example,example_meaning,content_version FROM words WHERE id=?", id).Scan(&gotPhonetic, &gotExample, &gotTranslated, &gotVersion)
		if err != nil {
			t.Fatal(err)
		}
		if gotPhonetic != phonetic || gotExample != example || gotTranslated != translated || gotVersion != version {
			t.Fatalf("unexpected content: %q %q %q v%d", gotPhonetic, gotExample, gotTranslated, gotVersion)
		}
	}
	importOne(map[string]any{"text": text, "meaning": "修改释义"})
	assertContent("original phonetic", "original example", "原例句", 2)
	importOne(map[string]any{"text": text, "meaning": "修改释义"})
	assertContent("original phonetic", "original example", "原例句", 2)
	importOne(map[string]any{"text": text, "meaning": "修改释义", "example": "", "phonetic": ""})
	assertContent("", "", "原例句", 3)
}

func TestAdminImportRestartsOnlyUnfinishedChangedContent(t *testing.T) {
	a := testApp(t)
	cookie, learner := guestCookie(t, a)
	_, completed := guestCookie(t, a)
	var wordID int64
	var text string
	if err := a.db.QueryRow("SELECT id,text FROM words WHERE book_id=1 ORDER BY id LIMIT 1").Scan(&wordID, &text); err != nil {
		t.Fatal(err)
	}
	for _, state := range []struct {
		user  int64
		stage int
	}{{learner.ID, 1}, {completed.ID, 2}} {
		if _, err := a.db.Exec("INSERT INTO learn_progress(user_id,word_id,stage,revision,updated_at) VALUES(?,?,?,3,?)", state.user, wordID, state.stage, "2026-11-16T00:00:00.000Z"); err != nil {
			t.Fatal(err)
		}
	}
	assertStage := func(user int64, wantStage int, wantRevision int64) {
		t.Helper()
		var stage int
		var revision int64
		if err := a.db.QueryRow("SELECT stage,revision FROM learn_progress WHERE user_id=? AND word_id=?", user, wordID).Scan(&stage, &revision); err != nil {
			t.Fatal(err)
		}
		if stage != wantStage || revision != wantRevision {
			t.Fatalf("user %d got stage %d rev%d, want %d rev%d", user, stage, revision, wantStage, wantRevision)
		}
	}
	for pass := 0; pass < 2; pass++ {
		rec := adminRequest(t, a.importWords, "POST", 1, map[string]any{"words": []any{map[string]any{"text": text, "meaning": "替换后的新释义"}}})
		if rec.Code != http.StatusOK {
			t.Fatalf("import: %d %s", rec.Code, rec.Body.String())
		}
		assertStage(learner.ID, 0, 4)
		assertStage(completed.ID, 2, 3)
	}
	stale := request(t, a, "POST", "/api/study/answer", learnPayload(wordID, 1, 3, "known", "legacy-old-content-0001"), cookie)
	if stale.Code != http.StatusConflict {
		t.Fatalf("legacy stale stage accepted: %d %s", stale.Code, stale.Body.String())
	}
}

func TestAdminImportReportsBadItemWithoutPartialWrite(t *testing.T) {
	a := testApp(t)
	rec := adminRequest(t, a.importWords, "POST", 1, map[string]any{"words": []any{map[string]any{"text": "valid-audit-word", "meaning": "合法"}, map[string]any{"text": "bad-audit-word", "meaning": " "}}})
	if rec.Code != http.StatusBadRequest {
		t.Fatal(rec.Body.String())
	}
	var result struct {
		Error string `json:"error"`
		Index int    `json:"index"`
		Field string `json:"field"`
		Word  string `json:"word"`
	}
	if err := json.Unmarshal(rec.Body.Bytes(), &result); err != nil {
		t.Fatal(err)
	}
	if result.Index != 1 || result.Field != "meaning" || result.Word != "bad-audit-word" || !strings.Contains(result.Error, "第 2 项") {
		t.Fatalf("unlocalized validation: %+v", result)
	}
	var count int
	if err := a.db.QueryRow("SELECT COUNT(*) FROM words WHERE text='valid-audit-word'").Scan(&count); err != nil {
		t.Fatal(err)
	}
	if count != 0 {
		t.Fatal("batch partially persisted")
	}
}

func TestAdminNavigationRejectsStaleEditor(t *testing.T) {
	a := testApp(t)
	initial := defaultNavigation()
	missing := adminRequest(t, a.saveNavigation, "PUT", 0, map[string]any{"items": initial})
	if missing.Code != http.StatusPreconditionRequired {
		t.Fatalf("missing version accepted: %d", missing.Code)
	}
	changed := append([]Navigation(nil), initial...)
	changed[0].Label = "最新概览"
	rec := adminRequest(t, a.saveNavigation, "PUT", 0, map[string]any{"items": changed, "version": 0})
	if rec.Code != http.StatusOK {
		t.Fatal(rec.Body.String())
	}
	stale := adminRequest(t, a.saveNavigation, "PUT", 0, map[string]any{"items": initial, "version": 0})
	if stale.Code != http.StatusConflict {
		t.Fatalf("stale editor accepted: %d %s", stale.Code, stale.Body.String())
	}
	req := httptest.NewRequest("GET", "/api/admin/navigation?versioned=1", nil)
	get := httptest.NewRecorder()
	a.navigation(get, req)
	var result struct {
		Items   []Navigation `json:"items"`
		Version int64        `json:"version"`
	}
	if err := json.Unmarshal(get.Body.Bytes(), &result); err != nil {
		t.Fatal(err)
	}
	if result.Version != 1 || len(result.Items) != 4 || result.Items[0].Label != "最新概览" {
		t.Fatalf("stale save changed data: %+v", result)
	}
}

func TestAdminUsersPaginatesAndFilters(t *testing.T) {
	a := testApp(t)
	for i := 0; i < 65; i++ {
		if _, err := a.db.Exec("INSERT INTO users(name,created_at) VALUES(?,?)", fmt.Sprintf("audit-person-%03d", i), "2026-11-16T00:00:00.000Z"); err != nil {
			t.Fatal(err)
		}
	}
	req := httptest.NewRequest("GET", "/api/admin/users?paged=1&limit=20&offset=20&q=audit-person-&kind=guest", nil)
	req = req.WithContext(context.WithValue(req.Context(), userKey{}, &User{ID: 1, Role: "admin"}))
	rec := httptest.NewRecorder()
	a.adminUsers(rec, req)
	if rec.Code != http.StatusOK {
		t.Fatal(rec.Body.String())
	}
	var result struct {
		Items []struct {
			Name string `json:"name"`
		} `json:"items"`
		Total   int  `json:"total"`
		Offset  int  `json:"offset"`
		Limit   int  `json:"limit"`
		HasMore bool `json:"hasMore"`
	}
	if err := json.Unmarshal(rec.Body.Bytes(), &result); err != nil {
		t.Fatal(err)
	}
	if result.Total != 65 || len(result.Items) != 20 || result.Offset != 20 || result.Limit != 20 || !result.HasMore || result.Items[0].Name != "audit-person-044" {
		t.Fatalf("wrong page: %+v", result)
	}
	for _, query := range []string{"limit=bad", "limit=0", "offset=-1"} {
		req = httptest.NewRequest("GET", "/api/admin/users?"+query, nil)
		rec = httptest.NewRecorder()
		a.adminUsers(rec, req)
		if rec.Code != http.StatusBadRequest {
			t.Fatalf("invalid page %s accepted: %d", query, rec.Code)
		}
	}
	req = httptest.NewRequest("GET", "/api/admin/users?kind=unknown", nil)
	rec = httptest.NewRecorder()
	a.adminUsers(rec, req)
	if rec.Code != http.StatusBadRequest {
		t.Fatal("unknown filter accepted")
	}
	req = httptest.NewRequest("GET", "/api/admin/users", nil)
	rec = httptest.NewRecorder()
	a.adminUsers(rec, req)
	var legacy []any
	if err := json.Unmarshal(rec.Body.Bytes(), &legacy); err != nil {
		t.Fatal(err)
	}
	if len(legacy) != 50 {
		t.Fatalf("legacy response was not bounded: %d", len(legacy))
	}
}

func TestAdminImportCaseOnlyTextChangeInvalidatesQuestion(t *testing.T) {
	a := testApp(t)
	cookie, user := guestCookie(t, a)
	result, err := a.db.Exec("INSERT INTO words(book_id,text,meaning) VALUES(1,'polish','抛光')")
	if err != nil {
		t.Fatal(err)
	}
	id, err := result.LastInsertId()
	if err != nil {
		t.Fatal(err)
	}
	if _, err = a.db.Exec("INSERT INTO learn_progress(user_id,word_id,stage,revision,updated_at) VALUES(?,?,1,1,?)", user.ID, id, stamp(time.Now())); err != nil {
		t.Fatal(err)
	}
	rec := adminRequest(t, a.importWords, "POST", 1, map[string]any{"words": []any{map[string]any{"text": "Polish", "meaning": "抛光"}}})
	if rec.Code != 200 {
		t.Fatal(rec.Body.String())
	}
	var version, revision int64
	var stage int
	if err = a.db.QueryRow("SELECT content_version FROM words WHERE id=?", id).Scan(&version); err != nil || version != 2 {
		t.Fatalf("case change retained stale content: version%d %v", version, err)
	}
	if err = a.db.QueryRow("SELECT stage,revision FROM learn_progress WHERE user_id=? AND word_id=?", user.ID, id).Scan(&stage, &revision); err != nil || stage != 0 || revision != 2 {
		t.Fatalf("case change retained stage%d revision%d %v", stage, revision, err)
	}
	payload := map[string]any{"wordId": id, "mode": "learn", "answer": "known", "eventId": "audit-case-content-stale", "learnStage": 1, "learnRevision": 1, "contentVersion": 1}
	if rec = request(t, a, "POST", "/api/study/answer", payload, cookie); rec.Code != 409 {
		t.Fatal("case-only stale question accepted")
	}
}
