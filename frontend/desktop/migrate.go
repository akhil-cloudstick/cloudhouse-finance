package main

import (
	"encoding/json"
	"fmt"
	"regexp"

	"cloudhouse/desktop/localstore"
)

// Joining the main PC with unsent entries. A PC that has been working on its own may hold entries the server has not
// confirmed yet. Once it uses the main PC's data it no longer looks at its own file, so those entries would never be sent.
// Before it starts using the main PC's data it therefore hands every one of them over: the entry itself (a refused entry
// stays in review, with the server's reason), the photos it carries and the passwords typed for it. An entry is removed
// here only after the main PC has confirmed it, and handing over the same entry twice changes nothing, so a hand-over that
// is interrupted (cable out, main PC closed) just continues the next time the store is opened, and nothing is lost.

const secretsFile = "data/pending_secrets.json"

var (
	rePhotoRef  = regexp.MustCompile(`local-photo:([A-Za-z0-9_-]+)`)
	reSecretRef = regexp.MustCompile(`secret:([A-Za-z0-9_-]+)`)
)

// handover is what the last hand-over did, shown on the Network screen.
type handover struct {
	Moved int    `json:"moved"` // entries now on the main PC
	Left  int    `json:"left"`  // entries still only on this PC because the hand-over stopped
	Error string `json:"error"` // why it stopped
}

// migrateLocalEntries hands this PC's own unsent entries to the main PC. It never deletes anything the main PC has not
// confirmed.
func (a *App) migrateLocalEntries() handover {
	var res handover
	logf := a.lan.Log().Log
	entries, err := a.store.ExportEntries()
	if err != nil {
		res.Error = "this PC's unsent entries could not be read: " + err.Error()
		logf("error", "MIGRATE", "%s", res.Error)
		return res
	}
	if len(entries) == 0 {
		return res
	}
	logf("info", "MIGRATE", "this PC has %d unsent entries from before it joined the main PC: handing them over so they are still sent", len(entries))

	secrets := a.localSecrets()
	var movedSecrets []string
	for i, e := range entries {
		keys, err := a.handOver(e, secrets)
		if err != nil {
			res.Left = len(entries) - i
			res.Error = err.Error()
			logf("error", "MIGRATE", "stopped after %d of %d entries: %v. The rest stay safe on this PC and are handed over the next time it opens", i, len(entries), err)
			break
		}
		movedSecrets = append(movedSecrets, keys...)
		res.Moved++
	}
	if len(movedSecrets) > 0 { // the passwords that moved are no longer kept here
		for _, k := range movedSecrets {
			delete(secrets, k)
		}
		a.writeLocalSecrets(secrets)
	}
	if res.Left == 0 {
		logf("ok", "MIGRATE", "handed %d unsent entries to the main PC; it will send them", res.Moved)
	}
	return res
}

// handOver moves one entry with what it needs. It returns the keys of the passwords that went with it.
func (a *App) handOver(e localstore.ExportedEntry, secrets map[string]string) ([]string, error) {
	var head struct {
		ID string `json:"id"`
	}
	if err := json.Unmarshal([]byte(e.Line), &head); err != nil || head.ID == "" {
		return nil, fmt.Errorf("an entry without an id could not be handed over")
	}
	// the photos picked for it
	for _, m := range rePhotoRef.FindAllStringSubmatch(e.Line, -1) {
		name := "photos/" + m[1] + ".json"
		content, err := a.store.ReadFile(name)
		if err != nil {
			return nil, fmt.Errorf("entry %s: its photo could not be read: %w", head.ID, err)
		}
		if content == "" {
			continue // already gone
		}
		if err := rcall(a, "WriteFile", name, content); err != nil {
			return nil, err
		}
	}
	// the passwords typed for it
	subset := map[string]string{}
	for _, m := range reSecretRef.FindAllStringSubmatch(e.Line, -1) {
		if v, ok := secrets[m[1]]; ok {
			subset[m[1]] = v
		}
	}
	if len(subset) > 0 {
		if err := rcall(a, "ImportSecrets", subset); err != nil {
			return nil, err
		}
	}
	// the entry itself, last: once the main PC has it, it is removed here
	if _, err := rcallInto[bool](a, "ImportEntry", e); err != nil {
		return nil, err
	}
	if err := a.store.DeleteOutboxEntry(head.ID); err != nil {
		return nil, fmt.Errorf("entry %s reached the main PC but could not be removed here: %w", head.ID, err)
	}
	keys := make([]string, 0, len(subset))
	for k := range subset {
		keys = append(keys, k)
	}
	return keys, nil
}

func (a *App) localSecrets() map[string]string {
	out := map[string]string{}
	if text, err := a.store.ReadFile(secretsFile); err == nil && text != "" {
		_ = json.Unmarshal([]byte(text), &out)
	}
	return out
}

func (a *App) writeLocalSecrets(m map[string]string) {
	if b, err := json.Marshal(m); err == nil {
		_ = a.store.WriteFile(secretsFile, string(b))
	}
}

// importSecrets adds passwords handed over by a joining PC to the ones this (main) PC already keeps.
func (a *App) importSecrets(in map[string]string) error {
	a.sh.secretsMu.Lock()
	defer a.sh.secretsMu.Unlock()
	all := a.localSecrets()
	for k, v := range in {
		all[k] = v
	}
	b, err := json.Marshal(all)
	if err != nil {
		return err
	}
	return a.store.WriteFile(secretsFile, string(b))
}
