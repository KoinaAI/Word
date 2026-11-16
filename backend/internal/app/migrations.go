package app

import (
	"context"
	"database/sql"
	"fmt"
	"strings"
)

const schemaVersion = 1

// migrate upgrades legacy stores atomically on a single connection. Foreign keys
// must be disabled before the transaction while parent tables are rebuilt; the
// reference names remain unchanged and are checked before committing.
func (a *App) migrate() (resultErr error) {
	ctx := context.Background()
	conn, err := a.db.Conn(ctx)
	if err != nil {
		return err
	}
	defer conn.Close()
	var version int
	if err = conn.QueryRowContext(ctx, "PRAGMA user_version").Scan(&version); err != nil {
		return err
	}
	if version > schemaVersion {
		return fmt.Errorf("database schema version %d is newer than supported version %d", version, schemaVersion)
	}
	if _, err = conn.ExecContext(ctx, "PRAGMA foreign_keys=OFF"); err != nil {
		return err
	}
	defer func() {
		_, restoreErr := conn.ExecContext(ctx, "PRAGMA foreign_keys=ON")
		if restoreErr == nil {
			var enabled int
			restoreErr = conn.QueryRowContext(ctx, "PRAGMA foreign_keys").Scan(&enabled)
			if restoreErr == nil && enabled != 1 {
				restoreErr = fmt.Errorf("foreign keys could not be restored after migration")
			}
		}
		if resultErr == nil {
			resultErr = restoreErr
		}
	}()
	tx, err := conn.BeginTx(ctx, nil)
	if err != nil {
		return err
	}
	defer tx.Rollback()
	raw, err := assets.ReadFile("schema.sql")
	if err != nil {
		return err
	}
	schema := string(raw)
	// Create missing tables first; indexes that depend on upgraded columns are
	// installed only after legacy tables have reached the target schema.
	for _, statement := range strings.Split(schema, ";") {
		if strings.HasPrefix(strings.TrimSpace(statement), "CREATE TABLE") {
			if _, err = tx.ExecContext(ctx, statement); err != nil {
				return err
			}
		}
	}
	if version < 1 {
		// These are the four identity tables predating AUTOINCREMENT. Rebuilding
		// only legacy tables preserves sqlite_sequence high water marks in stores
		// that already used AUTOINCREMENT.
		for _, table := range []string{"books", "users", "words", "answers"} {
			var definition string
			if err = tx.QueryRow("SELECT sql FROM sqlite_schema WHERE type='table' AND name=?", table).Scan(&definition); err != nil {
				return err
			}
			columns, err := tableColumns(tx, table)
			if err != nil {
				return err
			}
			needsRebuild := !strings.Contains(strings.ToUpper(definition), "AUTOINCREMENT") || (table == "answers" && !columns["submitted_word_id"])
			if needsRebuild {
				if err = rebuildIdentityTable(tx, schema, table, columns); err != nil {
					return fmt.Errorf("migrate %s: %w", table, err)
				}
			}
		}
		columns, err := tableColumns(tx, "words")
		if err != nil {
			return err
		}
		if !columns["content_version"] {
			if _, err = tx.Exec("ALTER TABLE words ADD COLUMN content_version INTEGER NOT NULL DEFAULT 1"); err != nil {
				return err
			}
		}
		columns, err = tableColumns(tx, "answers")
		if err != nil {
			return err
		}
		if !columns["undone"] {
			if _, err = tx.Exec("ALTER TABLE answers ADD COLUMN undone INTEGER NOT NULL DEFAULT 0 CHECK(undone IN(0,1))"); err != nil {
				return err
			}
		}
		if _, err = tx.Exec("PRAGMA user_version=1"); err != nil {
			return err
		}
	}
	// CREATE IF NOT EXISTS also repairs optional tables absent from a prior build.
	if _, err = tx.ExecContext(ctx, schema); err != nil {
		return err
	}
	rows, err := tx.Query("PRAGMA foreign_key_check")
	if err != nil {
		return err
	}
	invalid := rows.Next()
	rowErr := rows.Err()
	rows.Close()
	if rowErr != nil {
		return rowErr
	}
	if invalid {
		return fmt.Errorf("database migration failed foreign key validation")
	}
	return tx.Commit()
}

func tableColumns(tx *sql.Tx, table string) (map[string]bool, error) {
	rows, err := tx.Query("PRAGMA table_info(" + table + ")")
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	columns := map[string]bool{}
	for rows.Next() {
		var index, notNull, primaryKey int
		var name, typ string
		var defaultValue any
		if err = rows.Scan(&index, &name, &typ, &notNull, &defaultValue, &primaryKey); err != nil {
			return nil, err
		}
		columns[name] = true
	}
	return columns, rows.Err()
}

func rebuildIdentityTable(tx *sql.Tx, schema, table string, existing map[string]bool) error {
	prefix := "CREATE TABLE IF NOT EXISTS " + table + " ("
	start := strings.Index(schema, prefix)
	if start < 0 {
		return fmt.Errorf("table definition is missing")
	}
	end := strings.Index(schema[start:], ");")
	if end < 0 {
		return fmt.Errorf("table definition is incomplete")
	}
	create := schema[start : start+end+2]
	temporary := "migrate_" + table
	create = strings.Replace(create, prefix, "CREATE TABLE "+temporary+" (", 1)
	var sequence int64
	// An already-autoincrement table may still need an additive-column rebuild.
	// Keep its sequence high-water mark even when its largest row was deleted.
	var sequenceExists int
	if err := tx.QueryRow("SELECT COUNT(*) FROM sqlite_schema WHERE type='table' AND name='sqlite_sequence'").Scan(&sequenceExists); err != nil {
		return err
	}
	if sequenceExists != 0 {
		err := tx.QueryRow("SELECT seq FROM sqlite_sequence WHERE name=?", table).Scan(&sequence)
		if err != nil && err != sql.ErrNoRows {
			return err
		}
	}
	if _, err := tx.Exec(create); err != nil {
		return err
	}
	// Copy columns explicitly so future schema additions cannot reorder data.
	targetColumns := map[string][]string{
		"books":   {"id", "title", "subtitle", "description", "category", "color", "created_at"},
		"users":   {"id", "name", "email", "password_hash", "role", "guest", "daily_goal", "exam_date", "active_book_id", "created_at"},
		"words":   {"id", "book_id", "text", "phonetic", "meaning", "example", "example_meaning", "content_version"},
		"answers": {"id", "user_id", "word_id", "submitted_word_id", "word_text", "word_meaning", "mode", "answer", "event_id", "created_at", "undone"},
	}[table]
	expressions := make([]string, len(targetColumns))
	for i, name := range targetColumns {
		if existing[name] {
			expressions[i] = name
			continue
		}
		switch name {
		case "content_version":
			expressions[i] = "1"
		case "undone":
			expressions[i] = "0"
		case "submitted_word_id":
			// Deleted legacy words have no recoverable original ID. A per-answer
			// negative surrogate preserves history without colliding with live IDs;
			// exact historical word de-duplication cannot be reconstructed.
			expressions[i] = "COALESCE(word_id,-id)"
		default:
			return fmt.Errorf("missing legacy column %s", name)
		}
	}
	if _, err := tx.Exec("INSERT INTO " + temporary + "(" + strings.Join(targetColumns, ",") + ") SELECT " + strings.Join(expressions, ",") + " FROM " + table); err != nil {
		return err
	}
	if _, err := tx.Exec("DROP TABLE " + table); err != nil {
		return err
	}
	if _, err := tx.Exec("ALTER TABLE " + temporary + " RENAME TO " + table); err != nil {
		return err
	}
	if sequence > 0 {
		if _, err := tx.Exec("UPDATE sqlite_sequence SET seq=MAX(seq,?) WHERE name=?", sequence, table); err != nil {
			return err
		}
	}
	return nil
}
