package app

import (
	"context"
	"database/sql"
	"fmt"
	"net/url"
	"os"
	"path/filepath"
	"time"

	"golang.org/x/crypto/bcrypt"
	_ "modernc.org/sqlite"
)

const schema = `
CREATE TABLE IF NOT EXISTS metadata (key TEXT PRIMARY KEY, value TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS books (
 id INTEGER PRIMARY KEY, title TEXT NOT NULL, subtitle TEXT NOT NULL DEFAULT '',
 description TEXT NOT NULL DEFAULT '', category TEXT NOT NULL DEFAULT '', color TEXT NOT NULL DEFAULT ''
);
CREATE TABLE IF NOT EXISTS words (
 id INTEGER PRIMARY KEY AUTOINCREMENT, book_id INTEGER NOT NULL REFERENCES books(id) ON DELETE CASCADE,
 text TEXT NOT NULL COLLATE NOCASE, phonetic TEXT NOT NULL DEFAULT '', meaning TEXT NOT NULL,
 example TEXT NOT NULL DEFAULT '', example_meaning TEXT NOT NULL DEFAULT '', UNIQUE(book_id, text)
);
CREATE TABLE IF NOT EXISTS users (
 id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT NOT NULL, email TEXT UNIQUE COLLATE NOCASE,
 password_hash TEXT NOT NULL DEFAULT '', role TEXT NOT NULL DEFAULT 'user' CHECK(role IN ('user','admin')),
 guest INTEGER NOT NULL DEFAULT 0 CHECK(guest IN (0,1)), daily_goal INTEGER NOT NULL DEFAULT 20 CHECK(daily_goal BETWEEN 1 AND 1000),
 exam_date TEXT NOT NULL DEFAULT '', active_book_id INTEGER REFERENCES books(id) ON DELETE SET NULL,
 created_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS sessions (
 token_hash TEXT PRIMARY KEY, user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE, expires_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS sessions_user ON sessions(user_id);
CREATE INDEX IF NOT EXISTS sessions_expiry ON sessions(expires_at);
CREATE TABLE IF NOT EXISTS progress (
 user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
 word_id INTEGER NOT NULL REFERENCES words(id) ON DELETE CASCADE,
 status TEXT NOT NULL DEFAULT 'new' CHECK(status IN ('new','learning','mastered')),
 reinforce INTEGER NOT NULL DEFAULT 0 CHECK(reinforce IN (0,1)),
 favorite INTEGER NOT NULL DEFAULT 0 CHECK(favorite IN (0,1)), due_at INTEGER,
 repetitions INTEGER NOT NULL DEFAULT 0, interval_days INTEGER NOT NULL DEFAULT 0,
 ease REAL NOT NULL DEFAULT 2.5, PRIMARY KEY(user_id,word_id)
);
CREATE INDEX IF NOT EXISTS progress_due ON progress(user_id,due_at);
CREATE TABLE IF NOT EXISTS events (
 id INTEGER PRIMARY KEY AUTOINCREMENT, user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
 event_id TEXT NOT NULL, word_id INTEGER NOT NULL, mode TEXT NOT NULL, answer TEXT NOT NULL,
 text TEXT NOT NULL, meaning TEXT NOT NULL, created_at INTEGER NOT NULL, UNIQUE(user_id,event_id)
);
CREATE INDEX IF NOT EXISTS events_user_time ON events(user_id,created_at);
CREATE INDEX IF NOT EXISTS events_time ON events(created_at);
CREATE TABLE IF NOT EXISTS navigation (
 id INTEGER PRIMARY KEY, label TEXT NOT NULL, path TEXT NOT NULL UNIQUE, icon TEXT NOT NULL,
 enabled INTEGER NOT NULL CHECK(enabled IN (0,1)), sort_order INTEGER NOT NULL
);
INSERT OR IGNORE INTO navigation VALUES
 (1,'概览','/admin','LayoutDashboard',1,0),
 (2,'词书管理','/admin/books','BookOpen',1,1),
 (3,'用户管理','/admin/users','Users',1,2),
 (4,'导航管理','/admin/navigation','Navigation',1,3);
`

func openStore(ctx context.Context, c Config, now time.Time) (*sql.DB, error) {
	absolute, err := filepath.Abs(c.DBPath)
	if err != nil {
		return nil, err
	}
	if err = os.MkdirAll(filepath.Dir(absolute), 0700); err != nil {
		return nil, fmt.Errorf("create database directory: %w", err)
	}
	u := url.URL{Scheme: "file", Path: absolute}
	q := u.Query()
	q.Set("_foreign_keys", "on")
	q.Set("_busy_timeout", "5000")
	q.Set("_journal_mode", "WAL")
	u.RawQuery = q.Encode()
	db, err := sql.Open("sqlite", u.String())
	if err != nil {
		return nil, err
	}
	// A single connection serializes SQLite writes and avoids read-to-write upgrade races.
	db.SetMaxOpenConns(1)
	db.SetMaxIdleConns(1)
	if err = initialize(ctx, db, c, now); err != nil {
		db.Close()
		return nil, err
	}
	if err = os.Chmod(absolute, 0600); err != nil {
		db.Close()
		return nil, fmt.Errorf("secure database permissions: %w", err)
	}
	return db, nil
}

func initialize(ctx context.Context, db *sql.DB, c Config, now time.Time) error {
	tx, err := db.BeginTx(ctx, nil)
	if err != nil {
		return err
	}
	defer tx.Rollback()
	if _, err = tx.ExecContext(ctx, schema); err != nil {
		return fmt.Errorf("initialize schema: %w", err)
	}
	var admins int
	if err = tx.QueryRowContext(ctx, "SELECT COUNT(*) FROM users WHERE role='admin'").Scan(&admins); err != nil {
		return err
	}
	if admins == 0 {
		if !validPassword(c.AdminPassword, 10) {
			return fmt.Errorf("ADMIN_PASSWORD must contain at least 10 characters and at most 72 bytes for first initialization")
		}
		email, err := normalizeEmail(c.AdminEmail)
		if err != nil {
			return fmt.Errorf("ADMIN_EMAIL is invalid")
		}
		hash, err := bcrypt.GenerateFromPassword([]byte(c.AdminPassword), bcrypt.DefaultCost)
		if err != nil {
			return err
		}
		if _, err = tx.ExecContext(ctx, "INSERT INTO users(name,email,password_hash,role,created_at) VALUES(?,?,?,'admin',?)", "管理员", email, string(hash), now.Unix()); err != nil {
			return fmt.Errorf("initialize administrator: %w", err)
		}
	}
	if err = seedCatalog(ctx, tx); err != nil {
		return fmt.Errorf("seed curated books: %w", err)
	}
	return tx.Commit()
}

type scanner interface{ Scan(...any) error }

const userColumns = `u.id,u.name,COALESCE(u.email,''),u.role,u.guest,u.daily_goal,u.exam_date,COALESCE(u.active_book_id,0)`

func scanUser(row scanner) (User, error) {
	var u User
	err := row.Scan(&u.ID, &u.Name, &u.Email, &u.Role, &u.Guest, &u.DailyGoal, &u.ExamDate, &u.ActiveBookID)
	return u, err
}

func isoTime(seconds int64) string { return time.Unix(seconds, 0).UTC().Format(time.RFC3339) }
