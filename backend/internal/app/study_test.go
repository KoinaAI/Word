package app

import (
	"database/sql"
	"encoding/json"
	"fmt"
	"net/http/httptest"
	"reflect"
	"sync"
	"testing"
	"time"
)

func TestAnswerStateMachine(t *testing.T) {
	now := time.Date(2026, 11, 14, 23, 55, 0, 0, time.UTC)
	for _, start := range []progress{
		{Status: "new", Ease: 2.5},
		{Status: "learning", Reinforce: true, Due: sql.NullInt64{Int64: now.Add(time.Hour).Unix(), Valid: true}, Repetitions: 2, IntervalDays: 3, Ease: 2.1},
		{Status: "mastered", Due: sql.NullInt64{Int64: now.Add(7 * 24 * time.Hour).Unix(), Valid: true}, Repetitions: 3, IntervalDays: 7, Ease: 2.8},
	} {
		for _, mode := range []string{"learn", "review", "sprint", "reinforce"} {
			for _, answer := range []string{"known", "unknown", "unsure-known", "unsure-unknown"} {
				t.Run(start.Status+"/"+mode+"/"+answer, func(t *testing.T) {
					got := nextProgress(start, mode, answer, now)
					if mode == "sprint" && (answer == "unknown" || answer == "unsure-unknown") {
						if got != start {
							t.Fatalf("sprint miss changed state: %+v => %+v", start, got)
						}
						return
					}
					switch answer {
					case "known":
						if got.Status != "mastered" || got.Reinforce || got.Repetitions != start.Repetitions+1 || !got.Due.Valid || got.Due.Int64 != now.Add(time.Duration(got.IntervalDays)*24*time.Hour).Unix() {
							t.Fatalf("incorrect known state: %+v", got)
						}
					case "unsure-known":
						if got.Status != "learning" || !got.Reinforce || got.Repetitions != 0 || got.Due.Int64 != now.Add(24*time.Hour).Unix() {
							t.Fatalf("incorrect uncertain state: %+v", got)
						}
					default:
						if got.Status != "learning" || got.Repetitions != 0 || got.Due.Int64 != now.Add(10*time.Minute).Unix() || got.Reinforce != (start.Reinforce || mode == "reinforce") {
							t.Fatalf("incorrect relearning state: %+v", got)
						}
					}
				})
			}
		}
	}
	p := progress{Status: "new", Ease: 2.5}
	for _, days := range []int{1, 3, 7, 20} {
		p = nextProgress(p, "review", "known", now)
		if p.IntervalDays != days {
			t.Fatalf("review interval=%d, want %d", p.IntervalDays, days)
		}
		now = time.Unix(p.Due.Int64, 0)
	}
}

func decodeResponse[T any](t *testing.T, w *httptest.ResponseRecorder) T {
	t.Helper()
	expectStatus(t, w, 200)
	var result T
	if err := json.Unmarshal(w.Body.Bytes(), &result); err != nil {
		t.Fatal(err)
	}
	return result
}

func TestStudyIsolationIdempotencyAndQueues(t *testing.T) {
	a := testApp(t)
	cookie, _ := guestSession(t, a)
	other, _ := guestSession(t, a)
	books := decodeResponse[[]Book](t, request(t, a, "GET", "/api/books", "", cookie, ""))
	if len(books) != 6 {
		t.Fatalf("seed books=%d", len(books))
	}
	for _, book := range books {
		if book.WordCount < 20 || book.LearnedCount != 0 || book.DueCount != 0 {
			t.Fatalf("incorrect seed/progress: %+v", book)
		}
	}
	const answer = `{"wordId":1,"mode":"sprint","answer":"unknown","eventId":"miss-1"}`
	var group sync.WaitGroup
	responses := make([]*httptest.ResponseRecorder, 8)
	for i := range responses {
		group.Add(1)
		go func(i int) {
			defer group.Done()
			responses[i] = request(t, a, "POST", "/api/study/answer", answer, cookie, "")
		}(i)
	}
	group.Wait()
	for _, w := range responses {
		expectStatus(t, w, 200)
	}
	stats := decodeResponse[userStats](t, request(t, a, "GET", "/api/stats", "", cookie, ""))
	if stats.Today != 1 || stats.Learned != 0 || stats.Due != 0 || stats.TotalWords != 120 || stats.Streak != 1 || len(stats.Activity) != 30 {
		t.Fatalf("miss/retry fabricated stats: %+v", stats)
	}
	type queue struct {
		Words []Word `json:"words"`
		Total int    `json:"total"`
	}
	q := decodeResponse[queue](t, request(t, a, "GET", "/api/study?bookId=1&mode=sprint", "", cookie, ""))
	if q.Total != 20 || q.Words[0].Status != "new" || q.Words[0].DueAt != "" {
		t.Fatalf("sprint miss not retained: %+v", q)
	}
	expectStatus(t, request(t, a, "POST", "/api/study/answer", `{"wordId":1,"mode":"sprint","answer":"known","eventId":"miss-1"}`, cookie, ""), 409)
	expectStatus(t, request(t, a, "POST", "/api/study/answer", answer, other, ""), 200)
	expectStatus(t, request(t, a, "POST", "/api/study/answer", `{"wordId":1,"mode":"sprint","answer":"unsure-known","eventId":"uncertain"}`, cookie, ""), 200)
	q = decodeResponse[queue](t, request(t, a, "GET", "/api/study?bookId=1&mode=reinforce", "", cookie, ""))
	if q.Total != 1 || q.Words[0].Status != "learning" || !q.Words[0].Reinforce {
		t.Fatalf("uncertain answer missing from reinforcement: %+v", q)
	}
	expectStatus(t, request(t, a, "POST", "/api/favorites/1", `{"favorite":true}`, cookie, ""), 200)
	expectStatus(t, request(t, a, "POST", "/api/study/answer", `{"wordId":1,"mode":"reinforce","answer":"known","eventId":"reinforced"}`, cookie, ""), 200)
	favorites := decodeResponse[[]Word](t, request(t, a, "GET", "/api/favorites", "", cookie, ""))
	if len(favorites) != 1 || favorites[0].Status != "mastered" || favorites[0].Reinforce {
		t.Fatalf("reinforcement did not clear, or answer removed favorite: %+v", favorites)
	}
	otherFavorites := decodeResponse[[]Word](t, request(t, a, "GET", "/api/favorites", "", other, ""))
	if len(otherFavorites) != 0 {
		t.Fatal("favorites leaked across users")
	}
	before := favorites[0]
	expectStatus(t, request(t, a, "POST", "/api/study/answer", `{"wordId":1,"mode":"sprint","answer":"unsure-unknown","eventId":"miss-mastered"}`, cookie, ""), 200)
	favorites = decodeResponse[[]Word](t, request(t, a, "GET", "/api/favorites", "", cookie, ""))
	if !reflect.DeepEqual(before, favorites[0]) {
		t.Fatal("sprint unsure-unknown changed an existing mastered state")
	}
	expectStatus(t, request(t, a, "POST", "/api/study/answer", `{"wordId":2,"mode":"learn","answer":"unknown","eventId":"relearn"}`, cookie, ""), 200)
	q = decodeResponse[queue](t, request(t, a, "GET", "/api/study?bookId=1&mode=review", "", cookie, ""))
	if q.Total != 0 {
		t.Fatal("future review leaked into due queue")
	}
	now := a.now()
	a.now = func() time.Time { return now.Add(10 * time.Minute) }
	q = decodeResponse[queue](t, request(t, a, "GET", "/api/study?bookId=1&mode=review", "", cookie, ""))
	if q.Total != 1 || q.Words[0].ID != 2 {
		t.Fatalf("10-minute relearning boundary failed: %+v", q)
	}
	w := request(t, a, "POST", "/api/auth/register", `{"name":"Student","email":"student@example.com","password":"student-passphrase"}`, cookie, "")
	expectStatus(t, w, 200)
	registered := w.Result().Cookies()[0]
	stats = decodeResponse[userStats](t, request(t, a, "GET", "/api/stats", "", registered, ""))
	if stats.Learned != 1 || stats.Favorites != 1 || stats.Due != 1 || stats.Today != 5 {
		t.Fatalf("guest conversion lost progress/events: %+v", stats)
	}
	otherStats := decodeResponse[userStats](t, request(t, a, "GET", "/api/stats", "", other, ""))
	if otherStats.Learned != 0 || otherStats.Today != 1 || otherStats.Due != 0 {
		t.Fatalf("stats leaked across users: %+v", otherStats)
	}
}

func TestStatsUTCStreakAndSeedPersistence(t *testing.T) {
	a := testApp(t)
	cookie, _ := guestSession(t, a)
	now := a.now()
	for i, day := range []int{-3, -1, 0} {
		a.now = func() time.Time { return now.AddDate(0, 0, day) }
		expectStatus(t, request(t, a, "POST", "/api/study/answer", fmt.Sprintf(`{"wordId":1,"mode":"sprint","answer":"unknown","eventId":"day-%d"}`, i), cookie, ""), 200)
	}
	stats := decodeResponse[userStats](t, request(t, a, "GET", "/api/stats", "", cookie, ""))
	if stats.Streak != 2 || stats.Today != 1 || stats.Activity[29].Date != "2026-11-14" || stats.Activity[27].Count != 0 {
		t.Fatalf("incorrect UTC activity/streak: %+v", stats)
	}
	a.now = func() time.Time { return now.AddDate(0, 0, 1) }
	stats = decodeResponse[userStats](t, request(t, a, "GET", "/api/stats", "", cookie, ""))
	if stats.Streak != 2 || stats.Today != 0 {
		t.Fatal("streak should remain active through the next day")
	}
	if _, err := a.db.Exec("DELETE FROM books WHERE id=6"); err != nil {
		t.Fatal(err)
	}
	if err := initialize(t.Context(), a.db, a.cfg, a.now()); err != nil {
		t.Fatal(err)
	}
	books := decodeResponse[[]Book](t, request(t, a, "GET", "/api/books", "", cookie, ""))
	if len(books) != 5 {
		t.Fatal("restart resurrected an intentionally deleted seed book")
	}
}
