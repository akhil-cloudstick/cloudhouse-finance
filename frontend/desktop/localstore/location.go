package localstore

import (
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"io/fs"
	"os"
	"path/filepath"
	"strings"
)

// Where the offline data lives is the user's choice. The choice is remembered in a small file that always sits in
// the default place (the folder that holds it cannot be the one it points to), and the page never supplies a
// path: only a folder picked in the native dialog, handled by the Go side, reaches SetRoot.

type config struct {
	Root string `json:"root"`
}

// DefaultConfigPath is %LOCALAPPDATA%\CloudhouseFinance\storage.json.
func DefaultConfigPath() (string, error) {
	base, err := os.UserCacheDir()
	if err != nil {
		return "", err
	}
	return filepath.Join(base, "CloudhouseFinance", "storage.json"), nil
}

// NewWithConfig returns a store whose folder is the one saved in cfgPath, or defaultRoot when the user has not
// chosen yet.
func NewWithConfig(defaultRoot, cfgPath string) *Store {
	s := &Store{root: defaultRoot, defaultRoot: defaultRoot, cfgPath: cfgPath}
	if b, err := os.ReadFile(cfgPath); err == nil {
		var c config
		if json.Unmarshal(b, &c) == nil && filepath.IsAbs(c.Root) {
			s.root = c.Root
			s.chosen = true
		}
	}
	return s
}

// Root is the folder the offline data is kept in.
func (s *Store) Root() string {
	s.mu.Lock()
	defer s.mu.Unlock()
	return s.root
}

// RootChosen is false until the user has picked a folder (or accepted the default).
func (s *Store) RootChosen() bool {
	s.mu.Lock()
	defer s.mu.Unlock()
	return s.chosen
}

// UseDefault records that the user accepted the default folder.
func (s *Store) UseDefault() error {
	s.mu.Lock()
	defer s.mu.Unlock()
	if err := s.saveConfigLocked(s.root); err != nil {
		return err
	}
	s.chosen = true
	return nil
}

// SetRoot moves the offline data into <parent>\CloudhouseFinance\offline. What is already stored is copied there;
// the old folder is left as it was, never deleted. The store is closed afterwards and must be opened again.
func (s *Store) SetRoot(parent string) error {
	parent = filepath.Clean(parent)
	if !filepath.IsAbs(parent) {
		return errors.New("choose a full folder path")
	}
	info, err := os.Stat(parent)
	if err != nil || !info.IsDir() {
		return errors.New("that folder does not exist")
	}
	if err := writableDir(parent); err != nil {
		return fmt.Errorf("this folder cannot be written to: %w", err)
	}
	next := filepath.Join(parent, "CloudhouseFinance", "offline")

	s.mu.Lock()
	defer s.mu.Unlock()
	if !sameFolder(next, s.root) {
		s.closeLocked() // the database is folded into its one file and released before it is copied
		if err := os.MkdirAll(next, 0o700); err != nil {
			return err
		}
		if err := copyTree(s.root, next); err != nil {
			return fmt.Errorf("moving the offline data: %w", err)
		}
	}
	if err := s.saveConfigLocked(next); err != nil {
		return err
	}
	s.root = next
	s.dir = ""
	s.chosen = true
	return nil
}

func (s *Store) saveConfigLocked(root string) error {
	if s.cfgPath == "" {
		return nil
	}
	if err := os.MkdirAll(filepath.Dir(s.cfgPath), 0o700); err != nil {
		return err
	}
	b, err := json.Marshal(config{Root: root})
	if err != nil {
		return err
	}
	return writeAtomic(s.cfgPath, b)
}

func writableDir(dir string) error {
	f, err := os.CreateTemp(dir, ".write-test-*")
	if err != nil {
		return err
	}
	name := f.Name()
	f.Close()
	return os.Remove(name)
}

func sameFolder(a, b string) bool {
	return strings.EqualFold(filepath.Clean(a), filepath.Clean(b))
}

func inside(child, parent string) bool {
	rel, err := filepath.Rel(filepath.Clean(parent), filepath.Clean(child))
	return err == nil && rel != "." && !strings.HasPrefix(rel, "..")
}

// copyTree copies every file under src into dst. A missing src is not an error (nothing stored yet).
func copyTree(src, dst string) error {
	if _, err := os.Stat(src); errors.Is(err, os.ErrNotExist) {
		return nil
	}
	if inside(dst, src) || inside(src, dst) {
		return errors.New("the new folder cannot be inside the old one, or the other way round")
	}
	return filepath.WalkDir(src, func(path string, d fs.DirEntry, err error) error {
		if err != nil {
			return err
		}
		rel, err := filepath.Rel(src, path)
		if err != nil {
			return err
		}
		target := filepath.Join(dst, rel)
		if d.IsDir() {
			return os.MkdirAll(target, 0o700)
		}
		in, err := os.Open(path)
		if err != nil {
			return err
		}
		defer in.Close()
		out, err := os.OpenFile(target, os.O_CREATE|os.O_TRUNC|os.O_WRONLY, 0o600)
		if err != nil {
			return err
		}
		if _, err := io.Copy(out, in); err != nil {
			out.Close()
			return err
		}
		if err := out.Sync(); err != nil {
			out.Close()
			return err
		}
		return out.Close()
	})
}
