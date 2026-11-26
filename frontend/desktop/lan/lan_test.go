package lan

import (
	"bytes"
	"encoding/json"
	"errors"
	"net"
	"net/http"
	"os"
	"strconv"
	"strings"
	"testing"
	"time"
)

func freeTCP(t *testing.T) int {
	t.Helper()
	l, err := net.Listen("tcp4", "127.0.0.1:0")
	if err != nil {
		t.Fatal(err)
	}
	defer l.Close()
	return l.Addr().(*net.TCPAddr).Port
}

func freeUDP(t *testing.T) int {
	t.Helper()
	c, err := net.ListenUDP("udp4", &net.UDPAddr{IP: net.IPv4(127, 0, 0, 1)})
	if err != nil {
		t.Fatal(err)
	}
	defer c.Close()
	return c.LocalAddr().(*net.UDPAddr).Port
}

func waitFor(t *testing.T, what string, d time.Duration, ok func() bool) {
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

func TestBeaconRoundTrip(t *testing.T) {
	data := encodeBeacon(Beacon{ID: "abc12345", Name: "Office", IPs: []string{"169.254.1.2"}, Port: 9125, Version: "1.2.3"}, nil)
	b, ok := decodeBeacon(data)
	if !ok || b.ID != "abc12345" || b.Name != "Office" || b.Port != 9125 || b.App != AppTag {
		t.Fatalf("round trip failed: %+v ok=%v", b, ok)
	}
}

func TestBeaconRejectsStrangers(t *testing.T) {
	for name, data := range map[string]string{
		"not json":  "hello",
		"other app": `{"app":"something-else","v":1,"id":"x","port":9125}`,
		"no id":     `{"app":"cloudhouse-lan","v":1,"port":9125}`,
		"bad port":  `{"app":"cloudhouse-lan","v":1,"id":"x","port":0}`,
		"other v":   `{"app":"cloudhouse-lan","v":99,"id":"x","port":9125}`,
	} {
		if _, ok := decodeBeacon([]byte(data)); ok {
			t.Errorf("%s was accepted", name)
		}
	}
}

func TestMakeIfaceLinkLocalAndBroadcast(t *testing.T) {
	f, ok := makeIface("Ethernet", net.IPv4(169, 254, 7, 9), net.CIDRMask(16, 32))
	if !ok || !f.LinkLocal || f.Broadcast != "169.254.255.255" {
		t.Fatalf("link-local: %+v ok=%v", f, ok)
	}
	f, ok = makeIface("LAN", net.IPv4(192, 168, 1, 5), net.CIDRMask(24, 32))
	if !ok || f.LinkLocal || f.Broadcast != "192.168.1.255" {
		t.Fatalf("private: %+v ok=%v", f, ok)
	}
	if _, ok := makeIface("lo", net.IPv4(127, 0, 0, 1), net.CIDRMask(8, 32)); ok {
		t.Error("loopback must be skipped")
	}
	if _, ok := makeIface("vpn", net.IPv4(10, 0, 0, 2), net.CIDRMask(32, 32)); ok {
		t.Error("a /32 has no broadcast and must be skipped")
	}
}

func TestSplitTarget(t *testing.T) {
	h, p := splitTarget("192.168.1.5", 9125)
	if h != "192.168.1.5" || p != 9125 {
		t.Errorf("got %s %d", h, p)
	}
	h, p = splitTarget(" 127.0.0.1:9225 ", 9125)
	if h != "127.0.0.1" || p != 9225 {
		t.Errorf("got %s %d", h, p)
	}
}

func TestProbeRefusedHasPlainReason(t *testing.T) {
	res := Probe("127.0.0.1", freeTCP(t), time.Second)
	if res.Status != "refused" || !strings.Contains(res.Message, "nothing is listening") {
		t.Fatalf("got %+v", res)
	}
}

// Two agents on one PC, each with its own ports, find each other through the extra-target route, test the
// connection, and never list themselves.
func TestTwoAgentsFindEachOther(t *testing.T) {
	aHTTP, aUDP := freeTCP(t), freeUDP(t)
	bHTTP, bUDP := freeTCP(t), freeUDP(t)
	a := New(Config{Name: "PC-A", Version: "1", DataDir: t.TempDir(), Instance: "a", HTTPPort: aHTTP, DiscoveryPort: aUDP, ExtraTargets: []string{"127.0.0.1:" + strconv.Itoa(bUDP)}})
	b := New(Config{Name: "PC-B", Version: "2", DataDir: t.TempDir(), Instance: "b", HTTPPort: bHTTP, DiscoveryPort: bUDP, ExtraTargets: []string{"127.0.0.1:" + strconv.Itoa(aUDP)}})
	a.Start()
	b.Start()
	defer a.Stop()
	defer b.Stop()

	waitFor(t, "A to find B", 8*time.Second, func() bool { return len(a.Peers()) == 1 })
	waitFor(t, "B to find A", 8*time.Second, func() bool { return len(b.Peers()) == 1 })

	p := a.Peers()[0]
	if p.ID != b.ID() || p.IP != "127.0.0.1" || p.Port != bHTTP || p.Version != "2" {
		t.Fatalf("wrong peer: %+v", p)
	}
	for _, peer := range a.Peers() {
		if peer.ID == a.ID() {
			t.Fatal("an agent listed itself")
		}
	}

	res := a.TestPeer("127.0.0.1:" + strconv.Itoa(bHTTP))
	if res.Status != "reachable" || res.PeerID != b.ID() {
		t.Fatalf("test connection: %+v", res)
	}

	foundLine := false
	for _, e := range a.Log().Entries() {
		if e.Component == "PEER" && strings.Contains(e.Message, "found") {
			foundLine = true
		}
	}
	if !foundLine {
		t.Error("the log has no 'found' line")
	}
}

func TestPeerIsLostAndLogged(t *testing.T) {
	aHTTP, aUDP := freeTCP(t), freeUDP(t)
	bHTTP, bUDP := freeTCP(t), freeUDP(t)
	a := New(Config{Name: "PC-A", DataDir: t.TempDir(), Instance: "a", HTTPPort: aHTTP, DiscoveryPort: aUDP, ExtraTargets: []string{"127.0.0.1:" + strconv.Itoa(bUDP)}})
	b := New(Config{Name: "PC-B", DataDir: t.TempDir(), Instance: "b", HTTPPort: bHTTP, DiscoveryPort: bUDP, ExtraTargets: []string{"127.0.0.1:" + strconv.Itoa(aUDP)}})
	a.Start()
	b.Start()
	defer a.Stop()
	waitFor(t, "A to find B", 8*time.Second, func() bool { return len(a.Peers()) == 1 })

	b.Stop() // the other PC goes away
	waitFor(t, "B to be lost", peerExpiry+8*time.Second, func() bool { return len(a.Peers()) == 0 })

	lost := false
	for _, e := range a.Log().Entries() {
		if e.Level == "warn" && strings.Contains(e.Message, "lost") && strings.Contains(e.Message, "cable") {
			lost = true
		}
	}
	if !lost {
		t.Error("losing the peer was not explained in the log")
	}
}

func TestPruneForgetsRoutesThatNoLongerExist(t *testing.T) {
	a := New(Config{DataDir: t.TempDir(), Instance: "p", HTTPPort: freeTCP(t), DiscoveryPort: freeUDP(t)})
	gone := Iface{Name: "Wi-Fi", IP: "169.254.93.152"}
	kept := Iface{Name: "Ethernet", IP: "192.168.0.5"}
	a.sendErrs[routeKey(gone, "255.255.255.255")] = "bind: not valid"
	a.sendErrs["seen|"+routeKey(gone, "255.255.255.255")] = ""
	a.sendErrs[routeKey(kept, "255.255.255.255")] = "some error"
	a.sendErrs["extra|127.0.0.1:9"] = "kept"

	a.pruneSendErrs(map[string]bool{routeKey(kept, "255.255.255.255"): true})

	if len(a.sendErrs) != 2 {
		t.Fatalf("want the kept route and the extra target only, got %v", a.sendErrs)
	}
	if _, ok := a.sendErrs[routeKey(gone, "255.255.255.255")]; ok {
		t.Error("the route of the vanished address was kept")
	}
}

// The case from the field: a cable (169.254.250.80) and Tailscale (169.254.83.107) both sit on 169.254.0.0/16, so both
// are candidates for a peer at 169.254.180.11; a Wi-Fi card on another range is not.
func TestCandidateIfacesFindsEveryCardOnTheTargetsRange(t *testing.T) {
	mk := func(name, ip string, bits int) Iface {
		f, ok := makeIface(name, net.ParseIP(ip), net.CIDRMask(bits, 32))
		if !ok {
			t.Fatalf("bad iface %s", ip)
		}
		return f
	}
	usable := []Iface{mk("Tailscale", "169.254.83.107", 16), mk("Ethernet", "169.254.250.80", 16), mk("Wi-Fi", "192.168.1.101", 24)}

	got := candidateIfaces(net.ParseIP("169.254.180.11"), usable)
	if len(got) != 2 || got[0].Name != "Tailscale" || got[1].Name != "Ethernet" {
		t.Fatalf("169.254.x target: got %+v", got)
	}
	if got := candidateIfaces(net.ParseIP("192.168.1.7"), usable); len(got) != 1 || got[0].Name != "Wi-Fi" {
		t.Fatalf("192.168.1 target: got %+v", got)
	}
	if got := candidateIfaces(net.ParseIP("10.9.9.9"), usable); len(got) != 0 {
		t.Fatalf("a routed address must have no candidates, got %+v", got)
	}
	if ov := overlappingLinkLocal(usable); len(ov) != 2 {
		t.Fatalf("overlap not detected: %v", ov)
	}
	if ov := overlappingLinkLocal(usable[1:]); ov != nil {
		t.Fatalf("one link-local card is not an overlap: %v", ov)
	}
}

// Forcing a connection out of a chosen network card must work: connect to this PC's own address through its own card.
func TestProbeCanBeForcedThroughAChosenCard(t *testing.T) {
	rep := ScanInterfaces()
	if len(rep.Usable) == 0 {
		t.Skip("no network card with an address on this machine")
	}
	card := rep.Usable[0]
	a := New(Config{Name: "forced", DataDir: t.TempDir(), Instance: "f", HTTPPort: freeTCP(t), DiscoveryPort: freeUDP(t)})
	a.Start()
	defer a.Stop()
	res := probeOnce(card.IP, a.cfg.HTTPPort, 3*time.Second, &card)
	if res.Status != "reachable" || res.Via != card.Name {
		t.Fatalf("forced through %s (%s): %+v", card.Name, card.IP, res)
	}
}

// Real `netsh advfirewall firewall show rule ... verbose` text: a Block rule that names the running program must be
// found (it beats every Allow rule), and rules for other programs must not be.
func TestParseProgramRulesFindsABlockForThisProgram(t *testing.T) {
	const exe = `C:\Users\PC7\AppData\Local\Programs\RK Finance\default-finance.exe`
	raw := "\r\nRule Name:                            default-finance.exe\r\n" +
		"----------------------------------------------------------------------\r\n" +
		"Enabled:                              Yes\r\nDirection:                            In\r\n" +
		"Profiles:                             Private\r\nProtocol:                             TCP\r\n" +
		"LocalPort:                            Any\r\nProgram:                              c:\\users\\pc7\\appdata\\local\\programs\\rk finance\\default-finance.exe\r\n" +
		"Action:                               Block\r\n\r\n" +
		"Rule Name:                            default-finance.exe\r\n" +
		"----------------------------------------------------------------------\r\n" +
		"Enabled:                              Yes\r\nProfiles:                             Public\r\nProtocol:                             UDP\r\n" +
		"Program:                              C:\\Users\\PC7\\AppData\\Local\\Programs\\RK Finance\\default-finance.exe\r\nAction:                               Allow\r\n\r\n" +
		"Rule Name:                            other.exe\r\n" +
		"----------------------------------------------------------------------\r\n" +
		"Enabled:                              Yes\r\nProfiles:                             Public\r\nProtocol:                             TCP\r\n" +
		"Program:                              C:\\other\\other.exe\r\nAction:                               Block\r\n"

	rules, understood := parseProgramRules(raw, exe)
	if understood != 3 || len(rules) != 2 {
		t.Fatalf("understood=%d rules=%+v", understood, rules)
	}
	blocked := FirewallInfo{ProgramRules: rules}.BlockedRules()
	if len(blocked) != 1 || blocked[0].Profiles != "Private" || blocked[0].Protocol != "TCP" {
		t.Fatalf("the Private TCP block was not found: %+v", blocked)
	}
	if _, n := parseProgramRules("Regel-Name: x\nAktion: Blockieren\n", exe); n != 0 {
		t.Error("text in another language must be reported as not understood, never as 'no block'")
	}
}

// pair starts two agents on loopback that find each other, and returns them with a function that stops both.
func pair(t *testing.T) (a, b *Agent, dirA, dirB string) {
	t.Helper()
	aHTTP, aUDP := freeTCP(t), freeUDP(t)
	bHTTP, bUDP := freeTCP(t), freeUDP(t)
	dirA, dirB = t.TempDir(), t.TempDir()
	a = New(Config{Name: "PC-A", DataDir: dirA, Instance: "a", HTTPPort: aHTTP, DiscoveryPort: aUDP, ExtraTargets: []string{"127.0.0.1:" + strconv.Itoa(bUDP)}})
	b = New(Config{Name: "PC-B", DataDir: dirB, Instance: "b", HTTPPort: bHTTP, DiscoveryPort: bUDP, ExtraTargets: []string{"127.0.0.1:" + strconv.Itoa(aUDP)}})
	// two PCs of one business hold the same business key
	for _, ag := range []*Agent{a, b} {
		if err := ag.SetKey(testKey); err != nil {
			t.Fatal(err)
		}
	}
	a.Start()
	b.Start()
	t.Cleanup(func() { a.Stop(); b.Stop() })
	waitFor(t, "A and B to find each other", 8*time.Second, func() bool { return len(a.Peers()) == 1 && len(b.Peers()) == 1 })
	return
}

const (
	testKey     = "00112233445566778899aabbccddeeff00112233445566778899aabbccddeeff"
	otherBizKey = "ffeeddccbbaa99887766554433221100ffeeddccbbaa99887766554433221100"
)

func agree(t *testing.T, a, b *Agent, mainID string, epoch int) {
	t.Helper()
	waitFor(t, "both PCs to agree on the main PC", 8*time.Second, func() bool {
		sa, sb := a.Status(), b.Status()
		return sa.MainID == mainID && sb.MainID == mainID && sa.Epoch == epoch && sb.Epoch == epoch
	})
}

func TestChoosingTheMainPCSpreadsToEveryPC(t *testing.T) {
	a, b, _, _ := pair(t)

	// A's admin chooses B
	if res := a.SetMain(b.ID()); !res.OK || res.Epoch != 1 {
		t.Fatalf("choose B: %+v", res)
	}
	agree(t, a, b, b.ID(), 1)
	if !b.Status().IsMain || a.Status().IsMain {
		t.Fatalf("only B should be the main PC: A=%v B=%v", a.Status().IsMain, b.Status().IsMain)
	}
	if !a.Status().MainOnline || a.Status().MainName != b.cfg.Name {
		t.Fatalf("A should see PC-B online as main: %+v", a.Status())
	}
	var sawMain bool
	for _, p := range a.Peers() {
		sawMain = sawMain || (p.ID == b.ID() && p.IsMain)
	}
	if !sawMain {
		t.Fatal("the peer list does not mark PC-B as the main PC")
	}

	// B's admin changes it to A: the higher version wins everywhere
	if res := b.SetMain(a.ID()); !res.OK || res.Epoch != 2 {
		t.Fatalf("choose A: %+v", res)
	}
	agree(t, a, b, a.ID(), 2)
	if !a.Status().IsMain || b.Status().IsMain {
		t.Fatal("A should be the main PC now")
	}

	// and it can be removed
	a.ClearMain()
	agree(t, a, b, "", 3)
}

func TestTwoAdminsAtTheSameMomentStillAgree(t *testing.T) {
	a, b, _, _ := pair(t)
	// each admin chooses their own PC before hearing the other: both make version 1
	a.SetMain(a.ID())
	b.SetMain(b.ID())

	lower := a.ID()
	if b.ID() < lower {
		lower = b.ID()
	}
	agree(t, a, b, lower, 1)
}

func TestMainPCChoiceSurvivesARestart(t *testing.T) {
	a, b, dirA, _ := pair(t)
	a.SetMain(b.ID())
	agree(t, a, b, b.ID(), 1)
	a.Stop()

	again := New(Config{Name: "PC-A", DataDir: dirA, Instance: "a", HTTPPort: freeTCP(t), DiscoveryPort: freeUDP(t)})
	if st := again.Status(); st.MainID != b.ID() || st.Epoch != 1 || st.MainName != b.cfg.Name {
		t.Fatalf("a restarted PC forgot the main PC: %+v", st)
	}
}

func TestOnlyAPCOnTheNetworkCanBeChosen(t *testing.T) {
	a, _, _, _ := pair(t)
	res := a.SetMain("0123456789abcdef")
	if res.OK || a.Status().MainID != "" || a.Status().Epoch != 0 {
		t.Fatalf("an unknown PC was accepted: %+v %+v", res, a.Status())
	}
}

// A PC that is only reachable by TCP (added by IP, broadcasts blocked) still learns the choice from the ping reply.
func TestMainPCChoiceTravelsInTheConnectionTestToo(t *testing.T) {
	a, b, _, _ := pair(t)
	b.SetMain(b.ID())
	waitFor(t, "B to record its own choice", 2*time.Second, func() bool { return b.Status().IsMain })
	res := Probe("127.0.0.1", b.cfg.HTTPPort, 2*time.Second)
	if res.PeerEpoch != 1 || res.PeerMainID != b.ID() || res.PeerMainName != b.cfg.Name {
		t.Fatalf("ping reply does not carry the main PC: %+v", res)
	}
	a.adoptFromReply(res)
	if a.Status().MainID != b.ID() {
		t.Fatalf("A did not adopt the choice it learned from the ping: %+v", a.Status())
	}
}

func TestSignaturesAreAcceptedOnlyUnderTheSameKey(t *testing.T) {
	key, _ := parseKey(testKey)
	other, _ := parseKey(otherBizKey)
	b := Beacon{ID: "abc12345", Name: "Office", Port: 9125, Epoch: 3, MainID: "abc12345", MainName: "Office"}
	got, ok := decodeBeacon(encodeBeacon(b, key))
	if !ok || !verifySig(key, got.Sig, got.sigParts()...) {
		t.Fatal("a beacon signed with the key must verify under it")
	}
	if verifySig(other, got.Sig, got.sigParts()...) {
		t.Fatal("another business's key must not verify it")
	}
	got.MainID = "evil0000" // a stranger changes who the main PC is
	if verifySig(key, got.Sig, got.sigParts()...) {
		t.Fatal("changing the announced main PC must break the signature")
	}
	if unsigned, _ := decodeBeacon(encodeBeacon(b, nil)); verifySig(key, unsigned.Sig, unsigned.sigParts()...) {
		t.Fatal("an unsigned beacon must never verify")
	}
}

// A PC that does not hold the business key cannot make the others use it as the main PC.
func TestAMainPCChosenWithAnotherKeyIsNotAdopted(t *testing.T) {
	a, b, _, _ := pair(t)

	aHTTP, aUDP := a.cfg.HTTPPort, a.cfg.DiscoveryPort
	_ = aHTTP
	stranger := New(Config{Name: "STRANGER", DataDir: t.TempDir(), Instance: "s", HTTPPort: freeTCP(t), DiscoveryPort: freeUDP(t),
		ExtraTargets: []string{"127.0.0.1:" + strconv.Itoa(aUDP)}})
	if err := stranger.SetKey(otherBizKey); err != nil {
		t.Fatal(err)
	}
	stranger.Start()
	defer stranger.Stop()
	waitFor(t, "A to hear the stranger", 8*time.Second, func() bool { return len(a.Peers()) == 2 })

	stranger.SetMain(stranger.ID()) // the stranger declares itself the main PC
	time.Sleep(4 * time.Second)     // plenty of announcements
	if st := a.Status(); st.MainID != "" || st.Epoch != 0 {
		t.Fatalf("A took a main PC announced by a PC with another key: %+v", st)
	}
	if st := b.Status(); st.MainID != "" {
		t.Fatalf("B took it too: %+v", st)
	}
	for _, p := range a.Peers() {
		if p.Name == stranger.cfg.Name && p.Verified {
			t.Fatal("the stranger is shown as verified")
		}
	}
}

type echoBackend struct{ calls int }

func (e *echoBackend) Call(method string, args []json.RawMessage) (any, error) {
	e.calls++
	if method == "Fail" {
		return nil, errors.New("boom")
	}
	return map[string]any{"method": method, "args": len(args), "first": string(firstArg(args))}, nil
}

func firstArg(args []json.RawMessage) json.RawMessage {
	if len(args) == 0 {
		return nil
	}
	return args[0]
}

// The counter's storage call reaches the main PC, is checked against the business key, runs on the main PC's backend, and
// the answer comes back; a wrong key, a changed body or a PC that is not the main PC is refused.
func TestCounterStorageCallsRunOnTheMainPC(t *testing.T) {
	counter, main, _, _ := pair(t)
	be := &echoBackend{}
	main.SetBackend(be)

	if _, err := counter.Call("Echo", "x"); err == nil {
		t.Fatal("with no main PC chosen a counter has nothing to call")
	}
	counter.SetMain(main.ID())
	agree(t, counter, main, main.ID(), 1)

	m := counter.Mode()
	if !m.Shared || !m.MainOnline || m.MainName != main.cfg.Name {
		t.Fatalf("the counter should use the main PC's data: %+v", m)
	}
	if mm := main.Mode(); mm.Shared {
		t.Fatalf("the main PC uses its own data: %+v", mm)
	}

	raw, err := counter.Call("Echo", "hello", 42)
	if err != nil {
		t.Fatalf("storage call: %v", err)
	}
	var got struct {
		Method string
		Args   int
		First  string
	}
	if json.Unmarshal(raw, &got) != nil || got.Method != "Echo" || got.Args != 2 || got.First != `"hello"` || be.calls != 1 {
		t.Fatalf("the call did not run on the main PC's backend: %s (calls=%d)", raw, be.calls)
	}
	// an error from the backend comes back as the error
	if _, err := counter.Call("Fail"); err == nil || !strings.Contains(err.Error(), "boom") {
		t.Fatalf("the backend's error must reach the counter, got %v", err)
	}

	// raw requests: a body that was changed after signing, no signature, an old timestamp
	url := "http://127.0.0.1:" + strconv.Itoa(main.cfg.HTTPPort) + "/lan/rpc"
	body := []byte(`{"method":"Echo","args":["a"]}`)
	key, _ := parseKey(testKey)
	post := func(from, ts string, signedBody, sentBody []byte) int {
		req, _ := http.NewRequest("POST", url, bytes.NewReader(sentBody))
		req.Header.Set("X-Lan-Id", from)
		req.Header.Set("X-Lan-Ts", ts)
		req.Header.Set("X-Lan-Sig", sign(key, rpcSigParts(from, ts, signedBody)...))
		resp, err := http.DefaultClient.Do(req)
		if err != nil {
			t.Fatal(err)
		}
		resp.Body.Close()
		return resp.StatusCode
	}
	now := strconv.FormatInt(time.Now().Unix(), 10)
	if c := post("someone", now, body, body); c != http.StatusOK {
		t.Fatalf("a correctly signed request must be served, got %d", c)
	}
	if c := post("someone", now, body, []byte(`{"method":"Evil","args":[]}`)); c != http.StatusUnauthorized {
		t.Fatalf("a body changed after signing must be refused, got %d", c)
	}
	old := strconv.FormatInt(time.Now().Add(-time.Hour).Unix(), 10)
	if c := post("someone", old, body, body); c != http.StatusUnauthorized {
		t.Fatalf("an old request must be refused, got %d", c)
	}
	callsBefore := be.calls
	req, _ := http.NewRequest("POST", url, bytes.NewReader(body))
	if resp, err := http.DefaultClient.Do(req); err != nil || resp.StatusCode != http.StatusUnauthorized {
		t.Fatalf("an unsigned request must be refused: %v %v", resp, err)
	}
	if be.calls != callsBefore {
		t.Fatal("a refused request reached the backend")
	}

	// a PC that is not the main PC refuses storage calls
	reqNotMain, _ := http.NewRequest("POST", "http://127.0.0.1:"+strconv.Itoa(counter.cfg.HTTPPort)+"/lan/rpc", bytes.NewReader(body))
	if resp, err := http.DefaultClient.Do(reqNotMain); err != nil || resp.StatusCode != http.StatusConflict {
		t.Fatalf("a PC that is not the main PC must answer 409: %v %v", resp, err)
	}
}

func TestACounterWithAnotherBusinessKeyIsRefusedByTheMainPC(t *testing.T) {
	counter, main, _, _ := pair(t)
	main.SetBackend(&echoBackend{})
	main.SetMain(main.ID())
	agree(t, counter, main, main.ID(), 1)

	if err := counter.SetKey(otherBizKey); err != nil { // the counter now holds another business's key
		t.Fatal(err)
	}
	// it can no longer even verify the main PC's announcements, and its calls are refused
	_, err := counter.Call("Echo")
	if err == nil {
		t.Fatal("a call signed with another business's key must be refused")
	}
}

func TestCounterSaysPlainlyWhenTheMainPCIsGone(t *testing.T) {
	counter, main, _, _ := pair(t)
	main.SetBackend(&echoBackend{})
	counter.SetMain(main.ID())
	agree(t, counter, main, main.ID(), 1)
	if _, err := counter.Call("Echo"); err != nil {
		t.Fatal(err)
	}

	main.Stop()
	_, err := counter.Call("Echo")
	if err == nil || !(strings.Contains(err.Error(), "not reachable") || strings.Contains(err.Error(), "not on the network")) {
		t.Fatalf("the error must say the main PC is unreachable, got %v", err)
	}
	var logged bool
	for _, e := range counter.Log().Entries() {
		logged = logged || (e.Component == "CLIENT" && strings.Contains(e.Message, "NOT reachable"))
	}
	if !logged {
		t.Error("the outage is not in the log")
	}
}

func TestAPCWithoutTheKeyUsesItsOwnData(t *testing.T) {
	a := New(Config{Name: "A", DataDir: t.TempDir(), Instance: "k", HTTPPort: freeTCP(t), DiscoveryPort: freeUDP(t)})
	a.maybeAdopt(1, "0123456789abcdef", "Office", "Office") // as if an announcement of a main PC had been accepted
	if m := a.Mode(); m.Shared || m.HasKey || !strings.Contains(m.Reason, "business key") {
		t.Fatalf("without the key a PC must keep using its own data and say why: %+v", m)
	}
	if err := a.SetKey("not a key"); err == nil {
		t.Fatal("a bad key was accepted")
	}
}

func TestTheKeySurvivesARestartAndIsSealedOnDisk(t *testing.T) {
	dir := t.TempDir()
	xor := func(b []byte) ([]byte, error) { // a stand-in for the Windows user's sealing: unreadable until undone
		out := make([]byte, len(b))
		for i := range b {
			out[i] = b[i] ^ 0x5a
		}
		return out, nil
	}
	seal, unseal := xor, xor
	cfg := Config{Name: "A", DataDir: dir, Instance: "k", HTTPPort: freeTCP(t), DiscoveryPort: freeUDP(t), Seal: seal, Unseal: unseal}
	a := New(cfg)
	if err := a.SetKey(testKey); err != nil {
		t.Fatal(err)
	}
	raw, _ := os.ReadFile(a.keyPath())
	if len(raw) == 0 || strings.Contains(string(raw), testKey) || strings.Contains(string(raw), testKey[:16]) {
		t.Fatal("the key must be sealed on disk, not stored as it is")
	}
	if !New(cfg).HasKey() {
		t.Fatal("a restarted PC forgot the key")
	}
}

func TestAddPeerRejectsBadIP(t *testing.T) {
	a := New(Config{DataDir: t.TempDir(), Instance: "x", HTTPPort: freeTCP(t), DiscoveryPort: freeUDP(t)})
	if res := a.AddPeer("not-an-ip"); res.Status != "error" {
		t.Fatalf("got %+v", res)
	}
}

func TestSelfTestRunsInOrderAndExplainsFailures(t *testing.T) {
	a := New(Config{DataDir: t.TempDir(), Instance: "s", HTTPPort: freeTCP(t), DiscoveryPort: freeUDP(t)})
	a.Start()
	defer a.Stop()
	steps := a.SelfTest("")
	want := []string{"iface", "overlap", "profile", "firewall", "program", "ports", "sent", "heard", "probe"}
	if len(steps) != len(want) {
		t.Fatalf("got %d steps, want %d: %+v", len(steps), len(want), steps)
	}
	for i, s := range steps {
		if s.ID != want[i] {
			t.Errorf("step %d is %q, want %q", i, s.ID, want[i])
		}
		if (s.Status == "fail" || s.Status == "warn") && s.Fix == "" {
			t.Errorf("step %q failed without a fix", s.ID)
		}
	}
	if steps[len(steps)-1].Status != "skip" {
		t.Errorf("with no peer the last step should be skipped, got %q", steps[len(steps)-1].Status)
	}
}
