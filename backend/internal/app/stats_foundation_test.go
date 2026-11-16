package app

import (
	"context"
	"encoding/json"
	"fmt"
	"strings"
	"testing"
	"time"
)

func TestPersonalStatisticsAreIndexedAndExcludeUndoneAnswers(t *testing.T) {
	a := testApp(t)
	cookie, user := guestCookie(t, a)
	_, other := guestCookie(t, a)
	now := stamp(time.Now())
	yesterday := stamp(time.Now().Add(-24 * time.Hour))
	for index, item := range []struct {
		userID int64
		undone int
		date   string
	}{{user.ID, 0, now}, {user.ID, 1, now}, {other.ID, 0, now}, {user.ID, 1, yesterday}} {
		_, err := a.db.Exec("INSERT INTO answers(user_id,submitted_word_id,word_text,word_meaning,mode,answer,event_id,created_at,undone) VALUES(?,?,'word','meaning','sprint','known',?,?,?)", item.userID, index+1, fmt.Sprint("stats-event-", index), item.date, item.undone)
		if err != nil {
			t.Fatal(err)
		}
	}
	activity, err := a.activity(context.Background(), user.ID)
	if err != nil {
		t.Fatal(err)
	}
	sum := 0
	for _, day := range activity {
		sum += day.Count
	}
	if sum != 1 {
		t.Fatalf("wrong personal activity: %d", sum)
	}
	recent, err := a.recent(context.Background(), user.ID)
	if err != nil || len(recent) != 1 {
		t.Fatalf("wrong personal recent: %+v %v", recent, err)
	}
	streak, err := a.streak(context.Background(), user.ID)
	if err != nil || streak != 1 {
		t.Fatalf("undone answer affected streak: %d %v", streak, err)
	}
	rec := request(t, a, "GET", "/api/stats", nil, cookie)
	var stats struct {
		Today int `json:"today"`
	}
	if rec.Code != 200 || json.Unmarshal(rec.Body.Bytes(), &stats) != nil || stats.Today != 1 {
		t.Fatalf("wrong daily stats: %d %s", rec.Code, rec.Body.String())
	}
	for _, query := range []string{"EXPLAIN QUERY PLAN SELECT id FROM answers WHERE undone=0 AND user_id=? ORDER BY id DESC LIMIT 10", "EXPLAIN QUERY PLAN SELECT created_at FROM answers WHERE undone=0 AND user_id=? AND created_at>=?"} {
		args := []any{user.ID}
		if strings.Contains(query, "created_at>=?") {
			args = append(args, yesterday)
		}
		rows, err := a.db.Query(query, args...)
		if err != nil {
			t.Fatal(err)
		}
		plan := ""
		for rows.Next() {
			var id, parent, unused int
			var detail string
			if err = rows.Scan(&id, &parent, &unused, &detail); err != nil {
				t.Fatal(err)
			}
			plan += detail
		}
		rows.Close()
		if !strings.Contains(plan, "SEARCH answers USING INDEX answers_user_") {
			t.Fatalf("personal query did not use user index: %s", plan)
		}
	}
}
