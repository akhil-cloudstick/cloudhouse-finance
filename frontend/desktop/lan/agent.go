package lan

import (
	"context"
	"crypto/rand"
	"encoding/hex"
	"encoding/json"
	"net"
	"net/http"
	"os"
	"path/filepath"
	"sort"
	"strconv"
	"strings"
	"sync"
	"time"
)

const (
	DefaultHTTPPort      = 9125
	DefaultDiscoveryPort = 9126

	beaconEvery = 3 * time.Second
	peerExpiry  = 15 * time.Second
	probeEvery  = 5 * time.Second
	probeWait   = 2 * time.Second
)

// Config is what the agent needs to know about this PC and the app.
type Config struct {
	Name          string
	Version       string
	DataDir       string // where lan.log and the PC's LAN id are kept
	Instance      string // set only to run a second copy on one PC for testing
	HTTPPort      int
	DiscoveryPort int
	// ExtraTargets are additional "ip:port" UDP addresses to send beacons to (testing two copies on one PC).
	ExtraTargets []string
	Emit         func(event string, data any)
	// Seal and Unseal protect the saved business key for this Windows user (the app passes localstore's). Nil keeps it
	// as it is, for tests.
	Seal   func([]byte) ([]byte, error)
	Unseal func([]byte) ([]byte, error)
}

// ConfigFromEnv fills what is not set from CLOUDHOUSE_LAN_PORT, CLOUDHOUSE_LAN_DISCOVERY_PORT,
// CLOUDHOUSE_INSTANCE and CLOUDHOUSE_LAN_EXTRA (comma separated ip:port list).
func ConfigFromEnv(c Config) Config {
	if v, err := strconv.Atoi(os.Getenv("CLOUDHOUSE_LAN_PORT")); err == nil && v > 0 {
		c.HTTPPort = v
	}
	if v, err := strconv.Atoi(os.Getenv("CLOUDHOUSE_LAN_DISCOVERY_PORT")); err == nil && v > 0 {
		c.DiscoveryPort = v
	}
	if v := strings.TrimSpace(os.Getenv("CLOUDHOUSE_INSTANCE")); v != "" {
		c.Instance = v
	}
	for _, t := range strings.Split(os.Getenv("CLOUDHOUSE_LAN_EXTRA"), ",") {
		if t = strings.TrimSpace(t); t != "" {
			c.ExtraTargets = append(c.ExtraTargets, t)
		}
	}
	return c
}

// Peer is another PC running the app.
type Peer struct {
	ID        string   `json:"id"`
	Name      string   `json:"name"`
	IP        string   `json:"ip"`
	Port      int      `json:"port"`
	IPs       []string `json:"ips"`
	Version   string   `json:"version"`
	Source    string   `json:"source"`    // beacon or manual
	Reachable string   `json:"reachable"` // unknown, yes, no
	LatencyMs int      `json:"latencyMs"`
	Detail    string   `json:"detail"`
	AgeSec    int      `json:"ageSec"` // seconds since it was last heard
	IsMain    bool     `json:"isMain"` // this is the main PC
	// Verified is true when its announcement is signed with this business's key, so it belongs to the business
	Verified bool `json:"verified"`
}

type peerState struct {
	Peer
	lastBeacon time.Time
	lastOK     time.Time
}

// Status is what the Network screen shows about this PC.
type Status struct {
	ID              string   `json:"id"`
	Name            string   `json:"name"`
	Version         string   `json:"version"`
	Instance        string   `json:"instance"`
	HTTPPort        int      `json:"httpPort"`
	DiscoveryPort   int      `json:"discoveryPort"`
	TCPListening    bool     `json:"tcpListening"`
	TCPError        string   `json:"tcpError"`
	UDPListening    bool     `json:"udpListening"`
	UDPError        string   `json:"udpError"`
	BeaconsSent     int      `json:"beaconsSent"`
	BeaconsReceived int      `json:"beaconsReceived"`
	Interfaces      []Iface  `json:"interfaces"`
	NoAddress       []string `json:"noAddress"`
	Peers           int      `json:"peers"`
	LogPath         string   `json:"logPath"`
	Extra           []string `json:"extraTargets"`
	LastSendErrors  []string `json:"lastSendErrors"`
	// the main PC choice: its version number, id and name; IsMain is true on the main PC itself, and MainOnline says the
	// main PC is this PC or is on the network right now
	Epoch      int    `json:"epoch"`
	MainID     string `json:"mainId"`
	MainName   string `json:"mainName"`
	IsMain     bool   `json:"isMain"`
	MainOnline bool   `json:"mainOnline"`
	// HasKey: this PC has the business key. Shared: this PC uses the main PC's data (a main PC is chosen, it is not this
	// PC, and this PC has the key)
	HasKey bool `json:"hasKey"`
	Shared bool `json:"shared"`
}

// Agent is the LAN part of one running app.
type Agent struct {
	cfg Config
	id  string
	log *Logger

	mu          sync.Mutex
	peers       map[string]*peerState
	manual      map[string]bool // "ip:port" targets added by hand
	ifaceSeen   bool
	ifaceKey    string // last interface set, to log changes only
	noAddrKey   string
	sendErrs    map[string]string
	pingLogged  map[string]time.Time
	probeState  map[string]string // peer id -> last logged reachability
	tcpOK       bool
	tcpErr      string
	udpOK       bool
	udpErr      string
	sent        int
	received    int
	started     time.Time
	lastNoPeers time.Time

	// the main PC choice (see main_pc.go): its version number, id and name
	epoch    int
	mainID   string
	mainName string

	key      []byte               // the business key (see key.go)
	backend  Backend              // what answers storage calls when this PC is the main PC (see hub.go)
	via      map[string]string    // peer ip -> the network card that last reached it, for storage calls (see remote.go)
	hubStats map[string]*callStat // storage calls served, per calling PC, for the log (see hub.go)
	hinted   map[string]bool      // one-time hints already logged
	rpc      *http.Client         // the connection to the main PC (see remote.go)

	udp  *net.UDPConn
	srv  *http.Server
	stop chan struct{}
	wg   sync.WaitGroup
}

// New creates the agent. Call Start to begin.
func New(cfg Config) *Agent {
	if cfg.HTTPPort == 0 {
		cfg.HTTPPort = DefaultHTTPPort
	}
	if cfg.DiscoveryPort == 0 {
		cfg.DiscoveryPort = DefaultDiscoveryPort
	}
	if cfg.Name == "" {
		cfg.Name, _ = os.Hostname()
	}
	if cfg.Name == "" {
		cfg.Name = "this PC"
	}
	if cfg.Instance != "" {
		cfg.Name += " [" + cfg.Instance + "]"
	}
	logName := "lan.log"
	if cfg.Instance != "" {
		logName = "lan-" + sanitize(cfg.Instance) + ".log"
	}
	logPath := ""
	if cfg.DataDir != "" {
		_ = os.MkdirAll(cfg.DataDir, 0o700)
		logPath = filepath.Join(cfg.DataDir, logName)
	}
	a := &Agent{
		cfg:        cfg,
		id:         loadID(cfg.DataDir, cfg.Instance),
		log:        NewLogger(logPath, cfg.Emit),
		peers:      map[string]*peerState{},
		manual:     map[string]bool{},
		sendErrs:   map[string]string{},
		pingLogged: map[string]time.Time{},
		probeState: map[string]string{},
		stop:       make(chan struct{}),
	}
	a.via = map[string]string{}
	a.hubStats = map[string]*callStat{}
	a.hinted = map[string]bool{}
	a.loadMain()
	a.loadKey()
	return a
}

func sanitize(s string) string {
	var b strings.Builder
	for _, r := range s {
		if r >= 'a' && r <= 'z' || r >= 'A' && r <= 'Z' || r >= '0' && r <= '9' || r == '-' || r == '_' {
			b.WriteRune(r)
		}
	}
	return b.String()
}

// loadID returns this PC's stable id, creating it the first time.
func loadID(dir, instance string) string {
	name := "lan-id"
	if instance != "" {
		name += "-" + sanitize(instance)
	}
	if dir != "" {
		if b, err := os.ReadFile(filepath.Join(dir, name)); err == nil {
			if s := strings.TrimSpace(string(b)); len(s) >= 8 {
				return s
			}
		}
	}
	raw := make([]byte, 8)
	_, _ = rand.Read(raw)
	s := hex.EncodeToString(raw)
	if dir != "" {
		_ = os.MkdirAll(dir, 0o700)
		_ = os.WriteFile(filepath.Join(dir, name), []byte(s), 0o600)
	}
	return s
}

func (a *Agent) ID() string { return a.id }

func (a *Agent) Log() *Logger { return a.log }

func (a *Agent) emit(event string, data any) {
	if a.cfg.Emit != nil {
		a.cfg.Emit(event, data)
	}
}

// Start opens the discovery and ping ports and starts the background work. A port that cannot be opened is
// logged with the reason and does not stop the rest.
func (a *Agent) Start() {
	a.started = time.Now()
	a.log.Log("info", "LAN", "starting: name=%q id=%s version=%s ports: TCP %d, UDP %d", a.cfg.Name, a.id, a.cfg.Version, a.cfg.HTTPPort, a.cfg.DiscoveryPort)
	a.startUDP()
	a.startHTTP()
	a.wg.Add(3)
	go a.beaconLoop()
	go a.expireLoop()
	go a.probeLoop()
}

// Stop ends the background work and closes the ports.
func (a *Agent) Stop() {
	select {
	case <-a.stop:
		return
	default:
		close(a.stop)
	}
	if a.udp != nil {
		_ = a.udp.Close()
	}
	if a.srv != nil {
		ctx, cancel := context.WithTimeout(context.Background(), 2*time.Second)
		_ = a.srv.Shutdown(ctx)
		cancel()
	}
	a.wg.Wait()
	a.log.Log("info", "LAN", "stopped")
}

func (a *Agent) startUDP() {
	c, err := net.ListenUDP("udp4", &net.UDPAddr{Port: a.cfg.DiscoveryPort})
	if err != nil {
		a.mu.Lock()
		a.udpErr = "UDP port " + strconv.Itoa(a.cfg.DiscoveryPort) + " could not be opened: " + err.Error() + ". Another copy of the app or another program is using it."
		a.mu.Unlock()
		a.log.Log("error", "BEACON", "%s", a.udpErr)
		return
	}
	a.udp = c
	a.mu.Lock()
	a.udpOK = true
	a.mu.Unlock()
	a.log.Log("ok", "BEACON", "listening for other PCs on UDP %d", a.cfg.DiscoveryPort)
	a.wg.Add(1)
	go a.listenLoop(c)
}

func (a *Agent) startHTTP() {
	ln, err := net.Listen("tcp4", ":"+strconv.Itoa(a.cfg.HTTPPort))
	if err != nil {
		a.mu.Lock()
		a.tcpErr = "TCP port " + strconv.Itoa(a.cfg.HTTPPort) + " could not be opened: " + err.Error() + ". Another copy of the app or another program is using it."
		a.mu.Unlock()
		a.log.Log("error", "PING", "%s", a.tcpErr)
		return
	}
	mux := http.NewServeMux()
	mux.HandleFunc("/lan/ping", a.handlePing)
	mux.HandleFunc("/lan/rpc", a.handleRPC)
	a.srv = &http.Server{Handler: mux, ReadHeaderTimeout: 5 * time.Second}
	a.mu.Lock()
	a.tcpOK = true
	a.mu.Unlock()
	a.log.Log("ok", "PING", "answering connection tests on TCP %d", a.cfg.HTTPPort)
	a.wg.Add(1)
	go func() {
		defer a.wg.Done()
		_ = a.srv.Serve(ln)
	}()
}

func (a *Agent) handlePing(w http.ResponseWriter, r *http.Request) {
	host, _, _ := net.SplitHostPort(r.RemoteAddr)
	a.mu.Lock()
	last := a.pingLogged[host]
	log := time.Since(last) > time.Minute
	if log {
		a.pingLogged[host] = time.Now()
	}
	a.mu.Unlock()
	if log {
		a.log.Log("info", "PING", "connection test from %s", host)
	}
	w.Header().Set("Content-Type", "application/json")
	a.mu.Lock()
	epoch, mainID, mainName, key := a.epoch, a.mainID, a.mainName, a.key
	a.mu.Unlock()
	reply := pingReply{App: AppTag, ID: a.id, Name: a.cfg.Name, Version: a.cfg.Version, Epoch: epoch, MainID: mainID, MainName: mainName}
	if len(key) > 0 {
		reply.Sig = sign(key, pingSigParts(a.id, epoch, mainID, mainName)...)
	}
	_ = json.NewEncoder(w).Encode(reply)
}

func (a *Agent) listenLoop(c *net.UDPConn) {
	defer a.wg.Done()
	buf := make([]byte, 2048)
	for {
		n, src, err := c.ReadFromUDP(buf)
		if err != nil {
			select {
			case <-a.stop:
				return
			default:
			}
			a.log.Log("error", "BEACON", "listening stopped: %v", err)
			return
		}
		b, ok := decodeBeacon(buf[:n])
		if !ok || b.ID == a.id {
			continue
		}
		a.onBeacon(b, src.IP.String())
	}
}

func (a *Agent) onBeacon(b Beacon, srcIP string) {
	a.mu.Lock()
	a.received++
	p, known := a.peers[b.ID]
	if !known {
		p = &peerState{Peer: Peer{ID: b.ID, Source: "beacon", Reachable: "unknown"}}
		a.peers[b.ID] = p
	}
	p.Name, p.IP, p.Port, p.IPs, p.Version = b.Name, srcIP, b.Port, b.IPs, b.Version
	p.lastBeacon = time.Now()
	verified := verifySig(a.key, b.Sig, b.sigParts()...)
	hasKey := len(a.key) > 0
	p.Verified = verified
	a.mu.Unlock()
	if !known {
		a.log.Log("ok", "PEER", "found %q at %s (id %s, version %s)", b.Name, srcIP, b.ID, b.Version)
		a.emitPeers()
	}
	// a main PC announcement is only believed when it is signed with the business key: it decides where every PC's data goes
	if b.Epoch > 0 {
		if verified {
			a.maybeAdopt(b.Epoch, b.MainID, b.MainName, b.Name)
		} else {
			a.noteUntrusted(b.ID, b.Name, hasKey)
		}
	}
}

// noteUntrusted logs, once per PC, why a main PC announcement was not taken.
func (a *Agent) noteUntrusted(id, name string, hasKey bool) {
	a.mu.Lock()
	k := "untrusted|" + id
	seen := a.hinted[k]
	a.hinted[k] = true
	a.mu.Unlock()
	if seen {
		return
	}
	if hasKey {
		a.log.Log("warn", "ELECT", "ignored the main PC announcement from %q: it is not signed with this business's key (an older version of the app, a PC of another business, or a stranger)", name)
	} else {
		a.log.Log("warn", "ELECT", "%q announced a main PC, but this PC has no business key to check it with. Sign in online once on this PC to get the key", name)
	}
}

// adoptFromReply takes the main PC choice from a connection-test reply, when the reply is signed with the business key.
func (a *Agent) adoptFromReply(res ProbeResult) {
	if res.PeerEpoch <= 0 || res.PeerID == "" {
		return
	}
	if !verifySig(a.keyBytes(), res.PeerSig, pingSigParts(res.PeerID, res.PeerEpoch, res.PeerMainID, res.PeerMainName)...) {
		a.noteUntrusted(res.PeerID, res.PeerName, a.HasKey())
		return
	}
	a.maybeAdopt(res.PeerEpoch, res.PeerMainID, res.PeerMainName, res.PeerName)
}

func (a *Agent) emitPeers() { a.emit("lan:peers", a.Peers()) }

// Peers lists the other PCs seen so far, in name order.
func (a *Agent) Peers() []Peer {
	a.mu.Lock()
	defer a.mu.Unlock()
	out := make([]Peer, 0, len(a.peers))
	for _, p := range a.peers {
		c := p.Peer
		c.IsMain = a.mainID != "" && c.ID == a.mainID
		last := p.lastBeacon
		if p.lastOK.After(last) {
			last = p.lastOK
		}
		c.AgeSec = int(time.Since(last).Seconds())
		out = append(out, c)
	}
	sort.Slice(out, func(i, j int) bool { return strings.ToLower(out[i].Name) < strings.ToLower(out[j].Name) })
	return out
}

func (a *Agent) beaconLoop() {
	defer a.wg.Done()
	a.sendBeacons()
	t := time.NewTicker(beaconEvery)
	defer t.Stop()
	for {
		select {
		case <-a.stop:
			return
		case <-t.C:
			a.sendBeacons()
		}
	}
}

func (a *Agent) sendBeacons() {
	rep := ScanInterfaces()
	a.logInterfaceChanges(rep)

	ips := make([]string, 0, len(rep.Usable))
	for _, i := range rep.Usable {
		ips = append(ips, i.IP)
	}
	a.mu.Lock()
	epoch, mainID, mainName, key := a.epoch, a.mainID, a.mainName, a.key
	a.mu.Unlock()
	data := encodeBeacon(Beacon{ID: a.id, Name: a.cfg.Name, IPs: ips, Port: a.cfg.HTTPPort, Version: a.cfg.Version, Epoch: epoch, MainID: mainID, MainName: mainName}, key)

	// a route whose network card or address has gone away must not keep reporting its old error
	valid := map[string]bool{}
	for _, i := range rep.Usable {
		for _, dest := range []string{i.Broadcast, "255.255.255.255"} {
			valid[routeKey(i, dest)] = true
		}
	}
	a.pruneSendErrs(valid)

	send := func(key string, local net.IP, remote *net.UDPAddr, label string) {
		err := sendUDP(local, remote, data)
		a.mu.Lock()
		prev, had := a.sendErrs[key]
		if err != nil {
			a.sendErrs[key] = err.Error()
		} else {
			delete(a.sendErrs, key)
			a.sent++
		}
		a.mu.Unlock()
		switch {
		case err != nil && (!had || prev != err.Error()):
			if strings.Contains(err.Error(), "not valid in its context") {
				// a new address (such as 169.254.x.x on a cable) is not usable for a few seconds while Windows checks it
				a.log.Log("info", "BEACON", "%s is not ready yet (Windows is still checking the new address); retrying", label)
			} else {
				a.log.Log("error", "BEACON", "could not send on %s: %v", label, err)
			}
		case err == nil && had:
			a.log.Log("ok", "BEACON", "sending works again on %s", label)
		case err == nil && !had && a.firstSend(key):
			a.log.Log("ok", "BEACON", "sending on %s", label)
		}
	}

	for _, i := range rep.Usable {
		ip := net.ParseIP(i.IP)
		for _, dest := range []string{i.Broadcast, "255.255.255.255"} {
			d := net.ParseIP(dest)
			send(routeKey(i, dest), ip, &net.UDPAddr{IP: d, Port: a.cfg.DiscoveryPort},
				i.Name+" ("+i.IP+") to "+dest+":"+strconv.Itoa(a.cfg.DiscoveryPort))
		}
	}
	for _, t := range a.cfg.ExtraTargets {
		if addr, err := net.ResolveUDPAddr("udp4", t); err == nil {
			send("extra|"+t, nil, addr, "extra target "+t)
		} else {
			a.log.Log("error", "BEACON", "extra target %q is not a valid ip:port", t)
		}
	}
	a.maybeHintNoPeers(rep)
}

// routeKey names one way of sending: a network card address and a destination.
func routeKey(i Iface, dest string) string { return i.Name + "|" + i.IP + "|" + dest }

// pruneSendErrs forgets the send state of routes that no longer exist (the card was unplugged or its address changed),
// so the self-test never reports an old error, and "sending on ..." is logged again when the route returns.
func (a *Agent) pruneSendErrs(valid map[string]bool) {
	a.mu.Lock()
	defer a.mu.Unlock()
	for k := range a.sendErrs {
		route := strings.TrimPrefix(k, "seen|")
		if strings.HasPrefix(route, "extra|") || valid[route] {
			continue
		}
		delete(a.sendErrs, k)
	}
}

// firstSend is true the first time a key is seen, so "sending on ..." is logged once per route.
func (a *Agent) firstSend(key string) bool {
	a.mu.Lock()
	defer a.mu.Unlock()
	k := "seen|" + key
	if _, ok := a.sendErrs[k]; ok {
		return false
	}
	a.sendErrs[k] = ""
	return true
}

func (a *Agent) logInterfaceChanges(rep IfaceReport) {
	var parts []string
	for _, i := range rep.Usable {
		parts = append(parts, i.Name+" "+i.IP)
	}
	sort.Strings(parts)
	key := strings.Join(parts, ", ")
	na := append([]string(nil), rep.NoAddress...)
	sort.Strings(na)
	naKey := strings.Join(na, ", ")

	a.mu.Lock()
	first := !a.ifaceSeen
	changed := key != a.ifaceKey
	naChanged := naKey != a.noAddrKey
	a.ifaceSeen = true
	a.ifaceKey, a.noAddrKey = key, naKey
	a.mu.Unlock()

	if changed || first {
		if key == "" {
			a.log.Log("warn", "NET", "no usable network address on this PC. Check the cable or Wi-Fi.")
		} else {
			for _, i := range rep.Usable {
				note := ""
				if i.LinkLocal {
					note = " (169.254.x.x: the address Windows gives itself on a direct cable)"
				}
				a.log.Log("info", "NET", "address %s on %s, mask %s%s", i.IP, i.Name, i.Mask, note)
			}
			if ov := overlappingLinkLocal(rep.Usable); ov != nil {
				a.log.Log("warn", "NET", "%s all use 169.254.x.x addresses. Windows can send a connection out of the wrong one. The app tries each of them, but switching off the one that is not the cable (for example Tailscale or Wi-Fi) removes the confusion.", strings.Join(ov, ", "))
			}
		}
	}
	if naChanged && naKey != "" {
		a.log.Log("warn", "NET", "%s connected but has no IPv4 address yet. On a direct cable Windows assigns a 169.254.x.x address after about 30 to 60 seconds; waiting.", naKey)
	}
}

// maybeHintNoPeers explains, at most once a minute, why nobody has been heard.
func (a *Agent) maybeHintNoPeers(rep IfaceReport) {
	a.mu.Lock()
	defer a.mu.Unlock()
	if len(a.peers) > 0 || time.Since(a.started) < peerExpiry || time.Since(a.lastNoPeers) < time.Minute {
		return
	}
	a.lastNoPeers = time.Now()
	if len(rep.Usable) == 0 {
		return // the NET line already explains it
	}
	a.log.Log("warn", "PEER", "no other PC heard yet. Check: the cable is plugged in on both PCs, the app is open on the other PC, and Windows is not blocking incoming connections (press Allow network access). Run the self-test for details.")
}

func (a *Agent) expireLoop() {
	defer a.wg.Done()
	t := time.NewTicker(time.Second)
	defer t.Stop()
	for {
		select {
		case <-a.stop:
			return
		case <-t.C:
			a.expire()
		}
	}
}

func (a *Agent) expire() {
	var lost []Peer
	a.mu.Lock()
	mainID := a.mainID
	for id, p := range a.peers {
		last := p.lastBeacon
		if p.lastOK.After(last) {
			last = p.lastOK
		}
		if time.Since(last) > peerExpiry {
			lost = append(lost, p.Peer)
			delete(a.peers, id)
			delete(a.probeState, id)
		}
	}
	a.mu.Unlock()
	for _, p := range lost {
		a.log.Log("warn", "PEER", "lost %q (%s): nothing heard for %d s. The cable was unplugged, the app was closed on that PC, or its firewall blocks us.", p.Name, p.IP, int(peerExpiry.Seconds()))
		if mainID != "" && p.ID == mainID {
			a.log.Log("error", "ELECT", "the MAIN PC %q is not on the network: other PCs cannot use it until it is back", p.Name)
		}
	}
	if len(lost) > 0 {
		a.emitPeers()
	}
}

func (a *Agent) probeLoop() {
	defer a.wg.Done()
	t := time.NewTicker(probeEvery)
	defer t.Stop()
	for {
		select {
		case <-a.stop:
			return
		case <-t.C:
			a.probeAll()
		}
	}
}

func (a *Agent) probeAll() {
	type target struct {
		id, ip string
		port   int
	}
	var targets []target
	a.mu.Lock()
	for id, p := range a.peers {
		targets = append(targets, target{id, p.IP, p.Port})
	}
	manual := make([]string, 0, len(a.manual))
	for m := range a.manual {
		manual = append(manual, m)
	}
	a.mu.Unlock()

	var wg sync.WaitGroup
	for _, t := range targets {
		wg.Add(1)
		go func(t target) {
			defer wg.Done()
			res := Probe(t.ip, t.port, probeWait)
			a.applyProbe(t.id, res, false)
			if res.Status == "reachable" {
				a.adoptFromReply(res)
			}
		}(t)
	}
	for _, m := range manual {
		wg.Add(1)
		go func(m string) {
			defer wg.Done()
			host, port := splitTarget(m, a.cfg.HTTPPort)
			res := Probe(host, port, probeWait)
			if res.Status == "reachable" && res.PeerID != "" && res.PeerID != a.id {
				a.upsertManual(res)
				a.adoptFromReply(res)
			}
		}(m)
	}
	wg.Wait()
}

// upsertManual keeps a PC added by IP in the list while it answers.
func (a *Agent) upsertManual(res ProbeResult) {
	a.mu.Lock()
	p, known := a.peers[res.PeerID]
	if !known {
		p = &peerState{Peer: Peer{ID: res.PeerID, Source: "manual", Reachable: "unknown"}}
		a.peers[res.PeerID] = p
	}
	p.Name, p.IP, p.Port, p.Version = res.PeerName, res.IP, res.Port, res.PeerVersion
	p.lastOK = time.Now()
	a.mu.Unlock()
	if !known {
		a.log.Log("ok", "PEER", "added %q at %s:%d by IP", res.PeerName, res.IP, res.Port)
	}
	a.applyProbe(res.PeerID, res, !known)
}

// applyProbe stores a probe result on the peer and logs only when the reachability changes.
func (a *Agent) applyProbe(id string, res ProbeResult, changed bool) {
	a.mu.Lock()
	p, ok := a.peers[id]
	if !ok {
		a.mu.Unlock()
		return
	}
	state := "no"
	if res.Status == "reachable" {
		state = "yes"
		p.lastOK = time.Now()
	}
	prev := a.probeState[id]
	a.probeState[id] = state
	p.Reachable, p.LatencyMs, p.Detail = state, res.LatencyMs, res.Message
	name, ip := p.Name, p.IP
	a.mu.Unlock()

	if prev != state {
		changed = true
		if state == "yes" {
			via := ""
			if res.Via != "" {
				via = ", through " + res.Via
			}
			a.log.Log("ok", "PEER", "%q (%s) is reachable, %d ms%s", name, ip, res.LatencyMs, via)
		} else {
			a.log.Log("warn", "PEER", "%q (%s) is NOT reachable: %s", name, ip, res.Message)
		}
	}
	if changed {
		a.emitPeers()
	}
}

// TestPeer runs a connection test now and logs the result. target is "ip" or "ip:port".
func (a *Agent) TestPeer(target string) ProbeResult {
	host, port := splitTarget(target, a.cfg.HTTPPort)
	a.log.Log("info", "PEER", "testing connection to %s:%d", host, port)
	rep := ProbeDetailed(host, port, 3*time.Second)
	res := rep.Result
	a.logAttempts(host, port, rep)
	if res.Status == "reachable" {
		via := ""
		if res.Via != "" {
			via = ", through " + res.Via
		}
		a.log.Log("ok", "PEER", "%s:%d is reachable: %q, %d ms%s", host, port, res.PeerName, res.LatencyMs, via)
		if res.PeerID != "" && res.PeerID != a.id {
			a.mu.Lock()
			_, known := a.peers[res.PeerID]
			a.mu.Unlock()
			if known {
				a.applyProbe(res.PeerID, res, false)
			}
		}
	} else {
		a.log.Log("error", "PEER", "%s:%d is not reachable (%s): %s", host, port, res.Status, res.Message)
	}
	return res
}

// logAttempts writes what each network card did in a connection test, so a failure can be pinned on the card, the
// other PC's firewall or the cable instead of guessed.
func (a *Agent) logAttempts(host string, port int, rep ProbeReport) {
	if len(rep.Attempts) < 2 && !rep.WrongCard {
		return
	}
	for _, at := range rep.Attempts {
		who := "Windows' own choice of card"
		if at.Via != "" {
			who = "through " + at.Via
		}
		if at.Status == "reachable" {
			a.log.Log("ok", "PEER", "  %s:%d %s: reachable, %d ms", host, port, who, at.LatencyMs)
		} else {
			a.log.Log("info", "PEER", "  %s:%d %s: %s", host, port, who, at.Status)
		}
	}
	if rep.WrongCard {
		a.log.Log("warn", "PEER", "Windows' own routing cannot reach %s but sending through %s works: Windows is choosing the wrong network card because another card (such as Tailscale or Wi-Fi) shares this address range. The app now sends through the right card itself; switching the other card off also removes the confusion.", host, rep.Result.Via)
	}
}

// AddPeer adds a PC by its IP address (for a network where broadcasts are blocked) and tests it.
func (a *Agent) AddPeer(target string) ProbeResult {
	host, port := splitTarget(target, a.cfg.HTTPPort)
	ip := net.ParseIP(host)
	if ip == nil || ip.To4() == nil {
		res := ProbeResult{IP: host, Port: port, Status: "error", Message: "That is not a valid IPv4 address, for example 192.168.1.20."}
		a.log.Log("error", "PEER", "cannot add %q: %s", target, res.Message)
		return res
	}
	a.log.Log("info", "PEER", "adding %s:%d by IP", host, port)
	res := Probe(host, port, 3*time.Second)
	if res.Status != "reachable" {
		a.log.Log("error", "PEER", "%s:%d is not reachable (%s): %s", host, port, res.Status, res.Message)
		return res
	}
	if res.PeerID == a.id {
		res.Status, res.Message = "error", "That is this PC."
		a.log.Log("warn", "PEER", "%s is this PC, not adding it", host)
		return res
	}
	a.mu.Lock()
	a.manual[net.JoinHostPort(host, strconv.Itoa(port))] = true
	a.mu.Unlock()
	a.upsertManual(res)
	return res
}

// Status describes this PC for the screen.
func (a *Agent) Status() Status {
	rep := ScanInterfaces()
	a.mu.Lock()
	defer a.mu.Unlock()
	var errs []string
	for k, v := range a.sendErrs {
		if v != "" && !strings.HasPrefix(k, "seen|") {
			errs = append(errs, k+": "+v)
		}
	}
	sort.Strings(errs)
	return Status{
		ID: a.id, Name: a.cfg.Name, Version: a.cfg.Version, Instance: a.cfg.Instance,
		HTTPPort: a.cfg.HTTPPort, DiscoveryPort: a.cfg.DiscoveryPort,
		TCPListening: a.tcpOK, TCPError: a.tcpErr, UDPListening: a.udpOK, UDPError: a.udpErr,
		BeaconsSent: a.sent, BeaconsReceived: a.received,
		Interfaces: rep.Usable, NoAddress: rep.NoAddress, Peers: len(a.peers),
		LogPath: a.log.Path(), Extra: a.cfg.ExtraTargets, LastSendErrors: errs,
		Epoch: a.epoch, MainID: a.mainID, MainName: a.mainName,
		IsMain:     a.mainID != "" && a.mainID == a.id,
		MainOnline: a.mainID != "" && (a.mainID == a.id || a.peers[a.mainID] != nil),
		HasKey:     len(a.key) > 0,
		Shared:     a.mainID != "" && a.mainID != a.id && len(a.key) > 0,
	}
}
