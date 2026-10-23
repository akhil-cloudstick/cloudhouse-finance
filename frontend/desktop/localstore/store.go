// Package localstore keeps the offline data on this PC in one SQLite database per business: the outbox of
// entries the server has not confirmed, the local copy of the branch's data, the pull cursor, the device
// identity and the offline-login cache. Every method is reachable from the page, so file names are checked and
// nothing outside the store's own folder can be touched.
//
// An entry the server turns down is not lost: it moves to "review" and waits there for an admin to retry it or
// to discard it. Entries that touch the same record as a review entry are held back with it, so nothing is sent
// out of order.
package localstore

import (
	"database/sql"
	"encoding/json"
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"regexp"
	"strings"
	"sync"
	"time"

	_ "modernc.org/sqlite"
)

const (
	dbFile      = "offline.db"
	legacyOutbx = "outbox.jsonl"
	logKeep     = 30 * 24 * time.Hour
	maxLine     = 4 << 20  // one outbox entry
	maxFile     = 64 << 20 // one data file
	maxMessage  = 1000     // the server's reason, as kept with a review entry

	statusPending = "pending"
	statusReview  = "review"
)

var (
	scopePart = regexp.MustCompile(`^[A-Za-z0-9._-]{1,64}$`)
	// plain names the page may read and write: cursor.json, data/loans.json, photos/<id>.json and so on
	fileName = regexp.MustCompile(`^((data|photos)/)?[a-z0-9_-]{1,40}\.json$`)
	// these hold secrets, so they are protected for this Windows user
	secretFiles = map[string]bool{"device.json": true, "users.json": true}
)

type Store struct {
	mu          sync.Mutex
	root        string // where the offline data lives: the default, or the folder the user chose
	dir         string // root\<business>\<device>, empty until Open
	db          *sql.DB
	defaultRoot string
	cfgPath     string // where the user's choice is remembered; "" keeps it in memory only (tests)
	chosen      bool   // the user has picked a folder, or accepted the default
}

// ReviewItem is one entry the server refused, as shown to the admin.
type ReviewItem struct {
	ID        string          `json:"id"`
	Entry     json.RawMessage `json:"entry"`
	Message   string          `json:"message"`
	Attempts  int             `json:"attempts"`
	CreatedAt int64           `json:"createdAt"`
	ReviewAt  int64           `json:"reviewAt"`
	// Held is how many later entries touch the same record and wait behind this one.
	Held int `json:"held"`
}

// New returns a store rooted at the given folder, with nothing remembered about the user's choice.
func New(root string) *Store { return &Store{root: root, defaultRoot: root} }

// DefaultRoot is %LOCALAPPDATA%\CloudhouseFinance\offline (or the platform equivalent).
func DefaultRoot() (string, error) {
	base, err := os.UserCacheDir()
	if err != nil {
		return "", err
	}
	return filepath.Join(base, "CloudhouseFinance", "offline"), nil
}

// Open selects the folder for one business on one PC, creating it when new, and opens its database. The
// business and device come from the page, so each is checked as a single plain folder name.
func (s *Store) Open(business, device string) error {
	if !scopePart.MatchString(business) || !scopePart.MatchString(device) || business == ".." || device == ".." || business == "." || device == "." {
		return errors.New("invalid business or device name")
	}
	dir := filepath.Join(s.Root(), business, device)
	if err := os.MkdirAll(filepath.Join(dir, "log"), 0o700); err != nil {
		return err
	}
	db, err := openDB(filepath.Join(dir, dbFile))
	if err != nil {
		return err
	}
	if err := importLegacy(db, dir); err != nil {
		db.Close()
		return fmt.Errorf("moving the earlier offline files into the database: %w", err)
	}
	s.mu.Lock()
	s.closeLocked()
	s.dir = dir
	s.db = db
	s.mu.Unlock()
	s.pruneLogs()
	return nil
}

// Close flushes and closes the database. The store must be opened again before it is used.
func (s *Store) Close() {
	s.mu.Lock()
	defer s.mu.Unlock()
	s.closeLocked()
}

func (s *Store) closeLocked() {
	if s.db != nil {
		// folds the write-ahead log back into offline.db, so the one file is complete when it is copied
		_, _ = s.db.Exec(`PRAGMA wal_checkpoint(TRUNCATE)`)
		s.db.Close()
		s.db = nil
	}
	s.dir = ""
}

func (s *Store) conn() (*sql.DB, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	if s.db == nil {
		return nil, errors.New("store is not open")
	}
	return s.db, nil
}

func openDB(path string) (*sql.DB, error) {
	// one connection: a save, a pull and the sender can never interleave inside each other
	dsn := path + "?_pragma=journal_mode(WAL)&_pragma=synchronous(FULL)&_pragma=busy_timeout(10000)&_pragma=foreign_keys(ON)&_txlock=immediate"
	db, err := sql.Open("sqlite", dsn)
	if err != nil {
		return nil, err
	}
	db.SetMaxOpenConns(1)
	if err := migrate(db); err != nil {
		db.Close()
		return nil, err
	}
	return db, nil
}

// Each version is run once and never edited; a change to the layout is a new version at the end.
var schema = []string{
	`CREATE TABLE entries (
		seq        INTEGER PRIMARY KEY AUTOINCREMENT,
		entry_id   TEXT    NOT NULL UNIQUE,
		payload    TEXT    NOT NULL,
		status     TEXT    NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','review')),
		attempts   INTEGER NOT NULL DEFAULT 0,
		last_error TEXT    NOT NULL DEFAULT '',
		created_at INTEGER NOT NULL,
		review_at  INTEGER NOT NULL DEFAULT 0
	);
	CREATE TABLE entry_targets (
		entry_id TEXT NOT NULL REFERENCES entries(entry_id) ON DELETE CASCADE,
		target   TEXT NOT NULL,
		PRIMARY KEY (entry_id, target)
	);
	CREATE INDEX entry_targets_target ON entry_targets(target);
	CREATE TABLE files (
		name       TEXT PRIMARY KEY,
		content    BLOB    NOT NULL,
		updated_at INTEGER NOT NULL
	);`,
}

func migrate(db *sql.DB) error {
	var have int
	if err := db.QueryRow(`PRAGMA user_version`).Scan(&have); err != nil {
		return err
	}
	for v := have; v < len(schema); v++ {
		tx, err := db.Begin()
		if err != nil {
			return err
		}
		if _, err := tx.Exec(schema[v]); err != nil {
			tx.Rollback()
			return fmt.Errorf("schema v%d: %w", v+1, err)
		}
		if _, err := tx.Exec(fmt.Sprintf(`PRAGMA user_version = %d`, v+1)); err != nil {
			tx.Rollback()
			return err
		}
		if err := tx.Commit(); err != nil {
			return err
		}
	}
	return nil
}

// isSecret is true for files that hold credentials or identity documents: they are protected for this
// Windows user. Photos waiting to be uploaded are KYC documents, so they count.
func isSecret(name string) bool {
	return secretFiles[name] || strings.HasPrefix(name, "photos/")
}

func checkName(name string) error {
	if !fileName.MatchString(name) {
		return fmt.Errorf("file name %q is not allowed", name)
	}
	return nil
}

// entryHead reads what the store needs from an entry line: its id and the records it touches.
func entryHead(line string) (id string, targets []string, err error) {
	line = strings.TrimRight(line, "\r\n")
	if line == "" || strings.ContainsAny(line, "\r\n") {
		return "", nil, errors.New("an outbox entry must be one non-empty line")
	}
	if len(line) > maxLine {
		return "", nil, errors.New("outbox entry is too large")
	}
	if !json.Valid([]byte(line)) {
		return "", nil, errors.New("outbox entry is not valid JSON")
	}
	var head struct {
		ID      string   `json:"id"`
		Targets []string `json:"targets"`
	}
	if err := json.Unmarshal([]byte(line), &head); err != nil || head.ID == "" {
		return "", nil, errors.New("an outbox entry needs an id")
	}
	return head.ID, head.Targets, nil
}

func insertEntry(tx *sql.Tx, line string) error {
	id, targets, err := entryHead(line)
	if err != nil {
		return err
	}
	res, err := tx.Exec(`INSERT INTO entries (entry_id, payload, created_at) VALUES (?, ?, ?) ON CONFLICT(entry_id) DO NOTHING`,
		id, strings.TrimRight(line, "\r\n"), time.Now().UnixMilli())
	if err != nil {
		return err
	}
	if n, _ := res.RowsAffected(); n == 0 {
		return nil // already queued: the same entry sent twice is kept once
	}
	for _, t := range targets {
		if _, err := tx.Exec(`INSERT OR IGNORE INTO entry_targets (entry_id, target) VALUES (?, ?)`, id, t); err != nil {
			return err
		}
	}
	return nil
}

func putFile(tx *sql.Tx, name string, content []byte) error {
	_, err := tx.Exec(`INSERT INTO files (name, content, updated_at) VALUES (?, ?, ?)
		ON CONFLICT(name) DO UPDATE SET content = excluded.content, updated_at = excluded.updated_at`,
		name, content, time.Now().UnixMilli())
	return err
}

// sealFile checks a file the page wants kept and returns the bytes to store (protected when it is a secret).
func sealFile(name, content string) ([]byte, error) {
	if err := checkName(name); err != nil {
		return nil, err
	}
	if len(content) > maxFile {
		return nil, errors.New("file is too large")
	}
	if !json.Valid([]byte(content)) {
		return nil, errors.New("file content is not valid JSON")
	}
	b := []byte(content)
	if isSecret(name) {
		return protect(b)
	}
	return b, nil
}

// AppendOutbox adds one entry to the end of the outbox and flushes it to disk before returning, so an entry the
// page was told is saved survives a crash or power cut.
func (s *Store) AppendOutbox(line string) error {
	return s.SaveEntry(line, nil)
}

// SaveEntry adds one entry to the outbox and replaces the given data files in ONE transaction: the local copy
// the screen shows and the entry that will be sent always agree, or neither is kept.
func (s *Store) SaveEntry(line string, files map[string]string) error {
	if _, _, err := entryHead(line); err != nil {
		return err
	}
	sealed := make(map[string][]byte, len(files))
	for name, content := range files {
		b, err := sealFile(name, content)
		if err != nil {
			return err
		}
		sealed[name] = b
	}
	db, err := s.conn()
	if err != nil {
		return err
	}
	return inTx(db, func(tx *sql.Tx) error {
		if err := insertEntry(tx, line); err != nil {
			return err
		}
		for name, b := range sealed {
			if err := putFile(tx, name, b); err != nil {
				return err
			}
		}
		return nil
	})
}

func inTx(db *sql.DB, fn func(tx *sql.Tx) error) error {
	tx, err := db.Begin()
	if err != nil {
		return err
	}
	if err := fn(tx); err != nil {
		tx.Rollback()
		return err
	}
	return tx.Commit()
}

func queryLines(db *sql.DB, query string, args ...any) ([]string, error) {
	rows, err := db.Query(query, args...)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := []string{}
	for rows.Next() {
		var p string
		if err := rows.Scan(&p); err != nil {
			return nil, err
		}
		out = append(out, p)
	}
	return out, rows.Err()
}

// ReadOutbox returns the entries that may be sent now, oldest first. An entry in review is not in the list, and
// neither is a later entry on the same record, so nothing overtakes what the admin has yet to decide.
func (s *Store) ReadOutbox() ([]string, error) {
	db, err := s.conn()
	if err != nil {
		return nil, err
	}
	return queryLines(db, `SELECT e.payload FROM entries e
		WHERE e.status = 'pending'
		AND NOT EXISTS (
			SELECT 1 FROM entry_targets t
			JOIN entry_targets r ON r.target = t.target AND r.entry_id <> t.entry_id
			JOIN entries re ON re.entry_id = r.entry_id AND re.status = 'review'
			WHERE t.entry_id = e.entry_id)
		ORDER BY e.seq`)
}

// ReadAllOutbox returns every entry the server has not confirmed, sendable or not, oldest first. It is what the
// screens use to know what is still on this PC (pending cash, records a pull must not overwrite).
func (s *Store) ReadAllOutbox() ([]string, error) {
	db, err := s.conn()
	if err != nil {
		return nil, err
	}
	return queryLines(db, `SELECT payload FROM entries ORDER BY seq`)
}

// DeleteOutboxEntry removes the entry with this id: once the server has confirmed it, or when the admin
// discards it from review.
func (s *Store) DeleteOutboxEntry(id string) error {
	if id == "" {
		return errors.New("an entry id is required")
	}
	db, err := s.conn()
	if err != nil {
		return err
	}
	_, err = db.Exec(`DELETE FROM entries WHERE entry_id = ?`, id)
	return err
}

// Counts is how many entries wait to be sent and how many wait for an admin.
func (s *Store) Counts() (map[string]int, error) {
	db, err := s.conn()
	if err != nil {
		return nil, err
	}
	out := map[string]int{"pending": 0, "review": 0}
	rows, err := db.Query(`SELECT status, COUNT(*) FROM entries GROUP BY status`)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	for rows.Next() {
		var st string
		var n int
		if err := rows.Scan(&st, &n); err != nil {
			return nil, err
		}
		out[st] = n
	}
	return out, rows.Err()
}

// MarkReview moves an entry the server refused out of the send queue and keeps the server's reason with it.
func (s *Store) MarkReview(id, message string) error {
	if id == "" {
		return errors.New("an entry id is required")
	}
	if len(message) > maxMessage {
		message = message[:maxMessage]
	}
	db, err := s.conn()
	if err != nil {
		return err
	}
	_, err = db.Exec(`UPDATE entries SET status = 'review', last_error = ?, review_at = ?, attempts = attempts + 1 WHERE entry_id = ?`,
		message, time.Now().UnixMilli(), id)
	return err
}

// RetryReview puts an entry back in the send queue, as if it had just been saved.
func (s *Store) RetryReview(id string) error {
	if id == "" {
		return errors.New("an entry id is required")
	}
	db, err := s.conn()
	if err != nil {
		return err
	}
	_, err = db.Exec(`UPDATE entries SET status = 'pending', last_error = '', review_at = 0 WHERE entry_id = ? AND status = 'review'`, id)
	return err
}

// ReadReview returns the entries waiting for an admin, oldest first, each as one JSON object (ReviewItem).
func (s *Store) ReadReview() ([]string, error) {
	db, err := s.conn()
	if err != nil {
		return nil, err
	}
	rows, err := db.Query(`SELECT e.entry_id, e.payload, e.last_error, e.attempts, e.created_at, e.review_at,
		(SELECT COUNT(DISTINCT p.entry_id) FROM entry_targets t
			JOIN entry_targets x ON x.target = t.target AND x.entry_id <> t.entry_id
			JOIN entries p ON p.entry_id = x.entry_id AND p.status = 'pending'
			WHERE t.entry_id = e.entry_id)
		FROM entries e WHERE e.status = 'review' ORDER BY e.seq`)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := []string{}
	for rows.Next() {
		var it ReviewItem
		var payload string
		if err := rows.Scan(&it.ID, &payload, &it.Message, &it.Attempts, &it.CreatedAt, &it.ReviewAt, &it.Held); err != nil {
			return nil, err
		}
		it.Entry = json.RawMessage(payload)
		b, err := json.Marshal(it)
		if err != nil {
			return nil, err
		}
		out = append(out, string(b))
	}
	return out, rows.Err()
}

// ReadFile returns a data file's text, or "" when it does not exist yet.
func (s *Store) ReadFile(name string) (string, error) {
	if err := checkName(name); err != nil {
		return "", err
	}
	db, err := s.conn()
	if err != nil {
		return "", err
	}
	var b []byte
	err = db.QueryRow(`SELECT content FROM files WHERE name = ?`, name).Scan(&b)
	if errors.Is(err, sql.ErrNoRows) {
		return "", nil
	}
	if err != nil {
		return "", err
	}
	if isSecret(name) {
		if b, err = unprotect(b); err != nil {
			return "", fmt.Errorf("%s cannot be read by this Windows user: %w", name, err)
		}
	}
	return string(b), nil
}

// WriteFile replaces a data file as one step.
func (s *Store) WriteFile(name, content string) error {
	b, err := sealFile(name, content)
	if err != nil {
		return err
	}
	db, err := s.conn()
	if err != nil {
		return err
	}
	return inTx(db, func(tx *sql.Tx) error { return putFile(tx, name, b) })
}

// AppendLog writes one JSON line to today's log file. Logs are for support and never leave the PC.
func (s *Store) AppendLog(level, message string) error {
	if len(message) > 8<<10 {
		message = message[:8<<10]
	}
	rec, err := json.Marshal(map[string]string{"t": time.Now().Format(time.RFC3339), "level": level, "msg": message})
	if err != nil {
		return err
	}
	s.mu.Lock()
	defer s.mu.Unlock()
	if s.dir == "" {
		return errors.New("store is not open")
	}
	name := filepath.Join(s.dir, "log", time.Now().Format("2006-01-02")+".log")
	f, err := os.OpenFile(name, os.O_APPEND|os.O_CREATE|os.O_WRONLY, 0o600)
	if err != nil {
		return err
	}
	_, werr := f.Write(append(rec, '\n'))
	if cerr := f.Close(); werr == nil {
		werr = cerr
	}
	return werr
}

func (s *Store) pruneLogs() {
	s.mu.Lock()
	dir := filepath.Join(s.dir, "log")
	s.mu.Unlock()
	entries, err := os.ReadDir(dir)
	if err != nil {
		return
	}
	cutoff := time.Now().Add(-logKeep)
	for _, e := range entries {
		info, err := e.Info()
		if err == nil && !e.IsDir() && info.ModTime().Before(cutoff) {
			_ = os.Remove(filepath.Join(dir, e.Name()))
		}
	}
}

func writeAtomic(path string, data []byte) error {
	tmp, err := os.CreateTemp(filepath.Dir(path), ".tmp-*")
	if err != nil {
		return err
	}
	name := tmp.Name()
	if _, err := tmp.Write(data); err != nil {
		tmp.Close()
		os.Remove(name)
		return err
	}
	if err := tmp.Sync(); err != nil {
		tmp.Close()
		os.Remove(name)
		return err
	}
	if err := tmp.Close(); err != nil {
		os.Remove(name)
		return err
	}
	if err := os.Rename(name, path); err != nil {
		os.Remove(name)
		return err
	}
	return nil
}
