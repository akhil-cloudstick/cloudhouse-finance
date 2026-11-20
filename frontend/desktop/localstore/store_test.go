package localstore

import (
	"encoding/json"
	"os"
	"path/filepath"
	"runtime"
	"strings"
	"testing"
	"time"
)

func open(t *testing.T) *Store {
	t.Helper()
	s := New(t.TempDir())
	t.Cleanup(s.Close)
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

func TestOutboxNeedsAnId(t *testing.T) {
	if err := open(t).AppendOutbox(`{"n":1}`); err == nil {
		t.Error("an entry with no id was accepted")
	}
}

func TestSameEntryTwiceIsKeptOnce(t *testing.T) {
	s := open(t)
	for i := 0; i < 2; i++ {
		if err := s.AppendOutbox(`{"id":"a"}`); err != nil {
			t.Fatal(err)
		}
	}
	if got, _ := s.ReadOutbox(); len(got) != 1 {
		t.Fatalf("got %v, want one entry", got)
	}
}

func TestSaveEntryIsAllOrNothing(t *testing.T) {
	s := open(t)
	if err := s.SaveEntry(`{"id":"a"}`, map[string]string{"data/loans.json": `[{"uuid":"u1"}]`}); err != nil {
		t.Fatal(err)
	}
	// one bad file name: neither the entry nor the other file may be kept
	err := s.SaveEntry(`{"id":"b"}`, map[string]string{"data/loans.json": `[]`, "../x.json": `{}`})
	if err == nil {
		t.Fatal("a save with a bad file name succeeded")
	}
	if got, _ := s.ReadOutbox(); len(got) != 1 {
		t.Errorf("outbox = %v, want only a", got)
	}
	if got, _ := s.ReadFile("data/loans.json"); !strings.Contains(got, "u1") {
		t.Errorf("loans.json = %q, want the first save kept", got)
	}
}

func TestReviewHoldsLaterEntriesOnTheSameRecord(t *testing.T) {
	s := open(t)
	for _, l := range []string{
		`{"id":"a","targets":["loan1"]}`,
		`{"id":"b","targets":["loan1"]}`,
		`{"id":"c","targets":["loan2"]}`,
	} {
		if err := s.AppendOutbox(l); err != nil {
			t.Fatal(err)
		}
	}
	if err := s.MarkReview("a", "cash is no longer enough"); err != nil {
		t.Fatal(err)
	}
	got, _ := s.ReadOutbox()
	if len(got) != 1 || !strings.Contains(got[0], `"c"`) {
		t.Fatalf("sendable = %v, want only c (a is in review, b waits behind it)", got)
	}
	if all, _ := s.ReadAllOutbox(); len(all) != 3 {
		t.Errorf("all = %v, want all three kept on this PC", all)
	}
	rev, err := s.ReadReview()
	if err != nil || len(rev) != 1 {
		t.Fatalf("review = %v, %v", rev, err)
	}
	var it ReviewItem
	if err := json.Unmarshal([]byte(rev[0]), &it); err != nil {
		t.Fatal(err)
	}
	if it.ID != "a" || it.Message != "cash is no longer enough" || it.Held != 1 || it.Attempts != 1 {
		t.Errorf("review item = %+v", it)
	}
	if c, _ := s.Counts(); c["pending"] != 2 || c["review"] != 1 {
		t.Errorf("counts = %v", c)
	}

	// retry: back in the queue, in its original place
	if err := s.RetryReview("a"); err != nil {
		t.Fatal(err)
	}
	got, _ = s.ReadOutbox()
	if len(got) != 3 || !strings.Contains(got[0], `"a"`) {
		t.Errorf("after retry = %v, want a, b, c", got)
	}

	// discard: gone for good, and what waited behind it is released
	s.MarkReview("a", "again")
	if err := s.DeleteOutboxEntry("a"); err != nil {
		t.Fatal(err)
	}
	got, _ = s.ReadOutbox()
	if len(got) != 2 || !strings.Contains(got[0], `"b"`) {
		t.Errorf("after discard = %v, want b, c", got)
	}
}

func TestLegacyFilesAreImportedOnce(t *testing.T) {
	root := t.TempDir()
	dir := filepath.Join(root, "acme", "pc")
	os.MkdirAll(filepath.Join(dir, "data"), 0o700)
	os.WriteFile(filepath.Join(dir, "outbox.jsonl"), []byte("{\"id\":\"a\",\"targets\":[\"l1\"]}\n{\"id\":\"half"), 0o600)
	os.WriteFile(filepath.Join(dir, "data", "loans.json"), []byte(`[{"uuid":"l1"}]`), 0o600)
	os.WriteFile(filepath.Join(dir, "cursor.json"), []byte(`{"since":"x"}`), 0o600)

	s := New(root)
	t.Cleanup(s.Close)
	if err := s.Open("acme", "pc"); err != nil {
		t.Fatal(err)
	}
	if got, _ := s.ReadOutbox(); len(got) != 1 || !strings.Contains(got[0], `"a"`) {
		t.Fatalf("outbox = %v, want the one whole line", got)
	}
	if got, _ := s.ReadFile("data/loans.json"); !strings.Contains(got, "l1") {
		t.Errorf("loans.json = %q", got)
	}
	if got, _ := s.ReadFile("cursor.json"); !strings.Contains(got, "x") {
		t.Errorf("cursor.json = %q", got)
	}
	for _, n := range []string{"outbox.jsonl", "cursor.json", filepath.Join("data", "loans.json")} {
		if _, err := os.Stat(filepath.Join(dir, n)); !os.IsNotExist(err) {
			t.Errorf("%s was not set aside", n)
		}
		if _, err := os.Stat(filepath.Join(dir, n+".imported")); err != nil {
			t.Errorf("%s.imported is missing: %v", n, err)
		}
	}
	// a second open must not import (or duplicate) anything
	s.Close()
	if err := s.Open("acme", "pc"); err != nil {
		t.Fatal(err)
	}
	if got, _ := s.ReadOutbox(); len(got) != 1 {
		t.Errorf("after reopening: %v, want still one entry", got)
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
	for _, n := range []string{"cursor.json", "users.json", "data/pending_secrets.json"} {
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

func TestChangeEntry(t *testing.T) {
	s := open(t)
	line := `{"id":"e1","method":"POST","path":"/x","body":{"amount":1},"targets":["a"]}`
	if err := s.SaveEntry(line, map[string]string{"data/loans.json": `[1]`}); err != nil {
		t.Fatal(err)
	}
	// a change rewrites the waiting entry and the file in one step
	changed := `{"id":"e1","method":"POST","path":"/x","body":{"amount":2},"targets":["a"]}`
	if err := s.ChangeEntry("e1", changed, map[string]string{"data/loans.json": `[2]`}); err != nil {
		t.Fatal(err)
	}
	lines, _ := s.ReadAllOutbox()
	if len(lines) != 1 || lines[0] != changed {
		t.Fatalf("outbox = %v, want the changed entry", lines)
	}
	if got, _ := s.ReadFile("data/loans.json"); got != `[2]` {
		t.Fatalf("file = %q, want [2]", got)
	}
	// the id cannot be swapped
	if err := s.ChangeEntry("e1", `{"id":"other"}`, nil); err == nil {
		t.Fatal("a changed entry must keep its id")
	}
	// an empty line removes it
	if err := s.ChangeEntry("e1", "", map[string]string{"data/loans.json": `[]`}); err != nil {
		t.Fatal(err)
	}
	if lines, _ := s.ReadAllOutbox(); len(lines) != 0 {
		t.Fatalf("outbox = %v, want empty", lines)
	}
	// an entry that is gone (already sent) is refused, and the file is left alone
	if err := s.ChangeEntry("e1", "", map[string]string{"data/loans.json": `[9]`}); err == nil {
		t.Fatal("an entry that was already sent must be refused")
	}
	if got, _ := s.ReadFile("data/loans.json"); got != `[]` {
		t.Fatalf("file = %q, want [] (unchanged by the refused change)", got)
	}
}

func TestPendingSecretsFileIsProtected(t *testing.T) {
	for _, n := range []string{"pending_secrets.json", "data/pending_secrets.json"} {
		if !isSecret(n) {
			t.Errorf("%s is not protected as a secret file", n)
		}
	}
	if isSecret("data/loans.json") {
		t.Error("an ordinary data file is treated as a secret")
	}
	s := open(t)
	want := `{"entry-1":"hunter2hunter2"}`
	if err := s.WriteFile("data/pending_secrets.json", want); err != nil {
		t.Fatal(err)
	}
	if got, err := s.ReadFile("data/pending_secrets.json"); err != nil || got != want {
		t.Fatalf("round trip: got %q, %v; want %q", got, err, want)
	}
	raw, err := os.ReadFile(filepath.Join(s.dir, "data", "pending_secrets.json"))
	if err == nil && runtime.GOOS == "windows" && strings.Contains(string(raw), "hunter2") {
		t.Error("the password is on disk in plain text")
	}
}
