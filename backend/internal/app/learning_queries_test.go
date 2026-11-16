package app

import (
	"encoding/json"
	"fmt"
	"testing"
	"time"
)

func TestBookPagesCountsAndLearningResume(t *testing.T) {
	a := testApp(t)
	cookie, user := guestCookie(t, a)
	if _, err := a.db.Exec("UPDATE users SET daily_goal=5 WHERE id=?", user.ID); err != nil {
		t.Fatal(err)
	}
	if _, err := a.db.Exec("INSERT INTO learn_progress(user_id,word_id,stage,revision,updated_at) VALUES(?,10,1,1,?)", user.ID, stamp(time.Now())); err != nil {
		t.Fatal(err)
	}
	rec := request(t, a, "GET", "/api/study?bookId=1&mode=learn&limit=5", nil, cookie)
	var round struct {
		Book       Book
		Words      []Word
		Vocabulary []Word
		Total      int
		HasMore    bool
	}
	if err := json.Unmarshal(rec.Body.Bytes(), &round); err != nil || rec.Code != 200 {
		t.Fatalf("load: %d %s", rec.Code, rec.Body.String())
	}
	if len(round.Words) != 5 || round.Words[0].ID != 10 || round.Words[0].LearnStage != 1 {
		t.Fatalf("saved stage not prioritized: %+v", round.Words)
	}
	if round.Book.NewCount != 20 || round.Book.UnstartedCount != 19 || round.Book.LearningCount != 1 || round.Book.SprintCount != 20 {
		t.Fatalf("wrong counts: %+v", round.Book)
	}
	rec = request(t, a, "GET", "/api/books/1?status=learning&limit=1", nil, cookie)
	var detail struct {
		Words   []Word
		Total   int
		HasMore bool
	}
	if err := json.Unmarshal(rec.Body.Bytes(), &detail); err != nil || detail.Total != 1 || len(detail.Words) != 1 || detail.Words[0].ID != 10 {
		t.Fatalf("stage filter: %s", rec.Body.String())
	}
	rec = request(t, a, "GET", "/api/books/1?status=new&limit=5&offset=5", nil, cookie)
	if err := json.Unmarshal(rec.Body.Bytes(), &detail); err != nil || detail.Total != 19 || len(detail.Words) != 5 || !detail.HasMore {
		t.Fatalf("page filter: %s", rec.Body.String())
	}
	if bad := request(t, a, "GET", "/api/books/1?limit=10000", nil, cookie); bad.Code != 400 {
		t.Fatal("unbounded limit accepted")
	}
}

func TestStudyCursorAndVocabularyAreBounded(t *testing.T) {
	a := testApp(t)
	cookie, _ := guestCookie(t, a)
	for i := 0; i < 210; i++ {
		if _, err := a.db.Exec("INSERT INTO words(book_id,text,meaning,example) VALUES(1,?,?,?)", fmt.Sprintf("audit-%03d", i), fmt.Sprintf("释义%d", i), "例句不应进入干扰项"); err != nil {
			t.Fatal(err)
		}
	}
	var round struct {
		Words      []Word
		Vocabulary []Word
		NextAfter  int64
		Total      int
		HasMore    bool
	}
	rec := request(t, a, "GET", "/api/study?bookId=1&mode=sprint&limit=7", nil, cookie)
	if json.Unmarshal(rec.Body.Bytes(), &round) != nil || len(round.Words) != 7 || round.Total != 230 || !round.HasMore {
		t.Fatalf("batch: %s", rec.Body.String())
	}
	after := round.NextAfter
	// An unknown answer leaves eligibility unchanged. The cursor must still advance.
	payload := map[string]any{"wordId": round.Words[0].ID, "mode": "sprint", "answer": "unknown", "eventId": "audit-cursor-unknown"}
	if result := request(t, a, "POST", "/api/study/answer", payload, cookie); result.Code != 200 {
		t.Fatal(result.Body.String())
	}
	rec = request(t, a, "GET", fmt.Sprintf("/api/study?bookId=1&mode=sprint&limit=7&after=%d", after), nil, cookie)
	if json.Unmarshal(rec.Body.Bytes(), &round) != nil || len(round.Words) != 7 || round.Words[0].ID <= after {
		t.Fatalf("cursor repeated unknown: %s", rec.Body.String())
	}
	rec = request(t, a, "GET", "/api/study?bookId=1&mode=learn&limit=100", nil, cookie)
	if json.Unmarshal(rec.Body.Bytes(), &round) != nil || len(round.Vocabulary) > 200 || len(round.Vocabulary) == 0 {
		t.Fatalf("candidate bound: %s", rec.Body.String())
	}
	for _, word := range round.Vocabulary {
		if word.Example != "" || word.ExampleMeaning != "" || word.ContentVersion != 1 {
			t.Fatalf("candidate carried unnecessary data: %+v", word)
		}
	}
}

func TestFavoritePaginationAndIsolation(t *testing.T) {
	a := testApp(t)
	cookie, user := guestCookie(t, a)
	other, _ := guestCookie(t, a)
	for i := 1; i <= 12; i++ {
		if _, err := a.db.Exec("INSERT INTO favorites(user_id,word_id) VALUES(?,?)", user.ID, i); err != nil {
			t.Fatal(err)
		}
	}
	rec := request(t, a, "GET", "/api/favorites?paged=1&limit=5&offset=5", nil, cookie)
	var page struct {
		Items   []Word
		Total   int
		HasMore bool
	}
	if json.Unmarshal(rec.Body.Bytes(), &page) != nil || page.Total != 12 || len(page.Items) != 5 || page.Items[0].ID != 6 || !page.HasMore {
		t.Fatalf("favorites page: %s", rec.Body.String())
	}
	rec = request(t, a, "GET", "/api/favorites?paged=1", nil, other)
	if json.Unmarshal(rec.Body.Bytes(), &page) != nil || page.Total != 0 || len(page.Items) != 0 {
		t.Fatalf("favorites leaked: %s", rec.Body.String())
	}
}
