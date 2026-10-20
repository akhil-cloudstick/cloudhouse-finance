package localstore

import (
	"os"
	"path/filepath"
	"strings"
	"testing"
)

func newConfigured(t *testing.T) (*Store, string, string) {
	t.Helper()
	base := t.TempDir()
	def := filepath.Join(base, "default", "offline")
	cfg := filepath.Join(base, "cfg", "storage.json")
	return NewWithConfig(def, cfg), def, cfg
}

func TestNothingChosenUntilTheUserChooses(t *testing.T) {
	s, def, _ := newConfigured(t)
	if s.RootChosen() {
		t.Error("a fresh store reports a chosen folder")
	}
	if s.Root() != def {
		t.Errorf("root = %q, want the default %q", s.Root(), def)
	}
}

func TestUseDefaultIsRemembered(t *testing.T) {
	s, def, cfg := newConfigured(t)
	if err := s.UseDefault(); err != nil {
		t.Fatal(err)
	}
	again := NewWithConfig(def, cfg)
	if !again.RootChosen() || again.Root() != def {
		t.Errorf("after a restart: chosen=%v root=%q, want chosen at %q", again.RootChosen(), again.Root(), def)
	}
}

func TestSetRootCopiesTheDataAndKeepsTheOldFolder(t *testing.T) {
	s, def, cfg := newConfigured(t)
	if err := s.Open("acme", "pc"); err != nil {
		t.Fatal(err)
	}
	if err := s.AppendOutbox(`{"id":"a","n":1}`); err != nil {
		t.Fatal(err)
	}
	if err := s.WriteFile("data/loans.json", `[{"uuid":"u1"}]`); err != nil {
		t.Fatal(err)
	}

	parent := t.TempDir()
	if err := s.SetRoot(parent); err != nil {
		t.Fatal(err)
	}
	want := filepath.Join(parent, "CloudhouseFinance", "offline")
	if s.Root() != want || !s.RootChosen() {
		t.Fatalf("root = %q chosen = %v, want %q chosen", s.Root(), s.RootChosen(), want)
	}
	// closed until opened again
	if err := s.AppendOutbox(`{"id":"b"}`); err == nil {
		t.Error("the store stayed open after the move")
	}
	if err := s.Open("acme", "pc"); err != nil {
		t.Fatal(err)
	}
	lines, err := s.ReadOutbox()
	if err != nil || len(lines) != 1 || !strings.Contains(lines[0], `"a"`) {
		t.Fatalf("outbox after the move = %v, %v; want the one entry", lines, err)
	}
	if got, _ := s.ReadFile("data/loans.json"); !strings.Contains(got, "u1") {
		t.Errorf("loans.json after the move = %q", got)
	}
	if _, err := os.Stat(filepath.Join(def, "acme", "pc", "outbox.jsonl")); err != nil {
		t.Errorf("the old folder was not left in place: %v", err)
	}
	// remembered across a restart
	again := NewWithConfig(def, cfg)
	if again.Root() != want || !again.RootChosen() {
		t.Errorf("after a restart: root = %q, want %q", again.Root(), want)
	}
}

func TestSetRootRefusesBadFolders(t *testing.T) {
	s, _, _ := newConfigured(t)
	for _, p := range []string{"relative/path", filepath.Join(t.TempDir(), "missing")} {
		if err := s.SetRoot(p); err == nil {
			t.Errorf("SetRoot(%q) succeeded, want an error", p)
		}
	}
	file := filepath.Join(t.TempDir(), "afile")
	os.WriteFile(file, []byte("x"), 0o600)
	if err := s.SetRoot(file); err == nil {
		t.Error("SetRoot on a file succeeded")
	}
	if s.RootChosen() {
		t.Error("a refused folder counted as chosen")
	}
}

func TestSetRootSameFolderIsFine(t *testing.T) {
	s, def, _ := newConfigured(t)
	if err := s.Open("acme", "pc"); err != nil {
		t.Fatal(err)
	}
	parent := filepath.Dir(filepath.Dir(def))
	// def is <base>/default/offline, not <parent>/CloudhouseFinance/offline, so build one that is
	s2 := NewWithConfig(filepath.Join(parent, "CloudhouseFinance", "offline"), "")
	if err := s2.SetRoot(parent); err != nil {
		t.Fatalf("choosing the folder already in use: %v", err)
	}
}

func TestSetRootRefusesNestedFolders(t *testing.T) {
	s, _, _ := newConfigured(t)
	if err := s.Open("acme", "pc"); err != nil {
		t.Fatal(err)
	}
	// the new store folder would sit inside the current one
	inside := filepath.Join(s.Root(), "acme")
	if err := s.SetRoot(inside); err == nil {
		t.Error("moving the store into itself succeeded")
	}
}
