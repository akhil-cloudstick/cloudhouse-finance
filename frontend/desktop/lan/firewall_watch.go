package lan

import (
	"os"
	"path/filepath"
	"strings"
	"time"
)

// Rule drift: Windows rules this app relies on can disappear later (a clean-up tool, a policy, a Windows update, or someone
// deleting them). Other PCs then cannot reach this one and nothing says why. The agent looks every few minutes and says so in
// the log and on the Network screen. It never asks for permission by itself: only the button does that.

const (
	driftFirst = 30 * time.Second
	driftEvery = 5 * time.Minute
	// written the first time every rule was seen in place; without it a PC that never needed the rules (Windows let the app
	// through on its own) would raise an alarm for rules that were never added
	driftMarker = "lan-firewall-ok"
)

func (a *Agent) driftMarkerPath() string {
	if a.cfg.DataDir == "" {
		return ""
	}
	name := driftMarker
	if a.cfg.Instance != "" {
		name += "-" + sanitize(a.cfg.Instance)
	}
	return filepath.Join(a.cfg.DataDir, name)
}

// checkDrift runs one check. Returns what changed so the caller (and a test) can see it; the log line is written here.
func (a *Agent) checkDrift() {
	missing, checked := a.fwCheck()
	if !checked {
		return
	}
	marker := a.driftMarkerPath()
	if len(missing) == 0 {
		if marker != "" {
			_ = os.WriteFile(marker, []byte(time.Now().UTC().Format(time.RFC3339)), 0o600)
		}
		if a.clearDrift() {
			a.log.Log("ok", "FIREWALL", "the network access rules are back in place")
		}
		return
	}
	if marker == "" {
		return
	}
	if _, err := os.Stat(marker); err != nil {
		return // the rules were never set up here, so nothing has been lost
	}
	msg := "These Windows Firewall rules were removed: " + strings.Join(missing, ", ") + ". Other PCs may not reach this PC now. Press Allow network access."
	a.mu.Lock()
	changed := a.fwDrift != msg
	a.fwDrift = msg
	a.mu.Unlock()
	if changed {
		a.log.Log("error", "FIREWALL", "%s", msg)
		a.emitPeers()
	}
}

// clearDrift forgets a reported loss; it says whether there was one.
func (a *Agent) clearDrift() bool {
	a.mu.Lock()
	had := a.fwDrift != ""
	a.fwDrift = ""
	a.mu.Unlock()
	return had
}

func (a *Agent) driftLoop() {
	defer a.wg.Done()
	wait := driftFirst
	for {
		select {
		case <-a.stop:
			return
		case <-time.After(wait):
			a.checkDrift()
			wait = driftEvery
		}
	}
}
