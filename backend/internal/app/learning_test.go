package app

import (
	"encoding/json"
	"fmt"
	"testing"
	"time"
)

func TestMemoryIntervalsAndSprintSemantics(t *testing.T) {
	now := time.Date(2026, 11, 14, 8, 0, 0, 0, time.UTC)
	fresh := memoryState{}
	if _, changed := nextMemory(fresh, "sprint", "unknown", now); changed {
		t.Fatal("sprint unknown persisted a mastery change")
	}
	learned, _ := nextMemory(fresh, "sprint", "known", now)
	if learned.status != "mastered" || learned.interval != 1 || learned.reinforce {
		t.Fatalf("direct success %#v", learned)
	}
	unchanged, changed := nextMemory(learned, "sprint", "unsure-unknown", now)
	if changed || unchanged != learned {
		t.Fatal("sprint failed reveal modified existing mastery")
	}
	pending, _ := nextMemory(fresh, "sprint", "unsure-known", now)
	if pending.status != "learning" || !pending.reinforce {
		t.Fatalf("revealed success %#v", pending)
	}
	returned, _ := nextMemory(pending, "reinforce", "unknown", now)
	if returned.status != "new" || returned.reinforce || returned.due != "" {
		t.Fatal("failed consolidation did not return to upper queue")
	}
	cleared, _ := nextMemory(pending, "reinforce", "known", now)
	if cleared.status != "mastered" || cleared.reinforce {
		t.Fatal("consolidation success not mastered")
	}
	second, _ := nextMemory(learned, "review", "known", now)
	third, _ := nextMemory(second, "review", "known", now)
	fourth, _ := nextMemory(third, "review", "known", now)
	if second.interval != 3 || third.interval != 7 || fourth.interval <= third.interval {
		t.Fatal("intervals do not expand")
	}
	failed, _ := nextMemory(fourth, "review", "unknown", now)
	if failed.status != "learning" || failed.repetitions != 0 || failed.due != stamp(now.Add(10*time.Minute)) {
		t.Fatal("failed recall not scheduled for relearning")
	}
}
func TestAnswerIdempotencyQueuesAndIsolation(t *testing.T) {
	a := testApp(t)
	c1, _ := guestCookie(t, a)
	c2, _ := guestCookie(t, a)
	rec := request(t, a, "GET", "/api/books/1", nil, c1)
	var detail struct {
		Book  Book   `json:"book"`
		Words []Word `json:"words"`
	}
	if e := json.Unmarshal(rec.Body.Bytes(), &detail); e != nil || len(detail.Words) < 20 {
		t.Fatalf("seed missing: %s", rec.Body.String())
	}
	word := detail.Words[0]
	payload := map[string]any{"wordId": word.ID, "mode": "sprint", "answer": "unsure-known", "eventId": "event-known-0001"}
	for range 2 {
		rec = request(t, a, "POST", "/api/study/answer", payload, c1)
		if rec.Code != 200 {
			t.Fatal(rec.Body.String())
		}
	}
	var events int
	a.db.QueryRow("SELECT COUNT(*) FROM answers").Scan(&events)
	if events != 1 {
		t.Fatalf("retry counted %d events", events)
	}
	payload["answer"] = "known"
	if request(t, a, "POST", "/api/study/answer", payload, c1).Code != 409 {
		t.Fatal("event ID conflict not rejected")
	}
	readQueue := func(mode string, cookieOwner int) []Word {
		t.Helper()
		cookie := c1
		if cookieOwner == 2 {
			cookie = c2
		}
		rr := request(t, a, "GET", fmt.Sprintf("/api/study?bookId=1&mode=%s", mode), nil, cookie)
		if rr.Code != 200 {
			t.Fatal(rr.Body.String())
		}
		var result struct {
			Words []Word `json:"words"`
		}
		json.Unmarshal(rr.Body.Bytes(), &result)
		return result.Words
	}
	reinforce := readQueue("reinforce", 1)
	if len(reinforce) != 1 || reinforce[0].ID != word.ID {
		t.Fatal("missing consolidation entry")
	}
	if len(readQueue("reinforce", 2)) != 0 {
		t.Fatal("learning state shared across users")
	}
	if len(readQueue("sprint", 1)) != len(detail.Words)-1 {
		t.Fatal("consolidation word still in upper queue")
	}
	payload["mode"] = "reinforce"
	payload["answer"] = "unknown"
	payload["eventId"] = "event-reject-0002"
	if rec = request(t, a, "POST", "/api/study/answer", payload, c1); rec.Code != 200 {
		t.Fatal(rec.Body.String())
	}
	if len(readQueue("reinforce", 1)) != 0 || len(readQueue("sprint", 1)) != len(detail.Words) {
		t.Fatal("failed consolidation not returned")
	}
	payload["mode"] = "sprint"
	payload["answer"] = "known"
	payload["eventId"] = "event-success-0003"
	if rec = request(t, a, "POST", "/api/study/answer", payload, c1); rec.Code != 200 {
		t.Fatal(rec.Body.String())
	}
	payload["eventId"] = "stale-second-tab-0004"
	if rec = request(t, a, "POST", "/api/study/answer", payload, c1); rec.Code != 409 {
		t.Fatal("stale sprint tab advanced repetition")
	}
	if len(readQueue("review", 1)) != 0 {
		t.Fatal("review available before due time")
	}
	if request(t, a, "GET", "/api/stats", nil, nil).Code != 401 {
		t.Fatal("stats exposed without session")
	}
	rec = request(t, a, "GET", "/api/stats", nil, c1)
	var stats struct {
		Learned, Today, Streak int
		Activity               []Activity
	}
	json.Unmarshal(rec.Body.Bytes(), &stats)
	if stats.Learned != 1 || stats.Today != 1 || stats.Streak != 1 || len(stats.Activity) != 14 {
		t.Fatalf("wrong persisted stats %s", rec.Body.String())
	}
}

func TestDeletedWordsDoNotReuseIdentity(t *testing.T) {
	a := testApp(t)
	var oldID int64
	if err := a.db.QueryRow("SELECT MAX(id) FROM words").Scan(&oldID); err != nil {
		t.Fatal(err)
	}
	if _, err := a.db.Exec("DELETE FROM words WHERE id=?", oldID); err != nil {
		t.Fatal(err)
	}
	result, err := a.db.Exec("INSERT INTO words(book_id,text,meaning) VALUES(1,'replacement','替代词')")
	if err != nil {
		t.Fatal(err)
	}
	newID, err := result.LastInsertId()
	if err != nil {
		t.Fatal(err)
	}
	if newID <= oldID {
		t.Fatal("deleted word identity was reused")
	}
}

func TestAnswerHistorySurvivesWordDeletion(t *testing.T) {
	a := testApp(t)
	cookie, _ := guestCookie(t, a)
	payload := map[string]any{"wordId": 1, "mode": "sprint", "answer": "known", "eventId": "durable-history-0001"}
	if rec := request(t, a, "POST", "/api/study/answer", payload, cookie); rec.Code != 200 {
		t.Fatal(rec.Body.String())
	}
	if _, err := a.db.Exec("DELETE FROM words WHERE id=1"); err != nil {
		t.Fatal(err)
	}
	if rec := request(t, a, "POST", "/api/study/answer", payload, cookie); rec.Code != 200 {
		t.Fatalf("deleted word lost idempotency: %s", rec.Body.String())
	}
	rec := request(t, a, "GET", "/api/stats", nil, cookie)
	var stats struct {
		Today  int
		Recent []Recent
	}
	json.Unmarshal(rec.Body.Bytes(), &stats)
	if stats.Today != 1 || len(stats.Recent) != 1 || stats.Recent[0].Text == "" {
		t.Fatalf("deletion changed learning history: %s", rec.Body.String())
	}
}
