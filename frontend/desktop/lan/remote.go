package lan

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net"
	"net/http"
	"strconv"
	"time"
)

// The client side of the hub. A PC that is not the main PC (a counter) makes its storage calls to the main PC instead of to
// a file of its own, so every PC sees and changes the same data.

// ModeInfo says where this PC keeps its data.
type ModeInfo struct {
	Shared     bool   `json:"shared"` // this PC uses the main PC's data
	MainID     string `json:"mainId"`
	MainName   string `json:"mainName"`
	MainOnline bool   `json:"mainOnline"`
	HasKey     bool   `json:"hasKey"`
	Reason     string `json:"reason"`
}

// IsMain says whether this PC is the main PC.
func (a *Agent) IsMain() bool {
	a.mu.Lock()
	defer a.mu.Unlock()
	return a.mainID != "" && a.mainID == a.id
}

// Mode describes where this PC keeps its data right now.
func (a *Agent) Mode() ModeInfo {
	a.mu.Lock()
	defer a.mu.Unlock()
	m := ModeInfo{MainID: a.mainID, MainName: a.mainName, HasKey: len(a.key) > 0}
	_, online := a.peers[a.mainID]
	m.MainOnline = a.mainID != "" && (a.mainID == a.id || online)
	switch {
	case a.mainID == "":
		m.Reason = "No main PC has been chosen: this PC uses its own data."
	case a.mainID == a.id:
		m.Reason = "This PC is the main PC: it holds the data every PC uses."
	case len(a.key) == 0:
		m.Reason = "A main PC is chosen, but this PC has no business key yet (sign in online once), so it uses its own data."
	case !online:
		m.Shared = true
		m.Reason = fmt.Sprintf("This PC uses the data on %s, which is not on the network right now.", a.mainName)
	default:
		m.Shared = true
		m.Reason = fmt.Sprintf("This PC uses the data on %s.", a.mainName)
	}
	return m
}

// WaitMainOnline waits until the main PC has been heard on the network, up to d. A PC that has just started needs a few
// seconds to hear it.
func (a *Agent) WaitMainOnline(d time.Duration) bool {
	end := time.Now().Add(d)
	for {
		if a.Mode().MainOnline {
			return true
		}
		if time.Now().After(end) {
			return false
		}
		time.Sleep(200 * time.Millisecond)
	}
}

// target finds the main PC on the network and the key to call it with.
func (a *Agent) target() (id, name, ip string, port int, key []byte, err error) {
	a.mu.Lock()
	defer a.mu.Unlock()
	switch {
	case a.mainID == "" || a.mainID == a.id:
		return "", "", "", 0, nil, errors.New("this PC is not a counter of a main PC")
	case len(a.key) == 0:
		return "", "", "", 0, nil, errors.New("this PC has no business key yet: sign in online once")
	}
	p, ok := a.peers[a.mainID]
	if !ok {
		return "", "", "", 0, nil, fmt.Errorf("the main PC %q is not on the network", a.mainName)
	}
	return a.mainID, p.Name, p.IP, p.Port, a.key, nil
}

// Call runs one storage call on the main PC and returns its result.
func (a *Agent) Call(method string, args ...any) (json.RawMessage, error) {
	_, name, ip, port, key, err := a.target()
	if err != nil {
		return nil, err
	}
	raw := make([]json.RawMessage, len(args))
	for i, v := range args {
		if raw[i], err = json.Marshal(v); err != nil {
			return nil, fmt.Errorf("%s: cannot send argument %d: %w", method, i+1, err)
		}
	}
	body, _ := json.Marshal(rpcRequest{Method: method, Args: raw})
	ts := strconv.FormatInt(time.Now().Unix(), 10)
	req, err := http.NewRequest(http.MethodPost, "http://"+net.JoinHostPort(ip, strconv.Itoa(port))+"/lan/rpc", bytes.NewReader(body))
	if err != nil {
		return nil, err
	}
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("X-Lan-Id", a.id)
	req.Header.Set("X-Lan-Ts", ts)
	req.Header.Set("X-Lan-Sig", sign(key, rpcSigParts(a.id, ts, body)...))

	resp, err := a.rpcClient().Do(req)
	if err != nil {
		_, why := classify(err)
		a.noteHubState(false, name, ip, why)
		return nil, fmt.Errorf("the main PC %q (%s) is not reachable: %s", name, ip, why)
	}
	defer resp.Body.Close()
	data, err := io.ReadAll(io.LimitReader(resp.Body, maxRPCBody))
	if err != nil {
		a.noteHubState(false, name, ip, err.Error())
		return nil, fmt.Errorf("the main PC %q (%s) stopped answering: %v", name, ip, err)
	}
	var reply rpcReply
	if err := json.Unmarshal(data, &reply); err != nil {
		return nil, fmt.Errorf("the main PC %q sent an answer this PC cannot read (HTTP %d)", name, resp.StatusCode)
	}
	a.noteHubState(true, name, ip, "")
	if resp.StatusCode != http.StatusOK || !reply.OK {
		if reply.Error == "" {
			reply.Error = "HTTP " + strconv.Itoa(resp.StatusCode)
		}
		return nil, errors.New(reply.Error)
	}
	return reply.Result, nil
}

// noteHubState logs a change of reachability once, so a long outage is one line and not thousands.
func (a *Agent) noteHubState(ok bool, name, ip, why string) {
	a.mu.Lock()
	prev, had := a.probeState["hub"]
	now := "no"
	if ok {
		now = "yes"
	}
	a.probeState["hub"] = now
	a.mu.Unlock()
	if had && prev == now {
		return
	}
	if ok {
		if had {
			a.log.Log("ok", "CLIENT", "the main PC %q (%s) is reachable again", name, ip)
		} else {
			a.log.Log("ok", "CLIENT", "using the data on the main PC %q (%s)", name, ip)
		}
		return
	}
	a.log.Log("error", "CLIENT", "the main PC %q (%s) is NOT reachable, so nothing can be saved: %s", name, ip, why)
}

// rpcClient is the HTTP client for storage calls: connections are kept open between calls, and a new one is made through
// whichever network card actually reaches the main PC.
func (a *Agent) rpcClient() *http.Client {
	a.mu.Lock()
	defer a.mu.Unlock()
	if a.rpc == nil {
		a.rpc = &http.Client{
			Timeout: 3 * time.Minute,
			Transport: &http.Transport{
				Proxy:               nil,
				DialContext:         a.dialMain,
				MaxIdleConnsPerHost: 4,
				IdleConnTimeout:     60 * time.Second,
			},
		}
	}
	return a.rpc
}

// dialMain opens a connection to the main PC. When several network cards could reach it (a cable plus a VPN adapter on the
// same 169.254.x.x range), each is tried at the same time and the first that connects wins; the card that worked is kept.
func (a *Agent) dialMain(ctx context.Context, network, addr string) (net.Conn, error) {
	host, _, _ := net.SplitHostPort(addr)
	var cands []Iface
	if ip := net.ParseIP(host); ip != nil {
		cands = candidateIfaces(ip, ScanInterfaces().Usable)
	}
	base := net.Dialer{Timeout: 3 * time.Second}
	if len(cands) == 0 {
		return base.DialContext(ctx, "tcp4", addr)
	}
	type result struct {
		c   net.Conn
		via string
		err error
	}
	ch := make(chan result, len(cands)+1)
	try := func(via *Iface) {
		d := base
		name := ""
		if via != nil {
			name = via.Name
			d.LocalAddr = &net.TCPAddr{IP: net.ParseIP(via.IP)}
			d.Control = controlFor(via.Index)
		}
		c, err := d.DialContext(ctx, "tcp4", addr)
		ch <- result{c, name, err}
	}
	for i := range cands {
		v := cands[i]
		go try(&v)
	}
	go try(nil) // and the system's own choice
	var last error
	for n := 0; n < len(cands)+1; n++ {
		r := <-ch
		if r.err == nil {
			a.mu.Lock()
			a.via[host] = r.via
			a.mu.Unlock()
			go func(rest int) { // close the connections that also succeeded
				for i := 0; i < rest; i++ {
					if x := <-ch; x.c != nil {
						x.c.Close()
					}
				}
			}(len(cands) - n)
			return r.c, nil
		}
		last = r.err
	}
	return nil, last
}
