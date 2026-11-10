package main

import (
	"encoding/json"
	"errors"
	"fmt"
	"sync"
	"time"

	"cloudhouse/backend/localapi"
	"cloudhouse/desktop/lan"
)

// Shared data. When a main PC has been chosen and this PC is not it, this PC does not keep the business data in a file of
// its own: every storage call goes to the main PC over the local network (desktop/lan), which runs it on its own offline
// store. The page does not know the difference: it still calls the same App.Store* methods, and routedStore below sends each
// one to this PC's own store or to the main PC. Only what belongs to this PC itself stays here: its log, the folder it
// chose, and the identity files (the device key and the saved sign-ins).
//
// Where the data lives is decided once, when the store is opened after sign-in, and kept until it is opened again. The LAN
// agent says when that decision may have changed (a main PC was chosen or removed, the key arrived) and the page then opens
// the store again.

// sharedState is what StoreOpen decided for this PC.
type sharedState struct {
	mu       sync.Mutex
	shared   bool             // storage calls go to the main PC
	mainID   string           // the main PC they go to
	sess     localapi.Session // the signed-in user on this PC, for reads the main PC answers
	sessSet  bool
	business string // the business and device the store was opened for (on the main PC: also what its hub serves)
	device   string
}

func (a *App) isShared() bool {
	a.sh.mu.Lock()
	defer a.sh.mu.Unlock()
	return a.sh.shared
}

// localOnlyFile is true for the files that identify this PC and are never kept on or served by the main PC.
func localOnlyFile(name string) bool { return name == "device.json" || name == "users.json" }

// ensureOpen opens this PC's own store for the business, unless it is already open for it (the hub may have opened it
// for a counter before anyone signed in here).
func (a *App) ensureOpen(business, device string) error {
	a.sh.mu.Lock()
	defer a.sh.mu.Unlock()
	if _, err := a.store.DBPath(); err == nil && a.sh.business == business && a.sh.device == device {
		return nil
	}
	if _, err := a.store.DBPath(); err == nil && a.sh.business != "" && a.sh.business != business && a.lan.IsMain() {
		return fmt.Errorf("this PC is the main PC and is working on another business (%s)", a.sh.business)
	}
	localapi.Close() // the database file may be a different one now
	if err := a.store.Open(business, device); err != nil {
		return err
	}
	a.sh.business, a.sh.device = business, device
	return nil
}

// openStore decides where this PC keeps its data and opens it. See the comment at the top of the file.
func (a *App) openStore(business, device string) error {
	m := a.lan.Mode()
	if m.Shared && !m.MainOnline {
		// a PC that has just started needs a few seconds to hear the main PC
		a.lan.WaitMainOnline(8 * time.Second)
		m = a.lan.Mode()
	}
	if !m.Shared {
		a.sh.mu.Lock()
		a.sh.shared, a.sh.mainID = false, ""
		a.sh.mu.Unlock()
		return a.ensureOpen(business, device)
	}
	if !m.MainOnline {
		return fmt.Errorf("the main PC (%s) is not reachable, so this PC cannot use its data. Check that the main PC is on, its cable is plugged in, and the app is open on it", m.MainName)
	}
	// this PC's own small store still keeps its identity files and its log; the business data is on the main PC
	localapi.Close()
	if err := a.store.Open(business, device); err != nil {
		return err
	}
	if _, err := a.lan.Call("Open", business, device); err != nil {
		return err
	}
	a.sh.mu.Lock()
	a.sh.shared, a.sh.mainID = true, m.MainID
	a.sh.business, a.sh.device = business, device
	a.sh.mu.Unlock()
	return nil
}

// LanDataMode says where this PC's data is right now (what StoreOpen decided).
type LanDataMode struct {
	Shared      bool         `json:"shared"`      // the data this PC is using right now is on the main PC
	MainID      string       `json:"mainId"`      // ... this main PC
	NeedRestart bool         `json:"needRestart"` // the main PC choice changed since the store was opened
	Live        lan.ModeInfo `json:"live"`        // what the choice is now
}

// LanDataMode tells the page where the data is and whether the store must be opened again.
func (a *App) LanDataMode() LanDataMode {
	live := a.lan.Mode()
	a.sh.mu.Lock()
	shared, mainID := a.sh.shared, a.sh.mainID
	a.sh.mu.Unlock()
	need := live.Shared != shared || (live.Shared && live.MainID != mainID)
	return LanDataMode{Shared: shared, MainID: mainID, NeedRestart: need, Live: live}
}

// LanSetKey stores the business key the server gave this PC at sign-in.
func (a *App) LanSetKey(key string) error { return a.lan.SetKey(key) }

// ---------------------------------------------------------------------------------------------------------------------
// The page's storage calls, sent to this PC's own store or to the main PC.

type routedStore struct{ a *App }

func (a *App) data() routedStore { return routedStore{a} }

// rcall makes a storage call on the main PC and ignores any result.
func rcall(a *App, method string, args ...any) error {
	_, err := a.lan.Call(method, args...)
	return err
}

// rcallInto makes a storage call on the main PC and decodes its result.
func rcallInto[T any](a *App, method string, args ...any) (T, error) {
	var out T
	raw, err := a.lan.Call(method, args...)
	if err != nil {
		return out, err
	}
	if len(raw) > 0 && string(raw) != "null" {
		if err := json.Unmarshal(raw, &out); err != nil {
			return out, fmt.Errorf("%s: the main PC's answer could not be read: %w", method, err)
		}
	}
	return out, nil
}

func (r routedStore) AppendOutbox(line string) error {
	if r.a.isShared() {
		return rcall(r.a, "AppendOutbox", line)
	}
	return r.a.store.AppendOutbox(line)
}

func (r routedStore) ReadOutbox() ([]string, error) {
	if r.a.isShared() {
		return rcallInto[[]string](r.a, "ReadOutbox")
	}
	return r.a.store.ReadOutbox()
}

func (r routedStore) ReadAllOutbox() ([]string, error) {
	if r.a.isShared() {
		return rcallInto[[]string](r.a, "ReadAllOutbox")
	}
	return r.a.store.ReadAllOutbox()
}

func (r routedStore) DeleteOutboxEntry(id string) error {
	if r.a.isShared() {
		return rcall(r.a, "DeleteOutboxEntry", id)
	}
	return r.a.store.DeleteOutboxEntry(id)
}

func (r routedStore) Counts() (map[string]int, error) {
	if r.a.isShared() {
		return rcallInto[map[string]int](r.a, "Counts")
	}
	return r.a.store.Counts()
}

func (r routedStore) SaveEntry(line string, files map[string]string) error {
	if r.a.isShared() {
		return rcall(r.a, "SaveEntry", line, files)
	}
	return r.a.store.SaveEntry(line, files)
}

func (r routedStore) ChangeEntry(id, line string, files map[string]string) error {
	if r.a.isShared() {
		return rcall(r.a, "ChangeEntry", id, line, files)
	}
	return r.a.store.ChangeEntry(id, line, files)
}

func (r routedStore) MarkReview(id, message string) error {
	if r.a.isShared() {
		return rcall(r.a, "MarkReview", id, message)
	}
	return r.a.store.MarkReview(id, message)
}

func (r routedStore) ReadReview() ([]string, error) {
	if r.a.isShared() {
		return rcallInto[[]string](r.a, "ReadReview")
	}
	return r.a.store.ReadReview()
}

func (r routedStore) RetryReview(id string) error {
	if r.a.isShared() {
		return rcall(r.a, "RetryReview", id)
	}
	return r.a.store.RetryReview(id)
}

func (r routedStore) ReadFile(name string) (string, error) {
	if r.a.isShared() && !localOnlyFile(name) {
		return rcallInto[string](r.a, "ReadFile", name)
	}
	return r.a.store.ReadFile(name)
}

func (r routedStore) WriteFile(name, content string) error {
	if r.a.isShared() && !localOnlyFile(name) {
		return rcall(r.a, "WriteFile", name, content)
	}
	return r.a.store.WriteFile(name, content)
}

func (r routedStore) MirrorApply(batch string) error {
	if r.a.isShared() {
		return rcall(r.a, "MirrorApply", batch)
	}
	return r.a.store.MirrorApply(batch)
}

func (r routedStore) MirrorBindTenant(tenant int64) error {
	if r.a.isShared() {
		return rcall(r.a, "MirrorBindTenant", tenant)
	}
	return r.a.store.MirrorBindTenant(tenant)
}

func (r routedStore) MirrorWriteTemp(entryID, batch string) error {
	if r.a.isShared() {
		return rcall(r.a, "MirrorWriteTemp", entryID, batch)
	}
	return r.a.store.MirrorWriteTemp(entryID, batch)
}

func (r routedStore) MirrorDropTemp(entryID string) error {
	if r.a.isShared() {
		return rcall(r.a, "MirrorDropTemp", entryID)
	}
	return r.a.store.MirrorDropTemp(entryID)
}

func (r routedStore) MirrorState(key string) (string, error) {
	if r.a.isShared() {
		return rcallInto[string](r.a, "MirrorState", key)
	}
	return r.a.store.MirrorState(key)
}

func (r routedStore) MirrorIDs(table string) ([]int64, error) {
	if r.a.isShared() {
		return rcallInto[[]int64](r.a, "MirrorIDs", table)
	}
	return r.a.store.MirrorIDs(table)
}

func (r routedStore) MirrorCounts() (map[string]int, error) {
	if r.a.isShared() {
		return rcallInto[map[string]int](r.a, "MirrorCounts")
	}
	return r.a.store.MirrorCounts()
}

// ---------------------------------------------------------------------------------------------------------------------
// The local read server (backend/localapi): on a counter it is the main PC that answers, as the counter's user.

func unavailable(msg string) string {
	b, _ := json.Marshal(map[string]any{"success": false, "error": msg})
	return string(b)
}

// bindShared remembers who is signed in on this counter, to send with each read.
func (a *App) bindShared(sess localapi.Session) error {
	if sess.TenantID == 0 || sess.EmployeeID == 0 || sess.RoleID == 0 {
		return errors.New("the saved session is incomplete")
	}
	a.sh.mu.Lock()
	a.sh.sess, a.sh.sessSet = sess, true
	a.sh.mu.Unlock()
	return nil
}

func (a *App) sharedSession() (localapi.Session, bool) {
	a.sh.mu.Lock()
	defer a.sh.mu.Unlock()
	return a.sh.sess, a.sh.sessSet
}

func (a *App) sharedGet(path, query string, headers map[string]string) localapi.Response {
	sess, ok := a.sharedSession()
	if !ok {
		return localapi.Response{Status: 401, Body: unavailable("no saved session on this PC")}
	}
	res, err := rcallInto[localapi.Response](a, "LocalApiGet", sess, path, query, headers)
	if err != nil {
		return localapi.Response{Status: 503, Body: unavailable(err.Error())}
	}
	return res
}

func (a *App) sharedGetPending(path, query string, headers map[string]string, pendingJSON string) localapi.PendingResponse {
	sess, ok := a.sharedSession()
	if !ok {
		return localapi.PendingResponse{Status: 401, Body: unavailable("no saved session on this PC")}
	}
	res, err := rcallInto[localapi.PendingResponse](a, "LocalApiGetPending", sess, path, query, headers, pendingJSON)
	if err != nil {
		return localapi.PendingResponse{Status: 503, Body: unavailable(err.Error())}
	}
	return res
}

// ---------------------------------------------------------------------------------------------------------------------
// The main PC's side: what the counters' storage calls run.

// hubBackend runs a counter's storage call on this PC's own store (the lan package carries it here).
type hubBackend struct{ a *App }

// argv reads the arguments of a storage call, remembering the first problem.
type argv struct {
	args []json.RawMessage
	err  error
}

func (v *argv) get(i int, into any) {
	if v.err != nil {
		return
	}
	if i >= len(v.args) {
		v.err = fmt.Errorf("missing argument %d", i+1)
		return
	}
	if err := json.Unmarshal(v.args[i], into); err != nil {
		v.err = fmt.Errorf("argument %d: %w", i+1, err)
	}
}

func (v *argv) str(i int) string {
	var s string
	v.get(i, &s)
	return s
}

func (v *argv) files(i int) map[string]string {
	var m map[string]string
	v.get(i, &m)
	return m
}

func (h hubBackend) Call(method string, args []json.RawMessage) (any, error) {
	res, err := h.run(method, args)
	if err == nil {
		switch method {
		case "AppendOutbox", "SaveEntry", "ChangeEntry", "RetryReview":
			// a counter put something in the outbox here: this main PC's page can start sending it at once
			h.a.lan.Notify("lan:entries", nil)
		}
	}
	return res, err
}

func (h hubBackend) run(method string, args []json.RawMessage) (any, error) {
	a, v := h.a, &argv{args: args}
	switch method {
	case "Open":
		business, device := v.str(0), v.str(1)
		if v.err != nil {
			return nil, v.err
		}
		return nil, a.ensureOpen(business, device)
	case "AppendOutbox":
		line := v.str(0)
		if v.err != nil {
			return nil, v.err
		}
		return nil, a.store.AppendOutbox(line)
	case "ReadOutbox":
		return a.store.ReadOutbox()
	case "ReadAllOutbox":
		return a.store.ReadAllOutbox()
	case "DeleteOutboxEntry":
		id := v.str(0)
		if v.err != nil {
			return nil, v.err
		}
		return nil, a.store.DeleteOutboxEntry(id)
	case "Counts":
		return a.store.Counts()
	case "SaveEntry":
		line, files := v.str(0), v.files(1)
		if v.err != nil {
			return nil, v.err
		}
		return nil, a.store.SaveEntry(line, files)
	case "ChangeEntry":
		id, line, files := v.str(0), v.str(1), v.files(2)
		if v.err != nil {
			return nil, v.err
		}
		return nil, a.store.ChangeEntry(id, line, files)
	case "MarkReview":
		id, msg := v.str(0), v.str(1)
		if v.err != nil {
			return nil, v.err
		}
		return nil, a.store.MarkReview(id, msg)
	case "ReadReview":
		return a.store.ReadReview()
	case "RetryReview":
		id := v.str(0)
		if v.err != nil {
			return nil, v.err
		}
		return nil, a.store.RetryReview(id)
	case "ReadFile":
		name := v.str(0)
		if v.err != nil {
			return nil, v.err
		}
		if localOnlyFile(name) {
			return nil, errors.New("that file belongs to the PC that wrote it and is not kept on the main PC")
		}
		return a.store.ReadFile(name)
	case "WriteFile":
		name, content := v.str(0), v.str(1)
		if v.err != nil {
			return nil, v.err
		}
		if localOnlyFile(name) {
			return nil, errors.New("that file belongs to the PC that wrote it and is not kept on the main PC")
		}
		return nil, a.store.WriteFile(name, content)
	case "MirrorApply":
		batch := v.str(0)
		if v.err != nil {
			return nil, v.err
		}
		return nil, a.store.MirrorApply(batch)
	case "MirrorBindTenant":
		var tenant int64
		v.get(0, &tenant)
		if v.err != nil {
			return nil, v.err
		}
		return nil, a.store.MirrorBindTenant(tenant)
	case "MirrorWriteTemp":
		id, batch := v.str(0), v.str(1)
		if v.err != nil {
			return nil, v.err
		}
		return nil, a.store.MirrorWriteTemp(id, batch)
	case "MirrorDropTemp":
		id := v.str(0)
		if v.err != nil {
			return nil, v.err
		}
		return nil, a.store.MirrorDropTemp(id)
	case "MirrorState":
		key := v.str(0)
		if v.err != nil {
			return nil, v.err
		}
		return a.store.MirrorState(key)
	case "MirrorIDs":
		table := v.str(0)
		if v.err != nil {
			return nil, v.err
		}
		return a.store.MirrorIDs(table)
	case "MirrorCounts":
		return a.store.MirrorCounts()
	case "LocalApiGet":
		var sess localapi.Session
		v.get(0, &sess)
		path, query := v.str(1), v.str(2)
		var headers map[string]string
		v.get(3, &headers)
		if v.err != nil {
			return nil, v.err
		}
		srv, err := a.localServer()
		if err != nil {
			return localapi.Response{Status: 503, Body: unavailable(err.Error())}, nil
		}
		return srv.HandleAs(sess, "GET", path, query, headers), nil
	case "LocalApiGetPending":
		var sess localapi.Session
		v.get(0, &sess)
		path, query := v.str(1), v.str(2)
		var headers map[string]string
		v.get(3, &headers)
		pending := v.str(4)
		if v.err != nil {
			return nil, v.err
		}
		srv, err := a.localServer()
		if err != nil {
			return localapi.PendingResponse{Status: 503, Body: unavailable(err.Error())}, nil
		}
		return srv.GetWithPendingAs(sess, path, query, headers, pending), nil
	}
	return nil, fmt.Errorf("unknown storage call %q", method)
}

// localServer is this PC's local read server on its own store.
func (a *App) localServer() (*localapi.Server, error) {
	p, err := a.store.DBPath()
	if err != nil {
		return nil, errors.New("the main PC's store is not open yet")
	}
	return localapi.Open(p)
}
