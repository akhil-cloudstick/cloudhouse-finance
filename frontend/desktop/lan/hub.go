package lan

import (
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"io"
	"net"
	"net/http"
	"strconv"
	"time"
)

// The hub. The main PC answers the storage calls the other PCs make to it, from its own offline store, so every PC works
// on one copy of the data. This package only carries the calls: the app supplies the Backend that runs them (it knows the
// store). Nothing is served unless this PC is the main PC, has the business key, and the request is signed with it.

// Backend runs one storage call on this PC's own store and returns its result (any JSON value) or an error.
type Backend interface {
	Call(method string, args []json.RawMessage) (any, error)
}

// SetBackend sets what answers storage calls when this PC is the main PC.
func (a *Agent) SetBackend(b Backend) {
	a.mu.Lock()
	a.backend = b
	a.mu.Unlock()
}

type rpcRequest struct {
	Method string            `json:"method"`
	Args   []json.RawMessage `json:"args"`
}

type rpcReply struct {
	OK     bool            `json:"ok"`
	Result json.RawMessage `json:"result,omitempty"`
	Error  string          `json:"error,omitempty"`
}

const (
	maxRPCBody   = 256 << 20 // a batch of mirrored rows can be large
	rpcClockSkew = 10 * time.Minute
	statEvery    = 30 * time.Second
)

// callStat counts the storage calls one PC made since the last log line about it.
type callStat struct {
	calls, errs int
	since       time.Time
}

func bodyHash(body []byte) string {
	h := sha256.Sum256(body)
	return hex.EncodeToString(h[:])
}

// rpcSigParts are what a storage request's signature covers: who sent it, when, and the exact bytes of the call.
func rpcSigParts(from, ts string, body []byte) []string {
	return []string{"rpc", from, ts, bodyHash(body)}
}

func writeRPC(w http.ResponseWriter, status int, r rpcReply) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	_ = json.NewEncoder(w).Encode(r)
}

func (a *Agent) handleRPC(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		writeRPC(w, http.StatusMethodNotAllowed, rpcReply{Error: "POST only"})
		return
	}
	host, _, _ := net.SplitHostPort(r.RemoteAddr)

	a.mu.Lock()
	key, be, isMain := a.key, a.backend, a.mainID != "" && a.mainID == a.id
	a.mu.Unlock()
	switch {
	case len(key) == 0:
		writeRPC(w, http.StatusServiceUnavailable, rpcReply{Error: "This PC has no business key yet, so it cannot be the main PC. Sign in online once on it."})
		return
	case !isMain:
		writeRPC(w, http.StatusConflict, rpcReply{Error: "This PC is not the main PC (the choice may have just changed)."})
		return
	case be == nil:
		writeRPC(w, http.StatusServiceUnavailable, rpcReply{Error: "The main PC is still starting."})
		return
	}

	body, err := io.ReadAll(http.MaxBytesReader(w, r.Body, maxRPCBody))
	if err != nil {
		writeRPC(w, http.StatusRequestEntityTooLarge, rpcReply{Error: "request too large or cut short"})
		return
	}
	from, ts, sig := r.Header.Get("X-Lan-Id"), r.Header.Get("X-Lan-Ts"), r.Header.Get("X-Lan-Sig")
	when, _ := strconv.ParseInt(ts, 10, 64)
	skew := time.Since(time.Unix(when, 0))
	if skew < 0 {
		skew = -skew
	}
	if from == "" || skew > rpcClockSkew || !verifySig(key, sig, rpcSigParts(from, ts, body)...) {
		a.mu.Lock()
		k := "authfail|" + host
		seen := a.hinted[k]
		a.hinted[k] = true
		a.mu.Unlock()
		if !seen {
			a.log.Log("warn", "HUB", "refused a request from %s: not signed with this business's key, or its clock is more than %d minutes off", host, int(rpcClockSkew.Minutes()))
		}
		writeRPC(w, http.StatusUnauthorized, rpcReply{Error: "The main PC refused this PC: it is not signed with this business's key, or the clocks differ by more than 10 minutes."})
		return
	}

	var req rpcRequest
	if err := json.Unmarshal(body, &req); err != nil || req.Method == "" {
		writeRPC(w, http.StatusBadRequest, rpcReply{Error: "malformed storage call"})
		return
	}
	res, callErr := be.Call(req.Method, req.Args)
	a.countCall(from, req.Method, callErr)
	if callErr != nil {
		writeRPC(w, http.StatusOK, rpcReply{Error: callErr.Error()})
		return
	}
	raw, err := json.Marshal(res)
	if err != nil {
		writeRPC(w, http.StatusOK, rpcReply{Error: "the result could not be encoded: " + err.Error()})
		return
	}
	writeRPC(w, http.StatusOK, rpcReply{OK: true, Result: raw})
}

// countCall keeps the log readable: a refused call is logged at once, the rest as one summary line per PC per half minute.
func (a *Agent) countCall(from, method string, err error) {
	a.mu.Lock()
	st := a.hubStats[from]
	if st == nil {
		st = &callStat{since: time.Now()}
		a.hubStats[from] = st
	}
	st.calls++
	if err != nil {
		st.errs++
	}
	name := from
	if p := a.peers[from]; p != nil {
		name = p.Name
	}
	var summary *callStat
	if time.Since(st.since) >= statEvery {
		c := *st
		summary = &c
		st.calls, st.errs, st.since = 0, 0, time.Now()
	}
	a.mu.Unlock()
	if err != nil {
		a.log.Log("warn", "HUB", "%s: %s failed: %v", name, method, err)
	}
	if summary != nil {
		a.log.Log("info", "HUB", "served %d storage calls for %q in the last %d s (%d failed)", summary.calls, name, int(time.Since(summary.since).Seconds()), summary.errs)
	}
}
