package app

import (
	"encoding/json"
	"net/http"
	"testing"
)

type savedLearnStep struct {
	OK            bool  `json:"ok"`
	LearnStage    int   `json:"learnStage"`
	LearnRevision int64 `json:"learnRevision"`
	Completed     bool  `json:"completed"`
}

func learnPayload(wordID int64, stage int, revision int64, answer, event string) map[string]any {
	return map[string]any{"wordId": wordID, "mode": "learn", "answer": answer, "eventId": event, "learnStage": stage, "learnRevision": revision}
}

func saveLearnStep(t *testing.T, a *App, cookie *http.Cookie, payload map[string]any, want savedLearnStep) string {
	t.Helper()
	rec := request(t, a, "POST", "/api/study/answer", payload, cookie)
	var result savedLearnStep
	if rec.Code != 200 || json.Unmarshal(rec.Body.Bytes(), &result) != nil || result != want {
		t.Fatalf("save step: status=%d body=%s want=%+v", rec.Code, rec.Body.String(), want)
	}
	return rec.Body.String()
}

func learnQueue(t *testing.T, a *App, cookie *http.Cookie) []Word {
	t.Helper()
	rec := request(t, a, "GET", "/api/study?bookId=1&mode=learn", nil, cookie)
	var result struct{ Words []Word }
	if rec.Code != 200 || json.Unmarshal(rec.Body.Bytes(), &result) != nil || len(result.Words) == 0 {
		t.Fatalf("learn queue: %d %s", rec.Code, rec.Body.String())
	}
	return result.Words
}

func TestLearnStagesPersistResetAndSettleOnce(t *testing.T) {
	a := testApp(t)
	cookie, user := guestCookie(t, a)
	other, _ := guestCookie(t, a)
	word := learnQueue(t, a, cookie)[0]
	if word.LearnStage != 0 || word.LearnRevision != 0 {
		t.Fatal("new word did not start at English-to-Chinese stage")
	}
	first := learnPayload(word.ID, 0, 0, "known", "learn-first-0001")
	firstResult := saveLearnStep(t, a, cookie, first, savedLearnStep{true, 1, 1, false})
	if again := saveLearnStep(t, a, cookie, first, savedLearnStep{true, 1, 1, false}); firstResult != again {
		t.Fatal("retry changed the stored response")
	}
	partial := learnQueue(t, a, cookie)[0]
	if partial.ID != word.ID || partial.LearnStage != 1 || partial.LearnRevision != 1 || partial.Status != "new" || partial.DueAt != "" {
		t.Fatalf("first stage prematurely completed word: %+v", partial)
	}
	if untouched := learnQueue(t, a, other)[0]; untouched.LearnStage != 0 || untouched.LearnRevision != 0 {
		t.Fatal("learning stages leaked between users")
	}
	// The stage is durable across API processes, not just a UI queue snapshot.
	cfg := a.cfg
	if err := a.Close(); err != nil {
		t.Fatal(err)
	}
	var err error
	a, err = New(cfg)
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { a.Close() })
	resumed := learnQueue(t, a, cookie)[0]
	if resumed.LearnStage != 1 || resumed.LearnRevision != 1 {
		t.Fatalf("restart lost the second-stage position: %+v", resumed)
	}
	saveLearnStep(t, a, cookie, learnPayload(word.ID, 1, 1, "unknown", "learn-wrong-0002"), savedLearnStep{true, 0, 2, false})
	reset := learnQueue(t, a, cookie)[0]
	if reset.LearnStage != 0 || reset.LearnRevision != 2 || reset.Status != "new" || reset.DueAt != "" {
		t.Fatalf("wrong answer failed to reset only this word's stages: %+v", reset)
	}
	stale := learnPayload(word.ID, 0, 0, "known", "learn-stale-0003")
	if rec := request(t, a, "POST", "/api/study/answer", stale, cookie); rec.Code != 409 {
		t.Fatalf("old stage-zero request accepted after reset: %d %s", rec.Code, rec.Body.String())
	}
	saveLearnStep(t, a, cookie, learnPayload(word.ID, 0, 2, "known", "learn-restart-0004"), savedLearnStep{true, 1, 3, false})
	complete := learnPayload(word.ID, 1, 3, "known", "learn-complete-0005")
	saveLearnStep(t, a, cookie, complete, savedLearnStep{true, 2, 4, true})
	// Lost responses are replayed verbatim even after later stages have completed.
	saveLearnStep(t, a, cookie, first, savedLearnStep{true, 1, 1, false})
	saveLearnStep(t, a, cookie, complete, savedLearnStep{true, 2, 4, true})
	for _, queued := range learnQueue(t, a, cookie) {
		if queued.ID == word.ID {
			t.Fatal("completed word remained in new-word queue")
		}
	}
	var status, due string
	var repetitions int
	if err := a.db.QueryRow("SELECT status,due_at,repetitions FROM progress WHERE user_id=? AND word_id=?", user.ID, word.ID).Scan(&status, &due, &repetitions); err != nil || status != "mastered" || repetitions != 1 || due == "" {
		t.Fatalf("completed word not settled exactly once: %s %s %d %v", status, due, repetitions, err)
	}
	var events int
	if err := a.db.QueryRow("SELECT COUNT(*) FROM answers WHERE user_id=?", user.ID).Scan(&events); err != nil || events != 4 {
		t.Fatalf("real attempts/retries counted incorrectly: %d %v", events, err)
	}
	stats := request(t, a, "GET", "/api/stats", nil, cookie)
	var counts struct{ Learned, Today int }
	if err := json.Unmarshal(stats.Body.Bytes(), &counts); err != nil || counts.Learned != 1 || counts.Today != 1 {
		t.Fatalf("multiple stages counted as multiple words: %s", stats.Body.String())
	}
	conflict := learnPayload(word.ID, 0, 2, "known", "learn-first-0001")
	if rec := request(t, a, "POST", "/api/study/answer", conflict, cookie); rec.Code != 409 {
		t.Fatal("event reused with changed stage revision")
	}
	if _, err := a.db.Exec("DELETE FROM words WHERE id=?", word.ID); err != nil {
		t.Fatal(err)
	}
	saveLearnStep(t, a, cookie, complete, savedLearnStep{true, 2, 4, true})
}

func TestLearnStagesValidateInputsAndInvalidateOtherModes(t *testing.T) {
	a := testApp(t)
	cookie, _ := guestCookie(t, a)
	word := learnQueue(t, a, cookie)[0]
	for name, mutate := range map[string]func(map[string]any){
		"legacy":         func(p map[string]any) { delete(p, "learnStage"); delete(p, "learnRevision") },
		"missing-stage":  func(p map[string]any) { delete(p, "learnStage") },
		"null-revision":  func(p map[string]any) { p["learnRevision"] = nil },
		"invalid-stage":  func(p map[string]any) { p["learnStage"] = 2 },
		"negative":       func(p map[string]any) { p["learnRevision"] = -1 },
		"unsafe-integer": func(p map[string]any) { p["learnRevision"] = int64(9007199254740991) },
		"wrong-mode":     func(p map[string]any) { p["mode"] = "sprint" },
	} {
		t.Run(name, func(t *testing.T) {
			payload := learnPayload(word.ID, 0, 0, "known", "invalid-event-0001")
			mutate(payload)
			if rec := request(t, a, "POST", "/api/study/answer", payload, cookie); rec.Code != 400 {
				t.Fatalf("invalid input accepted: %d %s", rec.Code, rec.Body.String())
			}
		})
	}
	saveLearnStep(t, a, cookie, learnPayload(word.ID, 0, 0, "known", "cross-first-0001"), savedLearnStep{true, 1, 1, false})
	for _, payload := range []map[string]any{
		{"wordId": word.ID, "mode": "sprint", "answer": "unsure-known", "eventId": "cross-sprint-0002"},
		{"wordId": word.ID, "mode": "reinforce", "answer": "unknown", "eventId": "cross-reset-0003"},
	} {
		if rec := request(t, a, "POST", "/api/study/answer", payload, cookie); rec.Code != 200 {
			t.Fatal(rec.Body.String())
		}
	}
	resumed := learnQueue(t, a, cookie)[0]
	if resumed.LearnStage != 0 || resumed.LearnRevision != 3 || resumed.Status != "new" {
		t.Fatalf("other mode retained stale learn stage: %+v", resumed)
	}
	stale := learnPayload(word.ID, 1, 1, "known", "cross-stale-0004")
	if rec := request(t, a, "POST", "/api/study/answer", stale, cookie); rec.Code != 409 {
		t.Fatal("old learn request survived a different mode's reset")
	}
	saveLearnStep(t, a, cookie, learnPayload(word.ID, 0, 3, "unknown", "cross-wrong-0005"), savedLearnStep{true, 0, 4, false})
	// A failed sprint is observational and must not discard partially practiced progress.
	if rec := request(t, a, "POST", "/api/study/answer", map[string]any{"wordId": word.ID, "mode": "sprint", "answer": "unknown", "eventId": "cross-unknown-0006"}, cookie); rec.Code != 200 {
		t.Fatal(rec.Body.String())
	}
	saveLearnStep(t, a, cookie, learnPayload(word.ID, 0, 4, "known", "cross-resume-0007"), savedLearnStep{true, 1, 5, false})
}

func TestLearnStagesInitializeExistingDatabaseWithoutRewritingProgress(t *testing.T) {
	a := testApp(t)
	cookie, user := guestCookie(t, a)
	payload := map[string]any{"wordId": 1, "mode": "sprint", "answer": "known", "eventId": "legacy-sprint-0001"}
	if rec := request(t, a, "POST", "/api/study/answer", payload, cookie); rec.Code != 200 {
		t.Fatal(rec.Body.String())
	}
	// A populated pre-feature database has the original schema and no stage tables.
	if _, err := a.db.Exec("DROP TABLE learn_answer_steps; DROP TABLE learn_progress"); err != nil {
		t.Fatal(err)
	}
	cfg := a.cfg
	a.Close()
	reopened, err := New(cfg)
	if err != nil {
		t.Fatal(err)
	}
	defer reopened.Close()
	var status string
	var events int
	if err := reopened.db.QueryRow("SELECT status FROM progress WHERE user_id=? AND word_id=1", user.ID).Scan(&status); err != nil || status != "mastered" {
		t.Fatalf("upgrade changed existing mastery: %s %v", status, err)
	}
	if err := reopened.db.QueryRow("SELECT COUNT(*) FROM answers WHERE user_id=?", user.ID).Scan(&events); err != nil || events != 1 {
		t.Fatalf("upgrade changed existing answer history: %d %v", events, err)
	}
	word := learnQueue(t, reopened, cookie)[0]
	saveLearnStep(t, reopened, cookie, learnPayload(word.ID, 0, 0, "known", "upgraded-stage-0002"), savedLearnStep{true, 1, 1, false})
}
