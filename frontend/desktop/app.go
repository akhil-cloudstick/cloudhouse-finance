package main

import (
	"context"
	"encoding/json"
	"os"
	"path/filepath"

	"cloudhouse/backend/localapi"
	"cloudhouse/desktop/lan"
	"cloudhouse/desktop/localstore"
	"cloudhouse/desktop/update"

	"github.com/wailsapp/wails/v2/pkg/options"
	"github.com/wailsapp/wails/v2/pkg/runtime"
)

type App struct {
	ctx            context.Context
	version        string
	updater        *update.Updater
	contentUpdater *update.ContentUpdater
	store          *localstore.Store
	lan            *lan.Agent
	sh             sharedState // where this PC keeps the business data: its own store, or the main PC's (see shared.go)
}

func NewApp(version, updateURL, contentUpdateURL string) *App {
	a := &App{version: version}
	emit := func(event string, data any) {
		if a.ctx != nil {
			runtime.EventsEmit(a.ctx, event, data)
		}
	}
	a.updater = update.New(version, updateURL, func(event string, data any) { emit("update:"+event, data) })
	contentDir, err := update.ContentDir()
	if err != nil {
		contentDir = "content"
	}
	a.contentUpdater = update.NewContent(contentUpdateURL, contentDir, emit)
	storeRoot, err := localstore.DefaultRoot()
	if err != nil {
		storeRoot = "offline"
	}
	// the LAN agent keeps its log and PC id beside the storage config, outside the offline store, so it works
	// before anyone signs in
	lanDir := filepath.Join(os.TempDir(), "CloudhouseFinance")
	if cfg, err := localstore.DefaultConfigPath(); err == nil {
		a.store = localstore.NewWithConfig(storeRoot, cfg)
		lanDir = filepath.Dir(cfg)
	} else {
		a.store = localstore.New(storeRoot)
	}
	a.lan = lan.New(lan.ConfigFromEnv(lan.Config{Version: version, DataDir: lanDir, Emit: emit, Seal: localstore.Seal, Unseal: localstore.Unseal}))
	a.lan.SetBackend(hubBackend{a}) // what answers the other PCs' storage calls while this PC is the main PC
	return a
}

func (a *App) startup(ctx context.Context) {
	a.ctx = ctx
	a.lan.Start()
}

func (a *App) shutdown(ctx context.Context) {
	a.lan.Stop()
	markCleanExit()
}

// Opening the app again brings the already-running window to the front instead of a second window.
func (a *App) onSecondInstanceLaunch(options.SecondInstanceData) {
	if a.ctx == nil {
		return
	}
	runtime.WindowUnminimise(a.ctx)
	runtime.WindowShow(a.ctx)
	runtime.WindowSetAlwaysOnTop(a.ctx, true)
	runtime.WindowSetAlwaysOnTop(a.ctx, false)
}

// ActiveContentVersion is "" when still on the embedded (built-in) web content.
func (a *App) ActiveContentVersion() string {
	return a.contentUpdater.ActiveVersion()
}

func (a *App) CheckContentUpdate() error {
	return a.contentUpdater.Check(a.ctx)
}

func (a *App) DownloadContentUpdate() error {
	return a.contentUpdater.Download(a.ctx)
}

// ApplyContentUpdate activates the downloaded content; Apply already relaunches before this quits.
func (a *App) ApplyContentUpdate() error {
	if err := a.contentUpdater.Apply(); err != nil {
		return err
	}
	runtime.Quit(a.ctx)
	return nil
}

func (a *App) Version() string {
	return a.version
}

func (a *App) Frameless() bool {
	return framelessWindow
}

func (a *App) CheckUpdate() error {
	return a.updater.Check(a.ctx)
}

func (a *App) DownloadUpdate() error {
	return a.updater.Download(a.ctx)
}

func (a *App) InstallUpdate() error {
	if err := a.updater.Install(); err != nil {
		return err
	}
	runtime.Quit(a.ctx)
	return nil
}

// OpenDevTools opens DevTools immediately. Called only after the frontend
// has already confirmed the PIN with the backend — see PinModal.tsx.
func (a *App) OpenDevTools() {
	runtime.EventsEmit(a.ctx, "cloudhouse:enable-devtools")
}

// The methods below are the offline store. The page decides what goes in a file; Go only keeps it safe on
// disk (flushed appends, whole-file swaps, protected secrets) and refuses any name outside the allow-list.

// StoreOpen selects the folder for this business and PC. Call it once after sign-in. When a main PC has been chosen and
// this PC is not it, the business data is the main PC's, not a file here (see shared.go).
func (a *App) StoreOpen(business, device string) error {
	return a.openStore(business, device)
}

// LocalApiBind tells the local read server who is signed in (the session saved at sign-in), so it can answer the app's
// reads from this PC's copy when the server cannot be reached. sessionJSON is {tenantId, employeeId, roleId, role, branchId, isSystem}.
func (a *App) LocalApiBind(sessionJSON string) error {
	var sess localapi.Session
	if err := json.Unmarshal([]byte(sessionJSON), &sess); err != nil {
		return err
	}
	if a.isShared() {
		return a.bindShared(sess) // the main PC answers, as this user
	}
	path, err := a.store.DBPath()
	if err != nil {
		return err
	}
	srv, err := localapi.Open(path)
	if err != nil {
		return err
	}
	return srv.Bind(sess)
}

// LocalApiGet answers one read request from this PC's copy. path is the route after /api/v1.
func (a *App) LocalApiGet(path, query string, headers map[string]string) localapi.Response {
	if a.isShared() {
		return a.sharedGet(path, query, headers)
	}
	p, err := a.store.DBPath()
	if err != nil {
		return localapi.Response{Status: 503, Body: `{"success":false,"error":"the offline store is not open"}`}
	}
	srv, err := localapi.Open(p)
	if err != nil {
		return localapi.Response{Status: 503, Body: `{"success":false,"error":"the local copy is not available"}`}
	}
	return srv.Handle("GET", path, query, headers)
}

// LocalApiGetPending answers one read from this PC's copy as it will look once the changes still waiting to be sent have
// reached the server (see backend/localapi/replay.go). pendingJSON is [{method, path, body}], oldest first; skipped says how many
// of them could not be run, and when it is not zero the answer should not be trusted.
func (a *App) LocalApiGetPending(path, query string, headers map[string]string, pendingJSON string) localapi.PendingResponse {
	if a.isShared() {
		return a.sharedGetPending(path, query, headers, pendingJSON)
	}
	p, err := a.store.DBPath()
	if err != nil {
		return localapi.PendingResponse{Status: 503, Body: `{"success":false,"error":"the offline store is not open"}`}
	}
	srv, err := localapi.Open(p)
	if err != nil {
		return localapi.PendingResponse{Status: 503, Body: `{"success":false,"error":"the local copy is not available"}`}
	}
	return srv.GetWithPending(path, query, headers, pendingJSON)
}

// StoreAppendOutbox adds one entry line and flushes it to disk before returning.
func (a *App) StoreAppendOutbox(line string) error { return a.data().AppendOutbox(line) }

// StoreReadOutbox returns every waiting entry line, oldest first.
func (a *App) StoreReadOutbox() ([]string, error) { return a.data().ReadOutbox() }

// StoreDeleteOutboxEntry removes the entry with this id once the server has confirmed it.
func (a *App) StoreDeleteOutboxEntry(id string) error { return a.data().DeleteOutboxEntry(id) }

// StoreReadFile returns a data file (cursor.json, data/loans.json, ...), or "" when it is new.
func (a *App) StoreReadFile(name string) (string, error) { return a.data().ReadFile(name) }

// StoreWriteFile replaces a data file in one step.
func (a *App) StoreWriteFile(name, content string) error { return a.data().WriteFile(name, content) }

// StoreLog appends one line to today's support log.
func (a *App) StoreLog(level, message string) error { return a.store.AppendLog(level, message) }

// StoreRoot is the folder the offline data is kept in.
func (a *App) StoreRoot() string { return a.store.Root() }

// StoreRootChosen is false until the user has picked a folder or accepted the default.
func (a *App) StoreRootChosen() bool { return a.store.RootChosen() }

// StoreChooseFolder opens the folder picker and moves the offline data to the folder picked (existing data is
// copied, the old folder is left in place). It returns the new store folder, or "" when the picker was cancelled.
func (a *App) StoreChooseFolder() (string, error) {
	start := filepath.Dir(filepath.Dir(a.store.Root())) // the folder that holds "CloudhouseFinance"
	dir, err := runtime.OpenDirectoryDialog(a.ctx, runtime.OpenDialogOptions{
		Title:                "Choose where this PC keeps offline data",
		DefaultDirectory:     start,
		CanCreateDirectories: true,
	})
	if err != nil {
		return "", err
	}
	if dir == "" {
		return "", nil
	}
	if err := a.store.SetRoot(dir); err != nil {
		return "", err
	}
	return a.store.Root(), nil
}

// StoreMirrorApply writes a batch of server rows, deletions and cursors into the mirror tables in one transaction.
func (a *App) StoreMirrorApply(batch string) error { return a.data().MirrorApply(batch) }

// StoreMirrorBindTenant says which business the mirror holds; data of any other business is cleared first.
func (a *App) StoreMirrorBindTenant(tenant int64) error { return a.data().MirrorBindTenant(tenant) }

// StoreMirrorWriteTemp puts the rows an offline change made into the mirror under temporary ids, tied to its queued entry.
func (a *App) StoreMirrorWriteTemp(entryID, batch string) error {
	return a.data().MirrorWriteTemp(entryID, batch)
}

// StoreMirrorDropTemp removes the temporary rows a queued entry made, once it has been sent.
func (a *App) StoreMirrorDropTemp(entryID string) error { return a.data().MirrorDropTemp(entryID) }

// StoreMirrorState returns a value kept beside the mirror tables ("" when there is none).
func (a *App) StoreMirrorState(key string) (string, error) { return a.data().MirrorState(key) }

// StoreMirrorIDs returns the primary keys a mirror table holds.
func (a *App) StoreMirrorIDs(table string) ([]int64, error) { return a.data().MirrorIDs(table) }

// StoreMirrorCounts returns how many rows each mirror table holds.
func (a *App) StoreMirrorCounts() (map[string]int, error) { return a.data().MirrorCounts() }

// StoreUseDefaultFolder records that the default folder is fine.
func (a *App) StoreUseDefaultFolder() error { return a.store.UseDefault() }

// StoreSaveEntry adds one entry to the outbox and replaces the given data files in one transaction, so the local
// copy and the queued entry always agree.
func (a *App) StoreSaveEntry(line string, files map[string]string) error {
	return a.data().SaveEntry(line, files)
}

// StoreReadAllOutbox returns every entry the server has not confirmed, including those in review.
func (a *App) StoreReadAllOutbox() ([]string, error) { return a.data().ReadAllOutbox() }

// StoreOutboxCounts is how many entries wait to be sent ("pending") and how many wait for an admin ("review").
func (a *App) StoreOutboxCounts() (map[string]int, error) { return a.data().Counts() }

// StoreMarkReview moves an entry the server refused to the admin's review list, with the server's reason.
func (a *App) StoreMarkReview(id, message string) error { return a.data().MarkReview(id, message) }

// StoreReadReview returns the entries waiting for an admin, each as one JSON object.
func (a *App) StoreReadReview() ([]string, error) { return a.data().ReadReview() }

// StoreRetryReview puts a reviewed entry back in the send queue.
func (a *App) StoreRetryReview(id string) error { return a.data().RetryReview(id) }

// StoreChangeEntry changes (or, with an empty line, removes) an entry that has not been sent yet, together with the
// data files that depend on it, in one transaction.
func (a *App) StoreChangeEntry(id, line string, files map[string]string) error {
	return a.data().ChangeEntry(id, line, files)
}

// The methods below are the LAN agent (desktop/lan): finding other PCs on the network and testing the connection.
// Phase 0 touches no business data.

// LanStatus describes this PC on the network: addresses, ports, and what has been sent and heard.
func (a *App) LanStatus() lan.Status { return a.lan.Status() }

// LanPeers lists the other PCs found so far.
func (a *App) LanPeers() []lan.Peer { return a.lan.Peers() }

// LanLog returns the log lines held in memory, oldest first.
func (a *App) LanLog() []lan.Entry { return a.lan.Log().Entries() }

// LanClearLog empties the on-screen log (the file keeps its history).
func (a *App) LanClearLog() { a.lan.Log().Clear() }

// LanSelfTest checks every step the connection depends on. peer is "ip" or "ip:port", or empty for the first PC found.
func (a *App) LanSelfTest(peer string) []lan.Step { return a.lan.SelfTest(peer) }

// LanTestPeer tries to reach one PC and explains the result.
func (a *App) LanTestPeer(target string) lan.ProbeResult { return a.lan.TestPeer(target) }

// LanAddPeer adds a PC by its IP address, for a network where broadcasts do not get through.
func (a *App) LanAddPeer(target string) lan.ProbeResult { return a.lan.AddPeer(target) }

// LanSetMain chooses a PC (by id; this one or one on the network now) as the main PC. The choice spreads to every PC.
func (a *App) LanSetMain(id string) lan.MainResult { return a.lan.SetMain(id) }

// LanClearMain removes the main PC choice on every PC.
func (a *App) LanClearMain() lan.MainResult { return a.lan.ClearMain() }

// LanAllowAccess adds the Windows Firewall rules this PC needs (one Windows permission prompt).
func (a *App) LanAllowAccess() lan.AllowResult { return a.lan.AllowAccess() }
