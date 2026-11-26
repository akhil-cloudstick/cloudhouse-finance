package main

import (
	"fmt"
	"os"
	"path/filepath"
	"runtime/debug"
	"time"

	"cloudhouse/desktop/localstore"
)

// The app used to close with nothing left behind. This keeps three records beside lan.log, so the next close says why:
//   crash.log   what Go printed when it died (fatal errors such as a stack overflow, and any panic that was not caught),
//   webview.log what the web view reported (its browser process dying makes the app exit),
//   run.log     one line when the app starts and one when it closes normally; a start with no matching close
//               means the previous run ended abruptly.

func crashDir() string {
	if cfg, err := localstore.DefaultConfigPath(); err == nil {
		return filepath.Dir(cfg)
	}
	return filepath.Join(os.TempDir(), "CloudhouseFinance")
}

var runMarker string

// setupCrashLog starts the records. It never stops the app from starting.
func setupCrashLog() {
	defer func() { _ = recover() }()
	dir := crashDir()
	if err := os.MkdirAll(dir, 0o700); err != nil {
		return
	}
	runMarker = filepath.Join(dir, "run.log")
	if b, err := os.ReadFile(runMarker); err == nil && len(b) > 0 {
		// the marker is removed on a normal close, so finding it means the last run did not close normally
		appendLine(filepath.Join(dir, "crash.log"), "previous run ended without a normal close (started "+string(b)+")")
	}
	_ = os.WriteFile(runMarker, []byte(time.Now().Format(time.RFC3339)), 0o600)

	if f, err := os.OpenFile(filepath.Join(dir, "crash.log"), os.O_CREATE|os.O_APPEND|os.O_WRONLY, 0o600); err == nil {
		fmt.Fprintf(f, "\n=== run started %s ===\n", time.Now().Format(time.RFC3339))
		// Go copies its own fatal-error report (stack overflow, concurrent map use, out of memory, uncaught panic) here
		_ = debug.SetCrashOutput(f, debug.CrashOptions{})
	}
}

// markCleanExit is called when the app closes the normal way.
func markCleanExit() {
	if runMarker != "" {
		_ = os.Remove(runMarker)
	}
}

func appendLine(path, line string) {
	f, err := os.OpenFile(path, os.O_CREATE|os.O_APPEND|os.O_WRONLY, 0o600)
	if err != nil {
		return
	}
	defer f.Close()
	fmt.Fprintf(f, "%s %s\n", time.Now().Format(time.RFC3339), line)
}

// guardGo runs fn on its own goroutine and keeps a panic in it from closing the whole app: the panic and its stack are
// written to crash.log instead.
func guardGo(name string, fn func()) {
	go func() {
		defer func() {
			if r := recover(); r != nil {
				appendLine(filepath.Join(crashDir(), "crash.log"), fmt.Sprintf("panic in %s: %v\n%s", name, r, debug.Stack()))
			}
		}()
		fn()
	}()
}
