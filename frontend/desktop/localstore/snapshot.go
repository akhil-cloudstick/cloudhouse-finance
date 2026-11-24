package localstore

import (
	"database/sql"
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"strings"
	"time"
)

// Moving the data to another PC. The main PC makes a consistent snapshot of its database, the new main PC downloads and
// checks it, and only then swaps it in, keeping its own file as a backup. The snapshot leaves out the two files that name
// the PC itself (the device key and the saved sign-ins): those never leave the PC they belong to.

// identityFiles never travel with a snapshot.
var identityFiles = []string{"device.json", "users.json"}

// Dir is the folder of the opened business's database (offline.db and its siblings).
func (s *Store) Dir() (string, error) {
	p, err := s.DBPath()
	if err != nil {
		return "", err
	}
	return filepath.Dir(p), nil
}

// Snapshot writes a consistent copy of the open database to dst (a new file), without the identity files. The store keeps
// working on its own file; only the copy is changed.
func (s *Store) Snapshot(dst string) error {
	db, err := s.conn()
	if err != nil {
		return err
	}
	if err := os.MkdirAll(filepath.Dir(dst), 0o700); err != nil {
		return err
	}
	_ = os.Remove(dst)
	// VACUUM INTO writes one complete, defragmented file from a consistent view of the database
	if _, err := db.Exec(`VACUUM INTO '` + strings.ReplaceAll(dst, `'`, `''`) + `'`); err != nil {
		return fmt.Errorf("making the snapshot: %w", err)
	}
	cp, err := sql.Open("sqlite", dst)
	if err != nil {
		return err
	}
	defer cp.Close()
	for _, name := range identityFiles {
		if _, err := cp.Exec(`DELETE FROM files WHERE name = ?`, name); err != nil {
			return err
		}
	}
	return nil
}

// VerifyDB checks a database file (integrity and a readable count for every table) and returns the number of rows in each
// table. It opens the file read only and changes nothing.
func VerifyDB(path string) (map[string]int, error) {
	db, err := sql.Open("sqlite", "file:"+strings.ReplaceAll(path, `\`, "/")+"?mode=ro")
	if err != nil {
		return nil, err
	}
	defer db.Close()
	var check string
	if err := db.QueryRow(`PRAGMA integrity_check`).Scan(&check); err != nil {
		return nil, fmt.Errorf("the copy cannot be read: %w", err)
	}
	if check != "ok" {
		return nil, fmt.Errorf("the copy is damaged: %s", check)
	}
	rows, err := db.Query(`SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%'`)
	if err != nil {
		return nil, err
	}
	var names []string
	for rows.Next() {
		var n string
		if err := rows.Scan(&n); err != nil {
			rows.Close()
			return nil, err
		}
		names = append(names, n)
	}
	rows.Close()
	counts := make(map[string]int, len(names))
	for _, n := range names {
		var c int
		if err := db.QueryRow(`SELECT COUNT(*) FROM "` + strings.ReplaceAll(n, `"`, `""`) + `"`).Scan(&c); err != nil {
			return nil, fmt.Errorf("table %s cannot be read: %w", n, err)
		}
		counts[n] = c
	}
	return counts, nil
}

// ReplaceDB swaps a checked snapshot in as this store's database. The current file is kept beside it as
// offline.db.before-move-<time> and its path is returned. If anything goes wrong the current file is put back.
func (s *Store) ReplaceDB(snapshot string) (string, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	if s.db == nil {
		return "", errors.New("store is not open")
	}
	dir := s.dir
	live := filepath.Join(dir, dbFile)
	backup := fmt.Sprintf("%s.before-move-%d", live, time.Now().Unix())

	s.closeLocked() // folds the write-ahead log into offline.db, so the one file is complete
	_ = os.Remove(live + "-wal")
	_ = os.Remove(live + "-shm")
	if err := os.Rename(live, backup); err != nil {
		return "", s.reopenLocked(dir, fmt.Errorf("keeping the current data: %w", err))
	}
	if err := os.Rename(snapshot, live); err != nil {
		_ = os.Rename(backup, live) // put the current file back
		return "", s.reopenLocked(dir, fmt.Errorf("installing the copy: %w", err))
	}
	db, err := openDB(live)
	if err != nil {
		_ = os.Remove(live)
		_ = os.Rename(backup, live)
		return "", s.reopenLocked(dir, fmt.Errorf("opening the copy: %w", err))
	}
	s.db, s.dir = db, dir
	return backup, nil
}

// reopenLocked reopens the store's own file after a failed swap and returns the original error (or why it could not).
func (s *Store) reopenLocked(dir string, cause error) error {
	db, err := openDB(filepath.Join(dir, dbFile))
	if err != nil {
		return fmt.Errorf("%v; and the data file could not be reopened: %w", cause, err)
	}
	s.db, s.dir = db, dir
	return cause
}
