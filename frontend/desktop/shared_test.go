package main

import (
	"encoding/json"
	"net"
	"strconv"
	"strings"
	"testing"
	"time"

	"cloudhouse/backend/localapi"
	"cloudhouse/desktop/lan"
	"cloudhouse/desktop/localstore"
)

const sharedTestKey = "00112233445566778899aabbccddeeff00112233445566778899aabbccddeeff"

func freeTCPPort(t *testing.T) int {
	t.Helper()
	l, err := net.Listen("tcp4", "127.0.0.1:0")
	if err != nil {
		t.Fatal(err)
	}
	defer l.Close()
	return l.Addr().(*net.TCPAddr).Port
}

func freeUDPPort(t *testing.T) int {
	t.Helper()
	c, err := net.ListenUDP("udp4", &net.UDPAddr{IP: net.IPv4(127, 0, 0, 1)})
	if err != nil {
		t.Fatal(err)
	}
	defer c.Close()
	return c.LocalAddr().(*net.UDPAddr).Port
}

func waitUntil(t *testing.T, what string, d time.Duration, ok func() bool) {
	t.Helper()
	end := time.Now().Add(d)
	for time.Now().Before(end) {
		if ok() {
			return
		}
		time.Sleep(50 * time.Millisecond)
	}
	t.Fatalf("timed out waiting for %s", what)
}

// twoPCs builds a main PC and a counter: two Apps, each with its own offline store and LAN agent, that find each other on
// this machine and hold the same business key.
func twoPCs(t *testing.T) (mainPC, counter *App) {
	t.Helper()
	mHTTP, mUDP := freeTCPPort(t), freeUDPPort(t)
	cHTTP, cUDP := freeTCPPort(t), freeUDPPort(t)
	mk := func(name, inst string, http, udp, otherUDP int) *App {
		a := &App{store: localstore.New(t.TempDir())}
		t.Cleanup(a.store.Close) // Windows cannot delete a folder whose database is still open
		a.lan = lan.New(lan.Config{Name: name, Instance: inst, DataDir: t.TempDir(), HTTPPort: http, DiscoveryPort: udp,
			ExtraTargets: []string{"127.0.0.1:" + strconv.Itoa(otherUDP)}})
		a.lan.SetBackend(hubBackend{a})
		if err := a.lan.SetKey(sharedTestKey); err != nil {
			t.Fatal(err)
		}
		return a
	}
	mainPC = mk("MAIN", "m", mHTTP, mUDP, cUDP)
	counter = mk("COUNTER", "c", cHTTP, cUDP, mUDP)
	mainPC.lan.Start()
	counter.lan.Start()
	t.Cleanup(func() {
		counter.lan.Stop()
		mainPC.lan.Stop()
		localapi.Close()
	})
	waitUntil(t, "the PCs to find each other", 8*time.Second, func() bool {
		return len(mainPC.lan.Peers()) == 1 && len(counter.lan.Peers()) == 1
	})
	return mainPC, counter
}

func chooseMain(t *testing.T, mainPC, counter *App) {
	t.Helper()
	if res := counter.lan.SetMain(mainPC.lan.ID()); !res.OK {
		t.Fatalf("choosing the main PC: %+v", res)
	}
	waitUntil(t, "both PCs to agree on the main PC", 8*time.Second, func() bool {
		return mainPC.lan.Status().IsMain && counter.lan.Status().MainID == mainPC.lan.ID()
	})
}

// idsOf lists the ids of outbox entries (or the error, so a failed read shows in the message).
func idsOf(lines []string, err error) string {
	if err != nil {
		return "ERROR: " + err.Error()
	}
	var ids []string
	for _, l := range lines {
		var e struct{ ID string }
		_ = json.Unmarshal([]byte(l), &e)
		ids = append(ids, e.ID)
	}
	return strings.Join(ids, ",")
}

// The counter keeps no business data of its own: what it saves lands in the main PC's store, what the main PC saves is
// what the counter reads, and only the counter's own identity files stay on the counter.
func TestACounterUsesTheMainPCsData(t *testing.T) {
	mainPC, counter := twoPCs(t)
	chooseMain(t, mainPC, counter)

	// the main PC's own user signs in: its own store, no sharing
	if err := mainPC.StoreOpen("biz", "pc"); err != nil {
		t.Fatalf("main PC open: %v", err)
	}
	if mainPC.isShared() {
		t.Fatal("the main PC must use its own store")
	}
	// the counter's user signs in: the data is the main PC's
	if err := counter.StoreOpen("biz", "pc"); err != nil {
		t.Fatalf("counter open: %v", err)
	}
	if !counter.isShared() {
		t.Fatal("the counter must use the main PC's data")
	}
	if dm := counter.LanDataMode(); !dm.Shared || dm.NeedRestart {
		t.Fatalf("data mode: %+v", dm)
	}

	// a save on the counter lands in the main PC's store, and nowhere on the counter
	if err := counter.StoreSaveEntry(`{"id":"e1","method":"POST","path":"/loans","targets":["e1"]}`, map[string]string{"data/loans.json": `[1]`}); err != nil {
		t.Fatalf("save on the counter: %v", err)
	}
	if got := idsOf(mainPC.store.ReadOutbox()); got != "e1" {
		t.Fatalf("the main PC's own outbox should hold the counter's entry, has %q", got)
	}
	if got, _ := mainPC.store.ReadFile("data/loans.json"); got != `[1]` {
		t.Fatalf("the counter's data file is not on the main PC: %q", got)
	}
	if got := idsOf(counter.store.ReadOutbox()); got != "" {
		t.Fatalf("the counter kept a private copy of the entry: %q", got)
	}

	// and the counter reads it back, through the main PC
	if got := idsOf(counter.StoreReadOutbox()); got != "e1" {
		t.Fatalf("the counter does not see the shared outbox: %q", got)
	}
	if counts, err := counter.StoreOutboxCounts(); err != nil || counts["pending"] != 1 {
		t.Fatalf("outbox counts through the main PC: %v %v", counts, err)
	}

	// what the main PC saves is what the counter reads (every PC sees one copy)
	if err := mainPC.StoreWriteFile("data/note.json", `{"a":2}`); err != nil {
		t.Fatal(err)
	}
	if got, err := counter.StoreReadFile("data/note.json"); err != nil || got != `{"a":2}` {
		t.Fatalf("the counter does not see what the main PC saved: %q %v", got, err)
	}

	// the counter's identity files stay on the counter and are never served by the main PC
	if err := counter.StoreWriteFile("device.json", `{"key":"counter"}`); err != nil {
		t.Fatal(err)
	}
	if got, _ := mainPC.store.ReadFile("device.json"); got != "" {
		t.Fatalf("the counter's device key reached the main PC: %q", got)
	}
	if got, _ := counter.StoreReadFile("device.json"); got != `{"key":"counter"}` {
		t.Fatalf("the counter cannot read its own device key: %q", got)
	}
	if _, err := (hubBackend{mainPC}).Call("ReadFile", []json.RawMessage{json.RawMessage(`"device.json"`)}); err == nil {
		t.Fatal("the main PC must refuse to serve an identity file")
	}

	// the mirror calls travel too
	if err := counter.StoreMirrorBindTenant(1); err != nil {
		t.Fatalf("mirror bind through the main PC: %v", err)
	}
	if got, err := counter.StoreMirrorState("nothing"); err != nil || got != "" {
		t.Fatalf("mirror state: %q %v", got, err)
	}

	// the read server answers from the main PC's copy, as the counter's user
	if got := counter.LocalApiGet("/users/7/loans", "", nil); got.Status != 401 {
		t.Fatalf("with no session the counter's read must be 401, got %d %s", got.Status, got.Body)
	}
	if err := counter.LocalApiBind(`{"tenantId":1,"employeeId":7,"roleId":10,"role":"Manager","branchId":1}`); err != nil {
		t.Fatal(err)
	}
	if got := counter.LocalApiGet("/users/7/loans", "", nil); got.Status == 503 || got.Status == 401 {
		t.Fatalf("the main PC did not answer the counter's read: %d %s", got.Status, got.Body)
	}

	// the main PC goes away: nothing can be saved, and nothing is saved anywhere else
	mainPC.lan.Stop()
	err := counter.StoreSaveEntry(`{"id":"e2","method":"POST","path":"/loans","targets":["e2"]}`, nil)
	if err == nil || !strings.Contains(err.Error(), "main PC") {
		t.Fatalf("a save with the main PC gone must fail and say why, got %v", err)
	}
	if got := idsOf(counter.store.ReadOutbox()); got != "" {
		t.Fatalf("the failed save was kept on the counter: %q", got)
	}
	// the counter's own identity files still work
	if got, err := counter.StoreReadFile("device.json"); err != nil || got == "" {
		t.Fatalf("identity files must not depend on the main PC: %q %v", got, err)
	}
}

func TestChangingTheMainPCTellsTheCounterToReopenItsStore(t *testing.T) {
	mainPC, counter := twoPCs(t)
	chooseMain(t, mainPC, counter)
	if err := mainPC.StoreOpen("biz", "pc"); err != nil {
		t.Fatal(err)
	}
	if err := counter.StoreOpen("biz", "pc"); err != nil {
		t.Fatal(err)
	}
	if dm := counter.LanDataMode(); dm.NeedRestart {
		t.Fatalf("nothing changed yet: %+v", dm)
	}

	// the counter becomes the main PC: its store must be reopened as its own
	if res := mainPC.lan.SetMain(counter.lan.ID()); !res.OK {
		t.Fatal(res.Message)
	}
	waitUntil(t, "the counter to learn it is the main PC", 8*time.Second, func() bool { return counter.lan.Status().IsMain })
	if dm := counter.LanDataMode(); !dm.NeedRestart || dm.Live.Shared {
		t.Fatalf("the counter must be told to reopen: %+v", dm)
	}
	if err := counter.StoreOpen("biz", "pc"); err != nil {
		t.Fatal(err)
	}
	if counter.isShared() {
		t.Fatal("after reopening, the new main PC uses its own store")
	}
	if dm := counter.LanDataMode(); dm.NeedRestart {
		t.Fatalf("after reopening nothing is pending: %+v", dm)
	}
}

func TestAPCWithoutAMainPCOrKeyKeepsUsingItsOwnStore(t *testing.T) {
	a := &App{store: localstore.New(t.TempDir())}
	t.Cleanup(a.store.Close)
	a.lan = lan.New(lan.Config{Name: "SOLO", Instance: "s", DataDir: t.TempDir(), HTTPPort: freeTCPPort(t), DiscoveryPort: freeUDPPort(t)})
	a.lan.SetBackend(hubBackend{a})
	if err := a.StoreOpen("biz", "pc"); err != nil {
		t.Fatal(err)
	}
	if a.isShared() {
		t.Fatal("with no main PC the app behaves exactly as before")
	}
	if err := a.StoreAppendOutbox(`{"id":"x1"}`); err != nil {
		t.Fatal(err)
	}
	if got := idsOf(a.StoreReadOutbox()); got != "x1" {
		t.Fatalf("own store: %q", got)
	}
}
