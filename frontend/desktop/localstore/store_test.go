package localstore

import (
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"
)

func open(t *testing.T) *Store {
	t.Helper()
	s := New(t.TempDir())
	if err := s.Open("acme", "dev_1"); err != nil {
		t.Fatal(err)
	}
	return s
}

func TestOpenRejectsPathTricks(t *testing.T) {
	s := New(t.TempDir())
	for _, c := range [][2]string{{"..", "d"}, {"b", ".."}, {"a/b", "d"}, {"b", `x\y`}, {"", "d"}, {".", "d"}} {
		if err := s.Open(c[0], c[1]); err == nil {
			t.Errorf("Open(%q, %q) succeeded, want an error", c[0], c[1])
		}
	}
}

func TestOutboxAppendReadDeleteKeepsOrder(t *testing.T) {
	s := open(t)
	for _, l := range []string{`{"id":"a","n":1}`, `{"id":"b","n":2}`, `{"id":"c","n":3}`} {
		if err := s.AppendOutbox(l); err != nil {
			t.Fatal(err)
		}
	}
	if err := s.DeleteOutboxEntry("b"); err != nil {
		t.Fatal(err)
	}
	got, err := s.ReadOutbox()
	if err != nil {
		t.Fatal(err)
	}
	if len(got) != 2 || !strings.Contains(got[0], `"a"`) || !strings.Contains(got[1], `"c"`) {
		t.Fatalf("got %v, want a then c", got)
	}
}

func TestOutboxRejectsBadLines(t *testing.T) {
	s := open(t)
	for _, l := range []string{"", "not json", "{\"id\":\"a\"}\n{\"id\":\"b\"}"} {
		if err := s.AppendOutbox(l); err == nil {
			t.Errorf("AppendOutbox(%q) succeeded, want an error", l)
		}
	}
}

func TestOutboxSkipsTornLastLine(t *testing.T) {
	s := open(t)
	if err := s.AppendOutbox(`{"id":"a"}`); err != nil {
		t.Fatal(err)
	}
	f, _ := os.OpenFile(filepath.Join(s.dir, outboxFile), os.O_APPEND|os.O_WRONLY, 0o600)
	f.WriteString(`{"id":"half`)
	f.Close()
	got, err := s.ReadOutbox()
	if err != nil || len(got) != 1 {
		t.Fatalf("got %v, %v; want the one complete line", got, err)
	}
}

func TestOutboxIsEmptyBeforeFirstWrite(t *testing.T) {
	got, err := open(t).ReadOutbox()
	if err != nil || len(got) != 0 {
		t.Fatalf("got %v, %v; want empty", got, err)
	}
}

func TestFileNamesAreAllowListed(t *testing.T) {
	s := open(t)
	good := []string{"cursor.json", "data/loans.json", "device.json", "users.json", "reference.json", "status.json", "photos/0192a000-0000.json"}
	for _, n := range good {
		if err := s.WriteFile(n, `{"ok":true}`); err != nil {
			t.Errorf("WriteFile(%q): %v", n, err)
		}
	}
	bad := []string{"../x.json", "data/../x.json", "outbox.jsonl", `data\loans.json`, "/etc/passwd", "data/a/b.json", "x.txt", ""}
	for _, n := range bad {
		if err := s.WriteFile(n, `{}`); err == nil {
			t.Errorf("WriteFile(%q) succeeded, want an error", n)
		}
		if _, err := s.ReadFile(n); err == nil {
			t.Errorf("ReadFile(%q) succeeded, want an error", n)
		}
	}
}

func TestFileRoundTripAndMissing(t *testing.T) {
	s := open(t)
	if got, err := s.ReadFile("cursor.json"); err != nil || got != "" {
		t.Fatalf("missing file: got %q, %v; want empty", got, err)
	}
	for _, n := range []string{"cursor.json", "users.json"} {
		want := `{"v":"` + n + `"}`
		if err := s.WriteFile(n, want); err != nil {
			t.Fatal(err)
		}
		if got, err := s.ReadFile(n); err != nil || got != want {
			t.Fatalf("%s: got %q, %v; want %q", n, got, err, want)
		}
	}
	if err := s.WriteFile("cursor.json", "not json"); err == nil {
		t.Error("invalid JSON was accepted")
	}
}

func TestClosedStoreRefuses(t *testing.T) {
	s := New(t.TempDir())
	if err := s.AppendOutbox(`{"id":"a"}`); err == nil {
		t.Error("AppendOutbox on a closed store succeeded")
	}
	if _, err := s.ReadFile("cursor.json"); err == nil {
		t.Error("ReadFile on a closed store succeeded")
	}
}

func TestOldLogsArePruned(t *testing.T) {
	s := open(t)
	old := filepath.Join(s.dir, "log", "2020-01-01.log")
	if err := os.WriteFile(old, []byte("x"), 0o600); err != nil {
		t.Fatal(err)
	}
	past := time.Now().Add(-40 * 24 * time.Hour)
	os.Chtimes(old, past, past)
	if err := s.AppendLog("info", "hello"); err != nil {
		t.Fatal(err)
	}
	s.pruneLogs()
	if _, err := os.Stat(old); !os.IsNotExist(err) {
		t.Error("a 40-day-old log was kept")
	}
	if _, err := os.Stat(filepath.Join(s.dir, "log", time.Now().Format("2006-01-02")+".log")); err != nil {
		t.Errorf("today's log is missing: %v", err)
	}
}
