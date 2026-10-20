package main

import (
	"context"
	"path/filepath"

	"cloudhouse/desktop/localstore"
	"cloudhouse/desktop/update"

	"github.com/wailsapp/wails/v2/pkg/runtime"
)

type App struct {
	ctx            context.Context
	version        string
	updater        *update.Updater
	contentUpdater *update.ContentUpdater
	store          *localstore.Store
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
	if cfg, err := localstore.DefaultConfigPath(); err == nil {
		a.store = localstore.NewWithConfig(storeRoot, cfg)
	} else {
		a.store = localstore.New(storeRoot)
	}
	return a
}

func (a *App) startup(ctx context.Context) {
	a.ctx = ctx
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

// StoreOpen selects the folder for this business and PC. Call it once after sign-in.
func (a *App) StoreOpen(business, device string) error { return a.store.Open(business, device) }

// StoreAppendOutbox adds one entry line and flushes it to disk before returning.
func (a *App) StoreAppendOutbox(line string) error { return a.store.AppendOutbox(line) }

// StoreReadOutbox returns every waiting entry line, oldest first.
func (a *App) StoreReadOutbox() ([]string, error) { return a.store.ReadOutbox() }

// StoreDeleteOutboxEntry removes the entry with this id once the server has confirmed it.
func (a *App) StoreDeleteOutboxEntry(id string) error { return a.store.DeleteOutboxEntry(id) }

// StoreReadFile returns a data file (cursor.json, data/loans.json, ...), or "" when it is new.
func (a *App) StoreReadFile(name string) (string, error) { return a.store.ReadFile(name) }

// StoreWriteFile replaces a data file in one step.
func (a *App) StoreWriteFile(name, content string) error { return a.store.WriteFile(name, content) }

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

// StoreUseDefaultFolder records that the default folder is fine.
func (a *App) StoreUseDefaultFolder() error { return a.store.UseDefault() }
