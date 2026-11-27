package main

import (
	"bytes"
	"embed"
	"io/fs"
	"log"
	"net/http"
	"os"
	"path/filepath"
	"regexp"
	"strings"

	"cloudhouse/desktop/update"

	"github.com/wailsapp/wails/v2"
	"github.com/wailsapp/wails/v2/pkg/logger"
	"github.com/wailsapp/wails/v2/pkg/options"
	"github.com/wailsapp/wails/v2/pkg/options/assetserver"
)

//go:embed all:assets
var assets embed.FS

var (
	version   = "0.0.1"
	updateURL = ""
	// Shared (not per-tenant) content-package feed — the bucket's "common" folder.
	contentUpdateURL = ""
	// Overridden per tenant build via -ldflags -X (see scripts/package-win.cjs),
	// which fetches the tenant's own display name before building. Falls back
	// to the platform name for a build that isn't tenant-specific.
	windowTitle = "CloudHouse Finance"
)

var headTag = regexp.MustCompile(`(?i)<head[^>]*>`)

const runtimeTags = `<script src="/wails/runtime.js"></script><script src="/wails/ipc.js"></script>`

// Wails injects its runtime only into / and /index.html; deep links need it too.
func injectRuntime(page []byte) []byte {
	loc := headTag.FindIndex(page)
	if loc == nil {
		return page
	}
	var out bytes.Buffer
	out.Write(page[:loc[1]])
	out.WriteString(runtimeTags)
	out.Write(page[loc[1]:])
	return out.Bytes()
}

// Runs ahead of the file handler: /login is both login.html and a login/ directory.
func pageMiddleware(files fs.FS) assetserver.Middleware {
	return func(next http.Handler) http.Handler {
		return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			page := ""
			if r.Method == http.MethodGet {
				page = pageFor(r.URL.Path)
			}
			body, err := []byte(nil), error(nil)
			if page != "" {
				body, err = fs.ReadFile(files, page)
			}
			if page == "" || err != nil {
				next.ServeHTTP(w, r)
				return
			}
			w.Header().Set("Content-Type", "text/html; charset=utf-8")
			w.Write(injectRuntime(body))
		})
	}
}

// assetOptions prefers an on-disk content package over the embedded one.
func assetOptions() *assetserver.Options {
	// A dev build hands the page to Wails's own dev server, which proxies Next's hot-reload WebSocket.
	if devURL := os.Getenv("DESKTOP_DEV_URL"); devURL != "" {
		os.Setenv("frontenddevserverurl", devURL)
		os.Setenv("devserver", "localhost:34115")
		return &assetserver.Options{Assets: assets}
	}
	if contentDir, err := update.ContentDir(); err == nil {
		if dir, ok := update.ActiveContentAssetsDir(contentDir); ok {
			files := os.DirFS(dir)
			return &assetserver.Options{Assets: files, Middleware: pageMiddleware(files)}
		}
	}
	files, err := fs.Sub(assets, "assets")
	if err != nil {
		log.Fatal(err)
	}
	return &assetserver.Options{Assets: assets, Middleware: pageMiddleware(files)}
}

// The window has no native frame; the page draws its own title bar (DesktopTitleBar.tsx).
const framelessWindow = true

// The window's opening size; a screen smaller than this opens it maximised (App.domReady).
const (
	windowWidth  = 1440
	windowHeight = 900
)

var nonIDChars = regexp.MustCompile(`[^a-z0-9]+`)

// One lock per business, so two different tenants' apps can still run side by side.
// CLOUDHOUSE_INSTANCE lets a second copy run on the same PC for testing the LAN screen.
func instanceID() string {
	id := "cloudhouse-finance-" + nonIDChars.ReplaceAllString(strings.ToLower(windowTitle), "-")
	if inst := strings.ToLower(strings.TrimSpace(os.Getenv("CLOUDHOUSE_INSTANCE"))); inst != "" {
		id += "-" + nonIDChars.ReplaceAllString(inst, "-")
	}
	return id
}

func main() {
	setupCrashLog()
	update.WaitForPreviousInstance(os.Args[1:])
	update.CleanupOld()
	if framelessWindow {
		roundWindowCorners(windowTitle)
	}

	app := NewApp(version, updateURL, contentUpdateURL)
	err := wails.Run(&options.App{
		// Wails' own default (debug) logs every asset request — the
		// [AssetHandler]/[ExternalAssetHandler] lines flooding the terminal
		// during `npm run start`. Errors only, same as the backend's own
		// terminal output.
		LogLevel: logger.ERROR,
		// the web view process dying closes the app; its report goes to webview.log so the cause is not lost
		Logger: logger.NewFileLogger(filepath.Join(crashDir(), "webview.log")),
		// No native right-click menu at all — the app draws its own
		// (DesktopContextMenu.tsx), PIN-gating Inspect every time.
		EnableDefaultContextMenu: false,
		Title:                    windowTitle,
		Width:                    windowWidth,
		Height:                   windowHeight,
		MinWidth:                 960,
		MinHeight:                560,
		Frameless:                framelessWindow,
		AssetServer:              assetOptions(),
		OnStartup:                app.startup,
		OnDomReady:               app.domReady,
		OnShutdown:               app.shutdown,
		SingleInstanceLock: &options.SingleInstanceLock{
			UniqueId:               instanceID(),
			OnSecondInstanceLaunch: app.onSecondInstanceLaunch,
		},
		Bind: []any{app},
	})
	if err != nil {
		log.Fatal(err)
	}
}
