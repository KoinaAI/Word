package app

import (
	"database/sql"
	"os"
	"path/filepath"
	"strings"
	"testing"
)

func TestMigrateHistoricalStorePreservesIdentitiesAndHistory(t *testing.T) {
	path := filepath.Join(t.TempDir(), "legacy.db")
	db, err := sql.Open("sqlite", path)
	if err != nil {
		t.Fatal(err)
	}
	legacy, err := os.ReadFile("testdata/legacy-schema.sql")
	if err != nil {
		t.Fatal(err)
	}
	if _, err = db.Exec(string(legacy)); err != nil {
		t.Fatal(err)
	}
	_, err = db.Exec(`
INSERT INTO metadata VALUES('seed_v1','done');
INSERT INTO books(id,title,created_at) VALUES(7,'Legacy','2026-01-01');
INSERT INTO users(id,name,active_book_id,created_at) VALUES(9,'Learner',7,'2026-01-01');
INSERT INTO words(id,book_id,text,meaning) VALUES(13,7,'legacy','历史');
INSERT INTO sessions VALUES('hash',9,'2099-01-01');
INSERT INTO progress(user_id,word_id,status,updated_at) VALUES(9,13,'mastered','2026-01-01');
INSERT INTO favorites VALUES(9,13);
INSERT INTO answers(id,user_id,word_id,word_text,word_meaning,mode,answer,event_id,created_at) VALUES(17,9,13,'legacy','历史','sprint','known','old-event','2026-01-01'),(18,9,NULL,'deleted','删除词','sprint','known','deleted-event','2026-01-01');`)
	if err != nil {
		t.Fatal(err)
	}
	db.Close()
	a, err := New(Config{DBPath: path})
	if err != nil {
		t.Fatal(err)
	}
	defer a.Close()
	for _, table := range []string{"books", "users", "words", "answers"} {
		var definition string
		if err = a.db.QueryRow("SELECT sql FROM sqlite_schema WHERE type='table' AND name=?", table).Scan(&definition); err != nil || !strings.Contains(definition, "AUTOINCREMENT") {
			t.Fatalf("%s not upgraded: %s %v", table, definition, err)
		}
	}
	var submitted int64
	if err = a.db.QueryRow("SELECT submitted_word_id FROM answers WHERE id=17").Scan(&submitted); err != nil || submitted != 13 {
		t.Fatalf("live history lost: %d %v", submitted, err)
	}
	if err = a.db.QueryRow("SELECT submitted_word_id FROM answers WHERE id=18").Scan(&submitted); err != nil || submitted != -18 {
		t.Fatalf("deleted history collided: %d %v", submitted, err)
	}
	for _, table := range []string{"sessions", "progress", "favorites"} {
		var count int
		if err = a.db.QueryRow("SELECT COUNT(*) FROM " + table).Scan(&count); err != nil || count != 1 {
			t.Fatalf("%s data lost: %d %v", table, count, err)
		}
	}
	if err = a.migrate(); err != nil {
		t.Fatalf("not idempotent: %v", err)
	}
	if _, err = a.db.Exec("DELETE FROM words WHERE id=13"); err != nil {
		t.Fatal(err)
	}
	result, err := a.db.Exec("INSERT INTO words(book_id,text,meaning) VALUES(7,'later','以后')")
	if err != nil {
		t.Fatal(err)
	}
	id, _ := result.LastInsertId()
	if id <= 13 {
		t.Fatalf("migrated word ID reused: %d", id)
	}
	var foreignKeys int
	a.db.QueryRow("PRAGMA foreign_keys").Scan(&foreignKeys)
	if foreignKeys != 1 {
		t.Fatal("foreign keys were not restored")
	}
}

func TestMigrationRetainsExistingAutoIncrementHighWaterMark(t *testing.T) {
	a := testApp(t)
	if _, err := a.db.Exec("INSERT INTO words(id,book_id,text,meaning) VALUES(1000,1,'high-water','高水位'); DELETE FROM words WHERE id=1000; PRAGMA user_version=0"); err != nil {
		t.Fatal(err)
	}
	if err := a.migrate(); err != nil {
		t.Fatal(err)
	}
	result, err := a.db.Exec("INSERT INTO words(book_id,text,meaning) VALUES(1,'after-high-water','以后')")
	if err != nil {
		t.Fatal(err)
	}
	id, _ := result.LastInsertId()
	if id <= 1000 {
		t.Fatalf("auto increment history reset: %d", id)
	}
	if _, err = a.db.Exec("PRAGMA user_version=999"); err != nil {
		t.Fatal(err)
	}
	if err = a.migrate(); err == nil {
		t.Fatal("future schema was accepted")
	}
}

func TestMigrationPreservesSequenceWhenRebuildingMixedLegacyTable(t *testing.T) {
	path := filepath.Join(t.TempDir(), "mixed.db")
	db, err := sql.Open("sqlite", path)
	if err != nil {
		t.Fatal(err)
	}
	legacy, err := os.ReadFile("testdata/legacy-schema.sql")
	if err != nil {
		t.Fatal(err)
	}
	schema := strings.Replace(string(legacy), "CREATE TABLE IF NOT EXISTS answers (\n id INTEGER PRIMARY KEY,", "CREATE TABLE IF NOT EXISTS answers (\n id INTEGER PRIMARY KEY AUTOINCREMENT,", 1)
	if _, err = db.Exec(schema); err != nil {
		t.Fatal(err)
	}
	_, err = db.Exec(`INSERT INTO metadata VALUES('seed_v1','done'); INSERT INTO books(id,title,created_at) VALUES(1,'book','2026-01-01'); INSERT INTO users(id,name,created_at) VALUES(1,'user','2026-01-01'); INSERT INTO answers(id,user_id,word_id,word_text,word_meaning,mode,answer,event_id,created_at) VALUES(1000,1,NULL,'gone','gone','sprint','known','gone','2026-01-01'); DELETE FROM answers WHERE id=1000;`)
	if err != nil {
		t.Fatal(err)
	}
	db.Close()
	a, err := New(Config{DBPath: path})
	if err != nil {
		t.Fatal(err)
	}
	defer a.Close()
	result, err := a.db.Exec("INSERT INTO answers(user_id,submitted_word_id,word_text,word_meaning,mode,answer,event_id,created_at) VALUES(1,-1,'later','later','sprint','known','later','2026-01-01')")
	if err != nil {
		t.Fatal(err)
	}
	id, _ := result.LastInsertId()
	if id <= 1000 {
		t.Fatalf("rebuilt answer sequence reset: %d", id)
	}
}
