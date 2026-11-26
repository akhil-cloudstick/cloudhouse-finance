package localstore

import (
	"strings"
	"testing"
)

func TestEntriesCanBeHandedFromOneStoreToAnother(t *testing.T) {
	from, to := open(t), open(t)

	if err := from.SaveEntry(`{"id":"a","method":"POST","path":"/loans","targets":["loan-1"]}`, nil); err != nil {
		t.Fatal(err)
	}
	if err := from.AppendOutbox(`{"id":"b","method":"POST","path":"/cash"}`); err != nil {
		t.Fatal(err)
	}
	if err := from.MarkReview("b", "cash is no longer enough"); err != nil {
		t.Fatal(err)
	}
	if err := to.AppendOutbox(`{"id":"already-there"}`); err != nil {
		t.Fatal(err)
	}

	entries, err := from.ExportEntries()
	if err != nil || len(entries) != 2 {
		t.Fatalf("export: %v %v", entries, err)
	}
	if entries[0].Status != "pending" || entries[1].Status != "review" || entries[1].Message != "cash is no longer enough" {
		t.Fatalf("status and reason must travel with the entry: %+v", entries)
	}

	for _, e := range entries {
		added, err := to.ImportEntry(e)
		if err != nil || !added {
			t.Fatalf("import %s: added=%v err=%v", e.Line, added, err)
		}
	}

	// they sit after what the receiving store already had, in their own order
	all, _ := to.ReadAllOutbox()
	if len(all) != 3 || !strings.Contains(all[0], "already-there") || !strings.Contains(all[1], `"id":"a"`) || !strings.Contains(all[2], `"id":"b"`) {
		t.Fatalf("order after the hand-over: %v", all)
	}
	// the refused entry is still in review with its reason, and the held-behind rule still knows the record it touches
	review, _ := to.ReadReview()
	if len(review) != 1 || !strings.Contains(review[0], "cash is no longer enough") {
		t.Fatalf("the review entry and its reason must arrive: %v", review)
	}
	if counts, _ := to.Counts(); counts["pending"] != 2 || counts["review"] != 1 {
		t.Fatalf("counts: %v", counts)
	}

	// running it again changes nothing (an interrupted hand-over can be repeated)
	for _, e := range entries {
		if added, err := to.ImportEntry(e); err != nil || added {
			t.Fatalf("a repeat must report 'already here': added=%v err=%v", added, err)
		}
	}
	if all, _ := to.ReadAllOutbox(); len(all) != 3 {
		t.Fatalf("a repeat created duplicates: %v", all)
	}

	// an entry with no id is refused
	if _, err := to.ImportEntry(ExportedEntry{Line: `{"nothing":1}`}); err == nil {
		t.Fatal("an entry without an id must be refused")
	}
}
