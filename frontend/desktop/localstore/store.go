// Package localstore keeps the offline files on this PC: the outbox of entries the server has not confirmed,
// the local copy of the branch's data, the pull cursor, the device identity and the offline-login cache.
// It is deliberately a few plain files, not a database. Every method is reachable from the page, so file
// names are checked and nothing outside the store's own folder can be touched.
package localstore

import (
	"bufio"
	"bytes"
	"encoding/json"
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"regexp"
	"strings"
	"sync"
	"time"
)

const (
	outboxFile = "outbox.jsonl"
	logKeep    = 30 * 24 * time.Hour
	maxLine    = 4 << 20  // one outbox line
	maxFile    = 64 << 20 // one data file
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
	defaultRoot string
	cfgPath     string // where the user's choice is remembered; "" keeps it in memory only (tests)
	chosen      bool   // the user has picked a folder, or accepted the default
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

// Open selects the folder for one business on one PC, creating it when new. The business and device come
// from the page, so each is checked as a single plain folder name.
func (s *Store) Open(business, device string) error {
	if !scopePart.MatchString(business) || !scopePart.MatchString(device) || business == ".." || device == ".." || business == "." || device == "." {
		return errors.New("invalid business or device name")
	}
	dir := filepath.Join(s.Root(), business, device)
	if err := os.MkdirAll(filepath.Join(dir, "data"), 0o700); err != nil {
		return err
	}
	if err := os.MkdirAll(filepath.Join(dir, "log"), 0o700); err != nil {
		return err
	}
	if err := os.MkdirAll(filepath.Join(dir, "photos"), 0o700); err != nil {
		return err
	}
	s.mu.Lock()
	s.dir = dir
	s.mu.Unlock()
	s.pruneLogs()
	return nil
}

// isSecret is true for files that hold credentials or identity documents: they are protected for this
// Windows user. Photos waiting to be uploaded are KYC documents, so they count.
func isSecret(name string) bool {
	return secretFiles[name] || strings.HasPrefix(name, "photos/")
}

func (s *Store) path(name string) (string, error) {
	if s.dir == "" {
		return "", errors.New("store is not open")
	}
	if !fileName.MatchString(name) {
		return "", fmt.Errorf("file name %q is not allowed", name)
	}
	return filepath.Join(s.dir, filepath.FromSlash(name)), nil
}

// AppendOutbox adds one entry to the end of outbox.jsonl and flushes it to disk before returning, so an
// entry the page was told is saved survives a crash or power cut.
func (s *Store) AppendOutbox(line string) error {
	line = strings.TrimRight(line, "\r\n")
	if line == "" || strings.ContainsAny(line, "\r\n") {
		return errors.New("an outbox entry must be one non-empty line")
	}
	if len(line) > maxLine {
		return errors.New("outbox entry is too large")
	}
	if !json.Valid([]byte(line)) {
		return errors.New("outbox entry is not valid JSON")
	}
	s.mu.Lock()
	defer s.mu.Unlock()
	if s.dir == "" {
		return errors.New("store is not open")
	}
	f, err := os.OpenFile(filepath.Join(s.dir, outboxFile), os.O_APPEND|os.O_CREATE|os.O_WRONLY, 0o600)
	if err != nil {
		return err
	}
	if _, err := f.WriteString(line + "\n"); err != nil {
		f.Close()
		return err
	}
	if err := f.Sync(); err != nil {
		f.Close()
		return err
	}
	return f.Close()
}

// ReadOutbox returns every waiting entry, oldest first. A torn last line from a crash mid-write is skipped.
func (s *Store) ReadOutbox() ([]string, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	return s.readOutboxLocked()
}

func (s *Store) readOutboxLocked() ([]string, error) {
	if s.dir == "" {
		return nil, errors.New("store is not open")
	}
	f, err := os.Open(filepath.Join(s.dir, outboxFile))
	if errors.Is(err, os.ErrNotExist) {
		return []string{}, nil
	}
	if err != nil {
		return nil, err
	}
	defer f.Close()
	out := []string{}
	sc := bufio.NewScanner(f)
	sc.Buffer(make([]byte, 64*1024), maxLine+1024)
	for sc.Scan() {
		t := strings.TrimSpace(sc.Text())
		if t != "" && json.Valid([]byte(t)) {
			out = append(out, t)
		}
	}
	return out, sc.Err()
}

// DeleteOutboxEntry removes the entry whose "id" matches, by writing the rest to a new file and swapping it
// in, so a crash leaves either the old file or the new one, never half of each.
func (s *Store) DeleteOutboxEntry(id string) error {
	if id == "" {
		return errors.New("an entry id is required")
	}
	s.mu.Lock()
	defer s.mu.Unlock()
	lines, err := s.readOutboxLocked()
	if err != nil {
		return err
	}
	var keep bytes.Buffer
	for _, l := range lines {
		var head struct {
			ID string `json:"id"`
		}
		if json.Unmarshal([]byte(l), &head) == nil && head.ID == id {
			continue
		}
		keep.WriteString(l)
		keep.WriteByte('\n')
	}
	return writeAtomic(filepath.Join(s.dir, outboxFile), keep.Bytes())
}

// ReadFile returns a data file's text, or "" when it does not exist yet.
func (s *Store) ReadFile(name string) (string, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	p, err := s.path(name)
	if err != nil {
		return "", err
	}
	b, err := os.ReadFile(p)
	if errors.Is(err, os.ErrNotExist) {
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
	if len(content) > maxFile {
		return errors.New("file is too large")
	}
	if !json.Valid([]byte(content)) {
		return errors.New("file content is not valid JSON")
	}
	s.mu.Lock()
	defer s.mu.Unlock()
	p, err := s.path(name)
	if err != nil {
		return err
	}
	b := []byte(content)
	if isSecret(name) {
		if b, err = protect(b); err != nil {
			return err
		}
	}
	return writeAtomic(p, b)
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
