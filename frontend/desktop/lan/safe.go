package lan

import (
	"fmt"
	"runtime/debug"
)

// goSafe runs fn on its own goroutine. A panic in a background goroutine would close the whole app, so it is caught and
// written to the LAN log (and lan.log) with its stack instead.
func (a *Agent) goSafe(name string, fn func()) {
	go func() {
		defer func() {
			if r := recover(); r != nil {
				a.log.Log("error", "PANIC", "%s: %v", name, r)
				a.log.Log("error", "PANIC", "%s", fmt.Sprint(string(debug.Stack())))
			}
		}()
		fn()
	}()
}

// safeGo is goSafe for code that has no agent (the probe helpers); the panic is dropped rather than closing the app.
func safeGo(fn func()) {
	go func() {
		defer func() { _ = recover() }()
		fn()
	}()
}
