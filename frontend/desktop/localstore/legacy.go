package localstore

import (
	"bufio"
	"database/sql"
	"encoding/json"
	"io/fs"
	"os"
	"path/filepath"
	"strings"
)

// importLegacy moves what the first offline build kept as plain files (outbox.jsonl, cursor.json, data\*.json,
// photos\*.json, device.json, users.json) into the database, in one transaction. Only after that commits are
// the old files renamed to <name>.imported, so a failure leaves them exactly where they were and the next
// start tries again. Protected files stay sealed: their bytes are copied as they are.
func importLegacy(db *sql.DB, dir string) error {
	type old struct{ path, name string }
	var files []old
	_ = filepath.WalkDir(dir, func(path string, d fs.DirEntry, err error) error {
		if err != nil || d.IsDir() {
			return nil
		}
		rel, rerr := filepath.Rel(dir, path)
		if rerr != nil {
			return nil
		}
		name := filepath.ToSlash(rel)
		if fileName.MatchString(name) {
			files = append(files, old{path, name})
		}
		return nil
	})
	outbox := filepath.Join(dir, legacyOutbx)
	_, outboxErr := os.Stat(outbox)
	hasOutbox := outboxErr == nil
	if len(files) == 0 && !hasOutbox {
		return nil
	}

	err := inTx(db, func(tx *sql.Tx) error {
		if hasOutbox {
			f, err := os.Open(outbox)
			if err != nil {
				return err
			}
			defer f.Close()
			sc := bufio.NewScanner(f)
			sc.Buffer(make([]byte, 64*1024), maxLine+1024)
			for sc.Scan() {
				line := strings.TrimSpace(sc.Text())
				if line == "" || !json.Valid([]byte(line)) {
					continue // a torn last line from a crash mid-write
				}
				if err := insertEntry(tx, line); err != nil {
					continue // a line with no id cannot be sent anyway
				}
			}
			if err := sc.Err(); err != nil {
				return err
			}
		}
		for _, o := range files {
			b, err := os.ReadFile(o.path)
			if err != nil {
				return err
			}
			// a file the database already has is newer than the old one
			if _, err := tx.Exec(`INSERT OR IGNORE INTO files (name, content, updated_at) VALUES (?, ?, strftime('%s','now') * 1000)`, o.name, b); err != nil {
				return err
			}
		}
		return nil
	})
	if err != nil {
		return err
	}
	if hasOutbox {
		_ = os.Rename(outbox, outbox+".imported")
	}
	for _, o := range files {
		_ = os.Rename(o.path, o.path+".imported")
	}
	return nil
}
