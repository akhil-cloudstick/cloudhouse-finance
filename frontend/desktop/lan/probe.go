package lan

import (
	"context"
	"encoding/json"
	"errors"
	"io"
	"net"
	"net/http"
	"strconv"
	"strings"
	"time"
)

// pingReply is what GET /lan/ping answers. It carries no business data.
type pingReply struct {
	App     string `json:"app"`
	ID      string `json:"id"`
	Name    string `json:"name"`
	Version string `json:"version"`
	// the main PC choice this PC knows of, so a PC that is only reached by TCP (added by IP) still learns it
	Epoch    int    `json:"epoch"`
	MainID   string `json:"mainId"`
	MainName string `json:"mainName"`
	Sig      string `json:"sig"` // signed with the business key when this PC has it (see key.go)
}

// pingSigParts are the fields a ping reply's signature covers.
func pingSigParts(id string, epoch int, mainID, mainName string) []string {
	return []string{"ping", id, strconv.Itoa(epoch), mainID, mainName}
}

// ProbeResult is the outcome of trying to reach another PC, with the reason in plain words.
type ProbeResult struct {
	IP          string `json:"ip"`
	Port        int    `json:"port"`
	Status      string `json:"status"` // reachable, refused, timeout, unreachable, badreply, error
	LatencyMs   int    `json:"latencyMs"`
	Message     string `json:"message"`
	PeerID      string `json:"peerId"`
	PeerName    string `json:"peerName"`
	PeerVersion string `json:"peerVersion"`
	// the main PC choice the other PC reported (see pingReply)
	PeerEpoch    int    `json:"peerEpoch"`
	PeerMainID   string `json:"peerMainId"`
	PeerMainName string `json:"peerMainName"`
	PeerSig      string `json:"peerSig"`
	// Via is the network card the answer came through, when this PC has more than one that could reach the target.
	Via string `json:"via"`
}

// classify turns a network error into a status and an explanation a shop owner can act on.
func classify(err error) (status, msg string) {
	var ne net.Error
	low := strings.ToLower(err.Error())
	switch {
	case strings.Contains(low, "refused"):
		return "refused", "The PC answered but nothing is listening on the LAN port. The app is not running there, or it uses another port."
	case errors.As(err, &ne) && ne.Timeout():
		return "timeout", "No answer (timed out). The other PC is off or unplugged, or its firewall is dropping the connection (a Public network profile does this). Press Allow network access on the other PC."
	case strings.Contains(low, "unreachable"), strings.Contains(low, "no route"):
		return "unreachable", "There is no network route to that address. It is on a different network, or the cable is unplugged."
	}
	return "error", err.Error()
}

// probeOnce asks the target's LAN port for its ping. With via set, the connection is forced out of that network card;
// without it, Windows picks the card by its own routing, which on two 169.254.x.x networks (a cable plus a VPN adapter
// such as Tailscale) can be the wrong one.
func probeOnce(ip string, port int, timeout time.Duration, via *Iface) ProbeResult {
	res := ProbeResult{IP: ip, Port: port}
	dialer := &net.Dialer{Timeout: timeout}
	if via != nil {
		res.Via = via.Name
		dialer.LocalAddr = &net.TCPAddr{IP: net.ParseIP(via.IP)}
		dialer.Control = controlFor(via.Index)
	}
	client := &http.Client{
		Timeout: timeout,
		Transport: &http.Transport{
			Proxy: nil,
			DialContext: func(ctx context.Context, network, addr string) (net.Conn, error) {
				return dialer.DialContext(ctx, "tcp4", addr)
			},
			DisableKeepAlives: true,
		},
	}
	start := time.Now()
	resp, err := client.Get("http://" + net.JoinHostPort(ip, strconv.Itoa(port)) + "/lan/ping")
	if err != nil {
		res.Status, res.Message = classify(err)
		return res
	}
	defer resp.Body.Close()
	var reply pingReply
	if resp.StatusCode != http.StatusOK || json.NewDecoder(io.LimitReader(resp.Body, 4096)).Decode(&reply) != nil || reply.App != AppTag {
		res.Status = "badreply"
		res.Message = "Something answered on port " + strconv.Itoa(port) + " but it is not this app."
		return res
	}
	res.Status = "reachable"
	res.LatencyMs = int(time.Since(start).Milliseconds())
	res.PeerID, res.PeerName, res.PeerVersion = reply.ID, reply.Name, reply.Version
	res.PeerEpoch, res.PeerMainID, res.PeerMainName, res.PeerSig = reply.Epoch, reply.MainID, reply.MainName, reply.Sig
	res.Message = "Reachable."
	return res
}

// candidateIfaces are this PC's network cards that sit in the same network as the target.
func candidateIfaces(target net.IP, usable []Iface) []Iface {
	var out []Iface
	for _, i := range usable {
		ip, mask := net.ParseIP(i.IP), net.IPMask(net.ParseIP(i.Mask).To4())
		if ip == nil || mask == nil {
			continue
		}
		if (&net.IPNet{IP: ip.Mask(mask), Mask: mask}).Contains(target) {
			out = append(out, i)
		}
	}
	return out
}

// Probe asks another PC's LAN port for its ping. When more than one network card could reach it, every one is tried at
// the same time and the first that answers wins, so a VPN adapter on the same address range cannot hide a working cable.
func Probe(ip string, port int, timeout time.Duration) ProbeResult {
	target := net.ParseIP(ip)
	var cands []Iface
	if target != nil {
		cands = candidateIfaces(target, ScanInterfaces().Usable)
	}
	if len(cands) == 0 {
		return probeOnce(ip, port, timeout, nil)
	}

	results := make(chan ProbeResult, len(cands)+1)
	for i := range cands {
		v := cands[i]
		go func() { results <- probeOnce(ip, port, timeout, &v) }()
	}
	go func() { results <- probeOnce(ip, port, timeout, nil) }() // and the system's own choice

	var failures []ProbeResult
	for n := 0; n < len(cands)+1; n++ {
		r := <-results
		if r.Status == "reachable" {
			return r
		}
		failures = append(failures, r)
	}
	// none answered: report the most informative failure (a refusal means the PC itself is there)
	best := failures[0]
	for _, f := range failures {
		if f.Status == "refused" {
			best = f
			break
		}
	}
	if len(cands) > 1 {
		names := make([]string, len(cands))
		for i, c := range cands {
			names[i] = c.Name
		}
		best.Message += " (Tried through: " + strings.Join(names, ", ") + ".)"
	}
	best.Via = ""
	return best
}

// Attempt is one try of a connection test. Via is the network card it was forced through; "" is the attempt where
// Windows chooses the card itself.
type Attempt struct {
	Via       string `json:"via"`
	Status    string `json:"status"`
	LatencyMs int    `json:"latencyMs"`
	Message   string `json:"message"`
}

// ProbeReport is a connection test with every attempt shown, so a failure can be traced to the card or the firewall.
type ProbeReport struct {
	Result   ProbeResult `json:"result"`
	Attempts []Attempt   `json:"attempts"`
	// WrongCard is true when an attempt forced through one card reached the PC but Windows' own choice did not: another
	// card on the same address range (a VPN adapter such as Tailscale) is being picked, and it goes nowhere.
	WrongCard bool `json:"wrongCard"`
}

// ProbeDetailed runs the same test as Probe but waits for every attempt and reports each one.
func ProbeDetailed(ip string, port int, timeout time.Duration) ProbeReport {
	var cands []Iface
	if target := net.ParseIP(ip); target != nil {
		cands = candidateIfaces(target, ScanInterfaces().Usable)
	}
	results := make([]ProbeResult, len(cands)+1)
	done := make(chan struct{}, len(results))
	for i := range cands {
		go func(i int) {
			v := cands[i]
			results[i] = probeOnce(ip, port, timeout, &v)
			done <- struct{}{}
		}(i)
	}
	go func() {
		results[len(cands)] = probeOnce(ip, port, timeout, nil)
		done <- struct{}{}
	}()
	for range results {
		<-done
	}

	rep := ProbeReport{}
	for _, r := range results {
		rep.Attempts = append(rep.Attempts, Attempt{Via: r.Via, Status: r.Status, LatencyMs: r.LatencyMs, Message: r.Message})
	}
	def := results[len(cands)]
	forcedOK := false
	for _, r := range results[:len(cands)] {
		if r.Status == "reachable" {
			if !forcedOK {
				rep.Result = r
			}
			forcedOK = true
		}
	}
	switch {
	case forcedOK:
		rep.WrongCard = def.Status != "reachable"
	case def.Status == "reachable":
		rep.Result = def
	default:
		rep.Result = def
		for _, r := range results {
			if r.Status == "refused" {
				rep.Result = r
				break
			}
		}
	}
	return rep
}

// splitTarget accepts "192.168.1.5" or "192.168.1.5:9225" and returns the host and port (def when none is given).
func splitTarget(s string, def int) (string, int) {
	s = strings.TrimSpace(s)
	if h, p, err := net.SplitHostPort(s); err == nil {
		if n, err := strconv.Atoi(p); err == nil && n > 0 && n < 65536 {
			return h, n
		}
	}
	return s, def
}
