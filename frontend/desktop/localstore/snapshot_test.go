package localstore

import (
	"os"
	"path/filepath"
	"strings"
	"testing"
)

func TestSnapshotCarriesTheDataButNotThePCsIdentity(t *testing.T) {
	src := open(t)
	if err := src.SaveEntry(`{"id":"e1","method":"POST","path":"/loans","targets":["e1"]}`, map[string]string{
		"data/loans.json": `[1,2,3]`,
		"device.json":     `{"key":"source-pc-private-key"}`,
		"users.json":      `{"u":1}`,
	}); err != nil {
		t.Fatal(err)
	}
	snap := filepath.Join(t.TempDir(), "move", "snapshot.db")
	if err := src.Snapshot(snap); err != nil {
		t.Fatal(err)
	}
	counts, err := VerifyDB(snap)
	if err != nil {
		t.Fatal(err)
	}
	if counts["entries"] != 1 {
		t.Fatalf("the entry must be in the snapshot: %v", counts)
	}
	if counts["files"] != 1 { // data/loans.json only: the device key and the sign-ins stay on their own PC
		t.Fatalf("only the data file may travel, the identity files must not: files=%d", counts["files"])
	}
	// the source is untouched: it still has its own identity
	if got, _ := src.ReadFile("device.json"); !strings.Contains(got, "source-pc-private-key") {
		t.Fatalf("making a snapshot changed the source: %q", got)
	}
}

func TestAnOriginalSwappedForASnapshotKeepsTheOldFileAndOpensTheNew(t *testing.T) {
	src, dst := open(t), open(t)
	if err := src.SaveEntry(`{"id":"from-src"}`, map[string]string{"data/a.json": `{"from":"src"}`}); err != nil {
		t.Fatal(err)
	}
	if err := dst.SaveEntry(`{"id":"was-on-dst"}`, map[string]string{"device.json": `{"key":"dst-own"}`}); err != nil {
		t.Fatal(err)
	}
	snap := filepath.Join(t.TempDir(), "s.db")
	if err := src.Snapshot(snap); err != nil {
		t.Fatal(err)
	}
	if _, err := VerifyDB(snap); err != nil {
		t.Fatal(err)
	}
	backup, err := dst.ReplaceDB(snap)
	if err != nil {
		t.Fatal(err)
	}
	if _, err := os.Stat(backup); err != nil {
		t.Fatalf("the replaced file must be kept as a backup: %v", err)
	}
	// the store now serves the snapshot's data
	if got, _ := dst.ReadAllOutbox(); len(got) != 1 || !strings.Contains(got[0], "from-src") {
		t.Fatalf("after the swap: %v", got)
	}
	if got, _ := dst.ReadFile("data/a.json"); !strings.Contains(got, "src") {
		t.Fatalf("data file: %q", got)
	}
	// and it is a working store: a save still works
	if err := dst.AppendOutbox(`{"id":"after"}`); err != nil {
		t.Fatalf("the store must keep working after the swap: %v", err)
	}
	// the backup still holds what was there before, readable as a store of its own
	if counts, err := VerifyDB(backup); err != nil || counts["entries"] != 1 {
		t.Fatalf("the backup must be intact: %v %v", counts, err)
	}
}

func TestADamagedSnapshotIsRefusedAndNothingChanges(t *testing.T) {
	dst := open(t)
	if err := dst.AppendOutbox(`{"id":"mine"}`); err != nil {
		t.Fatal(err)
	}
	bad := filepath.Join(t.TempDir(), "bad.db")
	if err := os.WriteFile(bad, []byte("this is not a database file at all, just text padding padding padding padding"), 0o600); err != nil {
		t.Fatal(err)
	}
	if _, err := VerifyDB(bad); err == nil {
		t.Fatal("a damaged copy must fail the check")
	}
	// even if a bad file did reach the swap, the store ends up on its own data
	if _, err := dst.ReplaceDB(bad); err == nil {
		t.Fatal("swapping in a damaged file must fail")
	}
	if got, _ := dst.ReadAllOutbox(); len(got) != 1 || !strings.Contains(got[0], "mine") {
		t.Fatalf("the store must still hold its own data after a failed swap: %v", got)
	}
	if err := dst.AppendOutbox(`{"id":"still-works"}`); err != nil {
		t.Fatalf("the store must still work: %v", err)
	}
}
