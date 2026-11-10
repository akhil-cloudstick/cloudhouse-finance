package lan

import (
	"encoding/json"
	"os"
	"path/filepath"
	"strings"
)

// The main PC is chosen by an admin on any PC. The choice is a PC id plus a version number (epoch) that goes up with
// every change. Every PC announces the choice it knows, and a PC that hears a higher version adopts it, so within a few
// seconds all PCs agree. If two admins choose at the same moment the versions are equal and the lower id wins on every
// PC, so they still agree. Phase A only records and spreads the choice: it does not move any data.

// MainResult is the outcome of choosing (or clearing) the main PC.
type MainResult struct {
	OK       bool   `json:"ok"`
	Message  string `json:"message"`
	Epoch    int    `json:"epoch"`
	MainID   string `json:"mainId"`
	MainName string `json:"mainName"`
}

type mainFile struct {
	Epoch    int    `json:"epoch"`
	MainID   string `json:"mainId"`
	MainName string `json:"mainName"`
}

func (a *Agent) mainPath() string {
	if a.cfg.DataDir == "" {
		return ""
	}
	name := "lan-main.json"
	if a.cfg.Instance != "" {
		name = "lan-main-" + sanitize(a.cfg.Instance) + ".json"
	}
	return filepath.Join(a.cfg.DataDir, name)
}

// loadMain restores the choice this PC knew before it was closed.
func (a *Agent) loadMain() {
	p := a.mainPath()
	if p == "" {
		return
	}
	b, err := os.ReadFile(p)
	if err != nil {
		return
	}
	var f mainFile
	if json.Unmarshal(b, &f) != nil || f.Epoch < 0 {
		return
	}
	a.epoch, a.mainID, a.mainName = f.Epoch, f.MainID, f.MainName
}

// saveMainLocked writes the choice to disk. The caller holds a.mu.
func (a *Agent) saveMainLocked() {
	p := a.mainPath()
	if p == "" {
		return
	}
	b, _ := json.Marshal(mainFile{Epoch: a.epoch, MainID: a.mainID, MainName: a.mainName})
	tmp := p + ".tmp"
	if os.WriteFile(tmp, b, 0o600) == nil {
		_ = os.Rename(tmp, p)
	}
}

// SetMain chooses a PC (this one, or one that is on the network now) as the main PC.
func (a *Agent) SetMain(id string) MainResult {
	id = strings.TrimSpace(id)
	a.mu.Lock()
	var name string
	switch {
	case id == a.id:
		name = a.cfg.Name
	default:
		p, ok := a.peers[id]
		if !ok {
			a.mu.Unlock()
			res := MainResult{Message: "That PC is not on the network right now, so it cannot be chosen. Wait until it appears in the list."}
			a.log.Log("error", "ELECT", "cannot choose %q: %s", id, res.Message)
			return res
		}
		name = p.Name
	}
	a.epoch++
	a.mainID, a.mainName = id, name
	res := MainResult{OK: true, Epoch: a.epoch, MainID: id, MainName: name}
	a.saveMainLocked()
	a.mu.Unlock()

	if id == a.id {
		res.Message = "This PC is now the main PC."
		a.log.Log("ok", "ELECT", "you chose THIS PC (%q) as the main PC (version %d)", name, res.Epoch)
	} else {
		res.Message = name + " is now the main PC."
		a.log.Log("ok", "ELECT", "you chose %q as the main PC (version %d)", name, res.Epoch)
	}
	a.afterMainChange()
	return res
}

// ClearMain removes the main PC choice.
func (a *Agent) ClearMain() MainResult {
	a.mu.Lock()
	a.epoch++
	a.mainID, a.mainName = "", ""
	res := MainResult{OK: true, Epoch: a.epoch, Message: "There is no main PC now."}
	a.saveMainLocked()
	a.mu.Unlock()
	a.log.Log("ok", "ELECT", "you removed the main PC (version %d)", res.Epoch)
	a.afterMainChange()
	return res
}

// afterMainChange tells the screen and the other PCs without waiting for the next announcement.
func (a *Agent) afterMainChange() {
	a.emitPeers()
	a.modeChanged() // where this PC keeps its data may have changed
	go a.sendBeacons()
}

// maybeAdopt takes another PC's choice when it is newer than ours (or wins an equal-version tie).
func (a *Agent) maybeAdopt(epoch int, mainID, mainName, from string) {
	if epoch <= 0 {
		return // that PC has never had a main PC to announce
	}
	a.mu.Lock()
	tie := epoch == a.epoch && mainID != a.mainID
	wins := epoch > a.epoch || (tie && mainID != "" && (a.mainID == "" || mainID < a.mainID))
	if !wins {
		// the same choice: only keep the name fresh (a PC may have been renamed)
		if epoch == a.epoch && mainID == a.mainID && mainName != "" && mainName != a.mainName {
			a.mainName = mainName
			a.saveMainLocked()
		}
		a.mu.Unlock()
		return
	}
	prev := a.epoch
	a.epoch, a.mainID, a.mainName = epoch, mainID, mainName
	a.saveMainLocked()
	a.mu.Unlock()

	switch {
	case mainID == "":
		a.log.Log("info", "ELECT", "%q removed the main PC (version %d)", from, epoch)
	case mainID == a.id:
		a.log.Log("ok", "ELECT", "THIS PC is now the main PC (chosen on %q, version %d)", from, epoch)
	default:
		a.log.Log("ok", "ELECT", "main PC is now %q (chosen on %q, version %d)", mainName, from, epoch)
	}
	if epoch == prev {
		a.log.Log("info", "ELECT", "two PCs were chosen at the same moment; the one with the lower id wins on every PC, so all PCs agree")
	}
	a.emitPeers()
	a.modeChanged()
}
