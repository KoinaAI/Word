package app

import (
	"encoding/json"
	"fmt"
	"net/http"
	"reflect"
	"strings"
	"testing"
)

func adminSession(t *testing.T, a *App) *http.Cookie {
	t.Helper()
	w := request(t, a, "POST", "/api/auth/login", `{"email":"admin@word.local","password":"`+testPassword+`"}`, nil, "")
	expectStatus(t, w, 200)
	return w.Result().Cookies()[0]
}

func TestAdminCRUDImportAndGuards(t *testing.T) {
	a := testApp(t)
	admin := adminSession(t, a)
	guest, guestUser := guestSession(t, a)
	for _, endpoint := range []struct{ method, path string }{
		{"GET", "/api/admin/stats"}, {"GET", "/api/admin/books"}, {"GET", "/api/admin/users"}, {"GET", "/api/admin/navigation"},
		{"POST", "/api/admin/books"}, {"PATCH", "/api/admin/books/1"}, {"DELETE", "/api/admin/books/1"},
		{"POST", "/api/admin/books/1/words"}, {"DELETE", "/api/admin/words/1"}, {"PUT", "/api/admin/navigation"},
	} {
		expectStatus(t, request(t, a, endpoint.method, endpoint.path, "{}", nil, ""), 401)
		expectStatus(t, request(t, a, endpoint.method, endpoint.path, "{}", guest, ""), 403)
	}
	created := decodeResponse[Book](t, request(t, a, "POST", "/api/admin/books", `{"title":"自选词书","subtitle":"待补充","description":"自选词汇","category":"日常","color":"#123456"}`, admin, ""))
	if created.WordCount != 0 {
		t.Fatal("new book must be empty")
	}
	books := decodeResponse[[]Book](t, request(t, a, "GET", "/api/admin/books", "", admin, ""))
	publicBooks := decodeResponse[[]Book](t, request(t, a, "GET", "/api/books", "", guest, ""))
	if len(books) != 7 || len(publicBooks) != 6 {
		t.Fatal("empty book visibility differs from contract")
	}
	path := fmt.Sprintf("/api/admin/books/%d", created.ID)
	updated := decodeResponse[Book](t, request(t, a, "PATCH", path, `{"title":"精选自选词书"}`, admin, ""))
	if updated.Title != "精选自选词书" || updated.Category != created.Category {
		t.Fatal("partial book update lost existing fields")
	}
	valid := `{"words":[{"text":"testword","phonetic":"/test/","meaning":"原词义","example":"A testword appears here.","exampleMeaning":"这里出现一个测试词。"}]}`
	imported := decodeResponse[map[string]int](t, request(t, a, "POST", path+"/words", valid, admin, ""))
	if imported["imported"] != 1 {
		t.Fatal("unexpected import count")
	}
	type detail struct {
		Book  Book   `json:"book"`
		Words []Word `json:"words"`
	}
	publicPath := fmt.Sprintf("/api/books/%d", created.ID)
	d := decodeResponse[detail](t, request(t, a, "GET", publicPath, "", guest, ""))
	id := d.Words[0].ID
	expectStatus(t, request(t, a, "POST", fmt.Sprintf("/api/favorites/%d", id), `{"favorite":true}`, guest, ""), 200)
	body := fmt.Sprintf(`{"wordId":%d,"mode":"sprint","answer":"known","eventId":"admin-test"}`, id)
	expectStatus(t, request(t, a, "POST", "/api/study/answer", body, guest, ""), 200)
	expectStatus(t, request(t, a, "POST", path+"/words", `{"words":[{"text":"TESTWORD","meaning":"新词义"}]}`, admin, ""), 200)
	d = decodeResponse[detail](t, request(t, a, "GET", publicPath, "", guest, ""))
	if len(d.Words) != 1 || d.Words[0].ID != id || d.Words[0].Meaning != "新词义" || d.Words[0].Status != "mastered" || !d.Words[0].Favorite {
		t.Fatalf("upsert lost identity/progress: %+v", d)
	}
	for _, invalid := range []string{
		`{"words":[{"text":"TESTWORD","meaning":"不应写入"},{"text":"bad","meaning":""}]}`,
		`{"words":[{"text":"duplicate","meaning":"1"},{"text":"DUPLICATE","meaning":"2"}]}`,
		`{"words":[]}`,
	} {
		expectStatus(t, request(t, a, "POST", path+"/words", invalid, admin, ""), 400)
	}
	d = decodeResponse[detail](t, request(t, a, "GET", publicPath, "", guest, ""))
	if len(d.Words) != 1 || d.Words[0].Meaning != "新词义" {
		t.Fatal("invalid import was not atomic")
	}
	large := make([]importedWord, 5000)
	for i := range large {
		large[i] = importedWord{Text: fmt.Sprintf("bulk-%04d", i), Meaning: "批量测试"}
	}
	encoded, _ := json.Marshal(map[string]any{"words": append(large, importedWord{Text: "too-many", Meaning: "超量"})})
	expectStatus(t, request(t, a, "POST", path+"/words", string(encoded), admin, ""), 400)
	encoded, _ = json.Marshal(map[string]any{"words": large})
	imported = decodeResponse[map[string]int](t, request(t, a, "POST", path+"/words", string(encoded), admin, ""))
	if imported["imported"] != 5000 {
		t.Fatal("5000 word import boundary failed")
	}
	stats := decodeResponse[adminStats](t, request(t, a, "GET", "/api/admin/stats", "", admin, ""))
	if stats.Users != 2 || stats.Books != 7 || stats.Words != 5121 || stats.Answers != 1 || stats.ActiveToday != 1 || stats.Recent[0].Meaning != "原词义" {
		t.Fatalf("admin statistics must come from persisted events: %+v", stats)
	}
	usersResponse := request(t, a, "GET", "/api/admin/users", "", admin, "")
	users := decodeResponse[[]adminUser](t, usersResponse)
	if strings.Contains(usersResponse.Body.String(), "password") || strings.Contains(usersResponse.Body.String(), "$2") {
		t.Fatal("credential leaked into admin user response")
	}
	found := false
	for _, user := range users {
		if user.ID == guestUser.ID {
			found = user.LearnedCount == 1 && user.Guest
		}
	}
	if !found {
		t.Fatal("missing user progress in admin list")
	}
	expectStatus(t, request(t, a, "DELETE", fmt.Sprintf("/api/admin/words/%d", id), "", admin, ""), 200)
	expectStatus(t, request(t, a, "POST", "/api/study/answer", body, guest, ""), 200)
	userStats := decodeResponse[userStats](t, request(t, a, "GET", "/api/stats", "", guest, ""))
	if userStats.Learned != 0 || userStats.Favorites != 0 || userStats.Today != 1 || userStats.Recent[0].Meaning != "原词义" {
		t.Fatal("word deletion lost history or retained orphaned progress")
	}
	expectStatus(t, request(t, a, "PATCH", "/api/me", fmt.Sprintf(`{"activeBookId":%d}`, created.ID), guest, ""), 200)
	expectStatus(t, request(t, a, "DELETE", path, "", admin, ""), 200)
	if user := responseUser(t, request(t, a, "GET", "/api/me", "", guest, "")); user.ActiveBookID != 0 {
		t.Fatal("deleted active book was not cleared")
	}
	expectStatus(t, request(t, a, "GET", publicPath, "", guest, ""), 404)
	expectStatus(t, request(t, a, "DELETE", path, "", admin, ""), 404)
}

func TestNavigationValidationAndPersistence(t *testing.T) {
	a := testApp(t)
	admin := adminSession(t, a)
	initial := decodeResponse[[]Navigation](t, request(t, a, "GET", "/api/admin/navigation", "", admin, ""))
	if len(initial) != 4 {
		t.Fatal("initial modules missing")
	}
	for _, items := range [][]Navigation{
		{{ID: 1, Label: "bad", Path: "https://evil.test", Enabled: true}},
		{{ID: 4, Label: "导航", Path: "/admin/navigation", Enabled: false}},
		{{ID: 4, Label: "导航", Path: "/admin/navigation", Enabled: true}, {ID: 4, Label: "用户", Path: "/admin/users", Enabled: true}},
		{{ID: 4, Label: "导航", Path: "/admin/navigation", Enabled: true}, {ID: 5, Label: "导航2", Path: "/admin/navigation", Enabled: true}},
	} {
		encoded, _ := json.Marshal(map[string]any{"items": items})
		expectStatus(t, request(t, a, "PUT", "/api/admin/navigation", string(encoded), admin, ""), 400)
	}
	current := decodeResponse[[]Navigation](t, request(t, a, "GET", "/api/admin/navigation", "", admin, ""))
	if !reflect.DeepEqual(initial, current) {
		t.Fatal("invalid navigation update modified existing configuration")
	}
	items := []Navigation{{ID: 40, Label: "导航设置", Path: "/admin/navigation", Icon: "Settings", Enabled: true, SortOrder: 0}, {ID: 10, Label: "首页", Path: "/admin", Icon: "Home", Enabled: false, SortOrder: 1}}
	encoded, _ := json.Marshal(map[string]any{"items": items})
	current = decodeResponse[[]Navigation](t, request(t, a, "PUT", "/api/admin/navigation", string(encoded), admin, ""))
	if !reflect.DeepEqual(items, current) {
		t.Fatal("navigation update differs from contract")
	}
	if err := initialize(t.Context(), a.db, a.cfg, a.now()); err != nil {
		t.Fatal(err)
	}
	current = decodeResponse[[]Navigation](t, request(t, a, "GET", "/api/admin/navigation", "", admin, ""))
	if !reflect.DeepEqual(items, current) {
		t.Fatal("restart overwrote navigation settings")
	}
}
