package localapi

// Replay: what a read shows while changes made on this PC are still waiting to be sent.
//
// A change made offline (an edited ledger entry, a payment, a scheme edit) is held in the outbox until the server can be
// reached, so the copy of the business on this PC does not have it yet. To show the screen what the server will show once
// the change is sent, the waiting changes are run through the backend's own route handlers, in the order they were made,
// inside one database transaction on the copy; the read is answered inside that same transaction, and the transaction is
// then rolled back. Nothing is ever written to the copy: the server's own rows replace it when the change is sent. Because
// the real handlers do the work, interest, balances and totals come out exactly as the server works them out.

import (
	"bytes"
	"crypto/rand"
	"database/sql"
	"encoding/hex"
	"encoding/json"
	"io"
	"log"
	"net/http"
	"net/http/httptest"
	"regexp"
	"strings"
	"time"

	"cloudhouse/backend/config"

	"gorm.io/gorm"
	"gorm.io/gorm/logger"
)

// Pending is one change waiting in the outbox: the path is the one the app uses ("/loans/5/payments/12"), without the user.
type Pending struct {
	Method string `json:"method"`
	Path   string `json:"path"`
	Body   string `json:"body"`
}

const replayHeader = "X-Local-Replay"

var (
	reLoanID = regexp.MustCompile(`/loans/(\d+)(/|$|\?)`)
	// a change to something this PC made and the server has not numbered yet cannot be run against the copy
	reUnresolved = regexp.MustCompile(`/(ref:|uuid:|-\d)|local-photo:`)
)

func newToken() string {
	b := make([]byte, 16)
	_, _ = rand.Read(b)
	return hex.EncodeToString(b)
}

var reSchemeRead = regexp.MustCompile(`/schemes(/|$|\?)`)

// related says whether a waiting change is run before this read. A read of one loan is answered with that loan's waiting
// changes (and only those). Schemes are answered with the scheme changes. Every other read is answered from the copy as it is:
// those screens add the waiting changes themselves (see the offline code of the app), and replaying changes this function does
// not vouch for could make a read fail that works today.
func related(readPath, entryPath string) bool {
	if m := reLoanID.FindStringSubmatch(readPath); m != nil {
		e := reLoanID.FindStringSubmatch(entryPath)
		return e != nil && e[1] == m[1]
	}
	if reSchemeRead.MatchString(readPath) {
		return strings.HasPrefix(entryPath, "/schemes")
	}
	return false
}

// writable opens the second connection replays use. The read connection is opened query-only so nothing can write through it.
func (s *Server) writable() (*gorm.DB, error) {
	if s.wdb != nil {
		return s.wdb, nil
	}
	raw, err := sql.Open("sqlite", "file:"+strings.ReplaceAll(s.path, "\\", "/")+"?_pragma=busy_timeout(10000)&_pragma=foreign_keys(0)")
	if err != nil {
		return nil, err
	}
	raw.SetMaxOpenConns(1)
	db, err := gorm.Open(dialector{conn: &pool{db: raw}}, &gorm.Config{Logger: logger.Default.LogMode(logger.Silent), SkipDefaultTransaction: true})
	if err != nil {
		_ = raw.Close()
		return nil, err
	}
	if err := config.RegisterTenantScope(db); err != nil {
		_ = raw.Close()
		return nil, err
	}
	s.wraw, s.wdb = raw, db
	return db, nil
}

// HandleWithPending answers a read as it will look once the waiting changes are sent. Skipped counts waiting changes the copy
// could not run (a server error of ours, or a record the copy does not hold); when it is not zero the answer is not reliable
// and the caller should use what it showed before. A change the server would refuse is left out of the answer, as there.
func (s *Server) HandleWithPending(method, path, query string, headers map[string]string, pending []Pending) (Response, int) {
	var todo []Pending
	for _, p := range pending {
		if p.Method == http.MethodGet || p.Method == "" || reUnresolved.MatchString(p.Path) || reUnresolved.MatchString(p.Body) {
			continue
		}
		if related(path, p.Path) {
			todo = append(todo, p)
		}
	}
	if len(todo) == 0 {
		return s.Handle(method, path, query, headers), 0
	}
	s.mu.RLock()
	sess := s.sess
	s.mu.RUnlock()
	if sess.EmployeeID == 0 {
		return Response{Status: http.StatusUnauthorized, Body: `{"success":false,"error":"no saved session on this PC"}`}, 0
	}

	key := method + " " + path + "?" + query + "|" + headers["X-Branch-Id"] + "|" + pendingKey(todo)
	s.gate.Lock()
	defer s.gate.Unlock()
	if hit, ok := s.memo[key]; ok && time.Since(hit.at) < memoFor {
		return hit.resp, hit.skipped
	}
	resp, skipped := s.replay(method, path, query, headers, todo, sess)
	if s.memo == nil || len(s.memo) > 64 {
		s.memo = map[string]memoEntry{}
	}
	s.memo[key] = memoEntry{at: time.Now(), resp: resp, skipped: skipped}
	return resp, skipped
}

const memoFor = 2 * time.Second

type memoEntry struct {
	at      time.Time
	resp    Response
	skipped int
}

func pendingKey(todo []Pending) string {
	var b strings.Builder
	for _, p := range todo {
		b.WriteString(p.Method + " " + p.Path + " " + p.Body + "\n")
	}
	return b.String()
}

// replay runs the waiting changes and then the read in one transaction that is always rolled back. The caller holds the gate.
func (s *Server) replay(method, path, query string, headers map[string]string, todo []Pending, sess Session) (Response, int) {
	wdb, err := s.writable()
	if err != nil {
		return Response{Status: http.StatusServiceUnavailable, Body: `{"success":false,"error":"the local copy cannot be opened for changes"}`}, len(todo)
	}
	tx := wdb.Begin()
	if tx.Error != nil {
		return Response{Status: http.StatusServiceUnavailable, Body: `{"success":false,"error":"the local copy is busy"}`}, len(todo)
	}
	// every handler reaches the database through these two, so for this one request they point at the open transaction
	prevBase, prevDB := config.BaseDB, config.DB
	config.BaseDB, config.DB = tx, config.NewConnPinner(tx)
	defer func() {
		config.BaseDB, config.DB = prevBase, prevDB
		tx.Rollback()
	}()

	skipped := 0
	base := "/api/v1/users/" + itoa(sess.EmployeeID)
	for _, p := range todo {
		rec := s.serve(p.Method, base+p.Path, strings.NewReader(p.Body), headers, true)
		// A refusal (400, 409, 422...) is what the server will say too, so that change changes nothing there and the answer
		// is right without it. What cannot be trusted is a change the copy could not run: an error of ours, or a record the
		// copy does not hold.
		if rec.Code >= 400 {
			log.Printf("local replay: %s %s was refused (%d): %.300s", p.Method, p.Path, rec.Code, rec.Body.String())
		}
		if rec.Code >= 500 || rec.Code == http.StatusNotFound {
			skipped++
		}
	}
	target := "/api/v1" + path
	if query != "" {
		target += "?" + strings.TrimPrefix(query, "?")
	}
	rec := s.serve(method, target, bytes.NewReader(nil), headers, false)
	return Response{Status: rec.Code, Body: rec.Body.String()}, skipped
}

// serve runs one request through the route handlers. Only a replay may carry the header that lifts the read-only rule; the
// header is a secret of this server, and a caller's headers other than the three named here are never copied.
func (s *Server) serve(method, target string, body io.Reader, headers map[string]string, replay bool) *httptest.ResponseRecorder {
	req := httptest.NewRequest(method, target, body)
	for k, v := range headers {
		switch strings.ToLower(k) {
		case "x-branch-id", "accept", "accept-language":
			req.Header.Set(k, v)
		}
	}
	if replay {
		req.Header.Set(replayHeader, s.token)
		req.Header.Set("Content-Type", "application/json")
	}
	rec := httptest.NewRecorder()
	s.echo.ServeHTTP(rec, req)
	return rec
}

func itoa(n uint) string {
	if n == 0 {
		return "0"
	}
	var b [20]byte
	i := len(b)
	for n > 0 {
		i--
		b[i] = byte('0' + n%10)
		n /= 10
	}
	return string(b[i:])
}

// PendingResponse is an answer with the number of waiting changes that could not be run before it.
type PendingResponse struct {
	Status  int    `json:"status"`
	Body    string `json:"body"`
	Skipped int    `json:"skipped"`
}

// GetWithPending is HandleWithPending for the app: the waiting changes arrive as JSON, [{method, path, body}].
func (s *Server) GetWithPending(path, query string, headers map[string]string, pendingJSON string) PendingResponse {
	var pending []Pending
	if pendingJSON != "" {
		if err := json.Unmarshal([]byte(pendingJSON), &pending); err != nil {
			pending = nil
		}
	}
	r, skipped := s.HandleWithPending(http.MethodGet, path, query, headers, pending)
	return PendingResponse{Status: r.Status, Body: r.Body, Skipped: skipped}
}
