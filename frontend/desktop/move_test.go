package main

import (
	"encoding/base64"
	"encoding/json"
	"os"
	"strings"
	"testing"
	"time"

	"cloudhouse/desktop/lan"
	"cloudhouse/desktop/localstore"
)

// Moving the main PC: the new main PC ends up with all of the old one's data, keeps its own file as a backup, keeps its own
// identity and its own queued entries, and the old main PC still has its copy. The old main PC rejoins as a counter without
// duplicating anything.
func TestMovingTheMainPCBringsTheWholeDataAndKeepsBothOldFiles(t *testing.T) {
	oldMain, newMain := twoPCs(t)
	chooseMain(t, oldMain, newMain) // the old main PC is chosen first
	must := func(err error) {
		t.Helper()
		if err != nil {
			t.Fatal(err)
		}
	}

	// the old main PC holds the shop's data
	must(oldMain.StoreOpen("biz", "pc"))
	must(oldMain.StoreSaveEntry(`{"id":"x1","method":"POST","path":"/loans","targets":["x1"]}`, map[string]string{"data/loans.json": `[1,2]`}))
	must(oldMain.StoreAppendOutbox(`{"id":"x2","method":"POST","path":"/cash"}`))
	must(oldMain.store.MarkReview("x2", "refused by the server"))
	must(oldMain.StoreMirrorBindTenant(1))
	must(oldMain.StoreWriteFile("device.json", `{"k":"OLD-MAIN-IDENTITY"}`))

	// the PC that will become main: signed in as a counter, with a leftover entry and its own identity
	must(newMain.StoreOpen("biz", "pc"))
	must(newMain.store.AppendOutbox(`{"id":"y1","method":"POST","path":"/customers"}`))
	must(newMain.store.WriteFile("device.json", `{"k":"NEW-MAIN-IDENTITY"}`))

	res := newMain.LanMoveMain()
	if !res.OK {
		t.Fatalf("the move failed: %s", res.Message)
	}
	if _, err := os.Stat(res.Backup); err != nil {
		t.Fatalf("this PC's previous data file must be kept: %v", err)
	}

	// the new main PC is the main PC, on its own store, with everything
	if !newMain.lan.Status().IsMain || newMain.isShared() {
		t.Fatalf("the new main PC must be the main PC: %+v", newMain.lan.Status())
	}
	if got := idsOf(newMain.store.ReadAllOutbox()); got != "x1,x2,y1" {
		t.Fatalf("the new main PC's outbox must be the old one's, then its own: %q", got)
	}
	if review, _ := newMain.store.ReadReview(); len(review) != 1 || !strings.Contains(review[0], "refused by the server") {
		t.Fatalf("the refused entry and its reason must come across: %v", review)
	}
	if got, _ := newMain.store.ReadFile("data/loans.json"); got != `[1,2]` {
		t.Fatalf("the data file did not come across: %q", got)
	}
	if got, _ := newMain.store.ReadFile("device.json"); !strings.Contains(got, "NEW-MAIN-IDENTITY") {
		t.Fatalf("a PC keeps its own identity, never the old main PC's: %q", got)
	}

	// the old main PC's file is still there as a second copy, and it can save again
	if got := idsOf(oldMain.store.ReadAllOutbox()); got != "x1,x2" {
		t.Fatalf("the old main PC's copy must be kept: %q", got)
	}
	if got, _ := oldMain.store.ReadFile("device.json"); !strings.Contains(got, "OLD-MAIN-IDENTITY") {
		t.Fatalf("the old main PC's identity changed: %q", got)
	}
	if err := oldMain.writeGate(); err != nil {
		t.Fatalf("the old main PC must be allowed to save again: %v", err)
	}

	// the old main PC follows the new choice and rejoins as a counter: its copy is already there, so nothing is duplicated
	waitUntil(t, "the old main PC to follow", 8*time.Second, func() bool {
		st := oldMain.lan.Status()
		return st.MainID == newMain.lan.ID() && !st.IsMain
	})
	must(oldMain.StoreOpen("biz", "pc"))
	if !oldMain.isShared() {
		t.Fatal("the old main PC must now be a counter")
	}
	if h := oldMain.LanDataMode().Handover; h.Left != 0 || h.Error != "" {
		t.Fatalf("the old main PC's hand-over: %+v", h)
	}
	if got := idsOf(newMain.store.ReadAllOutbox()); got != "x1,x2,y1" {
		t.Fatalf("rejoining duplicated entries on the new main PC: %q", got)
	}
	if got := idsOf(oldMain.store.ReadAllOutbox()); got != "" {
		t.Fatalf("the old main PC still holds entries the new main PC confirmed: %q", got)
	}
}

// A copy that is damaged on the way is noticed: nothing is changed here, the old main PC is let loose again, and no PC
// becomes the main PC.
func TestADamagedCopyChangesNothingAndFreesTheOldMainPC(t *testing.T) {
	oldMain, newMain := twoPCs(t)
	chooseMain(t, oldMain, newMain)
	if err := oldMain.StoreOpen("biz", "pc"); err != nil {
		t.Fatal(err)
	}
	if err := oldMain.StoreAppendOutbox(`{"id":"x1"}`); err != nil {
		t.Fatal(err)
	}
	if err := newMain.StoreOpen("biz", "pc"); err != nil {
		t.Fatal(err)
	}
	if err := newMain.store.AppendOutbox(`{"id":"y1"}`); err != nil {
		t.Fatal(err)
	}
	oldMain.lan.SetBackend(tamperingBackend{hubBackend{oldMain}}) // flips a byte of every piece it sends

	res := newMain.LanMoveMain()
	if res.OK || !strings.Contains(res.Message, "does not match") {
		t.Fatalf("a damaged copy must be refused with a reason: %+v", res)
	}
	if newMain.lan.Status().IsMain {
		t.Fatal("no PC may become the main PC after a failed move")
	}
	if got := idsOf(newMain.store.ReadAllOutbox()); got != "y1" {
		t.Fatalf("a failed move changed this PC's data: %q", got)
	}
	if err := oldMain.writeGate(); err != nil {
		t.Fatalf("the old main PC must be allowed to save again after a failed move: %v", err)
	}
	if got := idsOf(oldMain.store.ReadAllOutbox()); got != "x1" {
		t.Fatalf("the old main PC's data: %q", got)
	}
}

func TestSavingPausesWhileTheMainPCIsMovedAndOnlyThen(t *testing.T) {
	mainPC := &App{store: localstore.New(t.TempDir())}
	t.Cleanup(mainPC.store.Close)
	mainPC.lan = lan.New(lan.Config{Name: "M", Instance: "p", DataDir: t.TempDir(), HTTPPort: freeTCPPort(t), DiscoveryPort: freeUDPPort(t)})
	if err := mainPC.StoreOpen("biz", "pc"); err != nil {
		t.Fatal(err)
	}
	if err := mainPC.lan.SetKey(sharedTestKey); err != nil {
		t.Fatal(err)
	}
	mainPC.lan.SetMain(mainPC.lan.ID())

	if err := mainPC.StoreAppendOutbox(`{"id":"a"}`); err != nil {
		t.Fatalf("before the move: %v", err)
	}
	if err := mainPC.moveFreeze("some-id", "NEW"); err != nil {
		t.Fatal(err)
	}
	// its own screen and the other PCs are both held back; reading still works
	if err := mainPC.StoreAppendOutbox(`{"id":"b"}`); err == nil || !strings.Contains(err.Error(), "being moved") {
		t.Fatalf("its own save must pause during the move: %v", err)
	}
	if _, err := (hubBackend{mainPC}).Call("AppendOutbox", []json.RawMessage{json.RawMessage(`"{\"id\":\"c\"}"`)}); err == nil {
		t.Fatal("another PC's save must pause during the move")
	}
	if got := idsOf(mainPC.StoreReadOutbox()); got != "a" {
		t.Fatalf("reading must keep working during the move, and nothing may have been saved: %q", got)
	}
	// abandoned: saving is allowed at once; and a forgotten freeze runs out by itself
	mainPC.moveDone(false)
	if err := mainPC.StoreAppendOutbox(`{"id":"d"}`); err != nil {
		t.Fatalf("after the move is abandoned: %v", err)
	}
	mainPC.sh.mu.Lock()
	mainPC.sh.frozenUntil = time.Now().Add(-time.Second)
	mainPC.sh.mu.Unlock()
	if err := mainPC.writeGate(); err != nil {
		t.Fatalf("a freeze must run out by itself: %v", err)
	}
}

func TestAMoveIsRefusedWhenThereIsNothingToMoveFrom(t *testing.T) {
	a := &App{store: localstore.New(t.TempDir())}
	t.Cleanup(a.store.Close)
	a.lan = lan.New(lan.Config{Name: "S", Instance: "m", DataDir: t.TempDir(), HTTPPort: freeTCPPort(t), DiscoveryPort: freeUDPPort(t)})
	_ = a.StoreOpen("biz", "pc")
	if res := a.LanMoveMain(); res.OK || res.Message == "" {
		t.Fatalf("without a business key and a main PC a move must be refused with a reason: %+v", res)
	}
}

// tamperingBackend is the old main PC's hub with a fault: every piece of the copy it sends has one byte flipped.
type tamperingBackend struct{ hubBackend }

func (t tamperingBackend) Call(method string, args []json.RawMessage) (any, error) {
	res, err := t.hubBackend.Call(method, args)
	if method == "MoveRead" && err == nil {
		if s, ok := res.(string); ok {
			if b, derr := base64.StdEncoding.DecodeString(s); derr == nil && len(b) > 20 {
				b[10] ^= 0xff
				return base64.StdEncoding.EncodeToString(b), nil
			}
		}
	}
	return res, err
}
