package main

import (
	"crypto/sha256"
	"encoding/base64"
	"encoding/hex"
	"errors"
	"fmt"
	"io"
	"os"
	"path/filepath"
	"time"

	"cloudhouse/desktop/localstore"
)

// Moving the main PC. The admin presses "Move the main PC to this PC" on the PC that should become the main PC. It:
//  1. notes what this PC already has of its own (unsent entries, photos, passwords, its device key),
//  2. asks the old main PC to pause writes, so nothing changes while the data is copied,
//  3. has the old main PC make a consistent snapshot of its data file and downloads it in pieces,
//  4. checks the copy (the same size and checksum, a clean integrity check, the same number of rows in every table),
//  5. only then swaps it in, keeping this PC's own file as a backup, and puts this PC's own entries and identity back,
//  6. lets the old main PC write again and takes over as the main PC; the other PCs follow.
// Nothing is removed from the old main PC, so its file stays as a second copy. Anything it saved after the snapshot is not
// lost either: when it rejoins as a counter it hands whatever its own file holds to the new main PC (see migrate.go).

const (
	moveChunk    = 4 << 20          // one piece of the copy
	freezeFor    = 10 * time.Minute // writes pause at most this long, even if the move is abandoned
	freezeNotice = "The main PC is being moved to another PC: saving pauses for a moment. Try again shortly."
)

// mutating are the storage calls that change data. While the main PC is being moved they are refused.
var mutating = map[string]bool{
	"AppendOutbox": true, "SaveEntry": true, "ChangeEntry": true, "DeleteOutboxEntry": true, "MarkReview": true,
	"RetryReview": true, "WriteFile": true, "MirrorApply": true, "MirrorBindTenant": true, "MirrorWriteTemp": true,
	"MirrorDropTemp": true, "ImportEntry": true, "ImportSecrets": true,
}

// writeGate refuses a change while this (main) PC is being moved.
func (a *App) writeGate() error {
	a.sh.mu.Lock()
	defer a.sh.mu.Unlock()
	if time.Now().Before(a.sh.frozenUntil) {
		return errors.New(freezeNotice)
	}
	return nil
}

// ---- the old main PC's side -----------------------------------------------------------------------------------------

type moveSnapshot struct {
	Size   int64          `json:"size"`
	SHA256 string         `json:"sha256"`
	Counts map[string]int `json:"counts"`
}

func (a *App) moveFreeze(toID, toName string) error {
	if !a.lan.IsMain() {
		return errors.New("this PC is not the main PC")
	}
	a.sh.mu.Lock()
	a.sh.frozenUntil = time.Now().Add(freezeFor)
	a.sh.mu.Unlock()
	a.lan.Log().Log("warn", "MOVE", "the main PC is being moved to %q (%s): saving is paused until the copy is done", toName, toID)
	return nil
}

func (a *App) moveSnapshot() (moveSnapshot, error) {
	var out moveSnapshot
	dir, err := a.store.Dir()
	if err != nil {
		return out, errors.New("the main PC's data is not open yet")
	}
	path := filepath.Join(dir, "move", "snapshot.db")
	if err := a.store.Snapshot(path); err != nil {
		return out, err
	}
	if out.Counts, err = localstore.VerifyDB(path); err != nil {
		return out, fmt.Errorf("the snapshot did not pass its own check: %w", err)
	}
	if out.SHA256, out.Size, err = hashFile(path); err != nil {
		return out, err
	}
	a.sh.mu.Lock()
	a.sh.moveFile = path
	a.sh.mu.Unlock()
	a.lan.Log().Log("info", "MOVE", "snapshot ready: %.1f MB, %d tables", float64(out.Size)/1e6, len(out.Counts))
	return out, nil
}

func (a *App) moveRead(offset int64, length int) (string, error) {
	a.sh.mu.Lock()
	path := a.sh.moveFile
	a.sh.mu.Unlock()
	if path == "" {
		return "", errors.New("no snapshot is ready")
	}
	if length <= 0 || length > moveChunk {
		length = moveChunk
	}
	f, err := os.Open(path)
	if err != nil {
		return "", err
	}
	defer f.Close()
	buf := make([]byte, length)
	n, err := f.ReadAt(buf, offset)
	if err != nil && !errors.Is(err, io.EOF) {
		return "", err
	}
	return base64.StdEncoding.EncodeToString(buf[:n]), nil
}

// moveDone ends a move on the old main PC: writes are allowed again and the snapshot is deleted.
func (a *App) moveDone(ok bool) {
	a.sh.mu.Lock()
	path := a.sh.moveFile
	a.sh.moveFile = ""
	a.sh.frozenUntil = time.Time{}
	a.sh.mu.Unlock()
	if path != "" {
		_ = os.RemoveAll(filepath.Dir(path))
	}
	if ok {
		a.lan.Log().Log("ok", "MOVE", "the copy is done; this PC will become a counter of the new main PC")
	} else {
		a.lan.Log().Log("warn", "MOVE", "the move was abandoned; saving is allowed again")
	}
}

func hashFile(path string) (string, int64, error) {
	f, err := os.Open(path)
	if err != nil {
		return "", 0, err
	}
	defer f.Close()
	h := sha256.New()
	n, err := io.Copy(h, f)
	return hex.EncodeToString(h.Sum(nil)), n, err
}

// ---- the new main PC's side -----------------------------------------------------------------------------------------

// MoveResult is what the screen shows after "Move the main PC to this PC".
type MoveResult struct {
	OK      bool   `json:"ok"`
	Message string `json:"message"`
	Backup  string `json:"backup"` // where this PC's own previous data file was kept
}

// LanMoveMain makes this PC the main PC, bringing the data of the current main PC with it (see the top of this file).
func (a *App) LanMoveMain() MoveResult {
	if !a.sh.moveMu.TryLock() {
		return MoveResult{Message: "A move is already running."}
	}
	defer a.sh.moveMu.Unlock()
	res, err := a.moveMainHere()
	if err != nil {
		a.lan.Log().Log("error", "MOVE", "the move did not happen, nothing was changed: %v", err)
		return MoveResult{Message: err.Error()}
	}
	return res
}

func (a *App) moveMainHere() (MoveResult, error) {
	logf := a.lan.Log().Log
	m := a.lan.Mode()
	switch {
	case !m.HasKey:
		return MoveResult{}, errors.New("this PC has no business key yet: sign in online once on it first")
	case m.MainID == "" || m.MainID == a.lan.ID():
		return MoveResult{}, errors.New("there is no other main PC to move from")
	case !m.MainOnline:
		return MoveResult{}, fmt.Errorf("the current main PC (%s) is not on the network, so its data cannot be copied. Use 'Make this the main PC' instead; its unsent entries are handed over when it comes back", m.MainName)
	}
	dir, err := a.store.Dir()
	if err != nil {
		return MoveResult{}, errors.New("sign in on this PC first: its data is not open yet")
	}
	logf("info", "MOVE", "moving the main PC from %q to this PC", m.MainName)

	// 1. what this PC already has of its own
	own, err := a.store.ExportEntries()
	if err != nil {
		return MoveResult{}, err
	}
	ownSecrets := a.localSecrets()
	ownFiles := map[string]string{}
	for _, name := range []string{"device.json", "users.json"} {
		if c, err := a.store.ReadFile(name); err == nil && c != "" {
			ownFiles[name] = c
		}
	}
	for _, e := range own {
		for _, p := range rePhotoRef.FindAllStringSubmatch(e.Line, -1) {
			name := "photos/" + p[1] + ".json"
			if c, err := a.store.ReadFile(name); err == nil && c != "" {
				ownFiles[name] = c
			}
		}
	}

	// 2. the old main PC pauses writes; if anything fails from here on it is told to carry on
	if err := rcall(a, "MoveFreeze", a.lan.ID(), a.lan.Status().Name); err != nil {
		return MoveResult{}, fmt.Errorf("the current main PC could not pause saving: %w", err)
	}
	finished := false
	defer func() {
		if !finished {
			_ = rcall(a, "MoveDone", false)
		}
	}()

	// 3. a snapshot of its data, downloaded in pieces
	snap, err := rcallInto[moveSnapshot](a, "MoveSnapshot")
	if err != nil {
		return MoveResult{}, err
	}
	logf("info", "MOVE", "copying %.1f MB from %q", float64(snap.Size)/1e6, m.MainName)
	incoming := filepath.Join(dir, "move", "incoming.db")
	if err := os.MkdirAll(filepath.Dir(incoming), 0o700); err != nil {
		return MoveResult{}, err
	}
	defer os.RemoveAll(filepath.Dir(incoming))
	out, err := os.Create(incoming)
	if err != nil {
		return MoveResult{}, err
	}
	h := sha256.New()
	var got int64
	lastLog := time.Now()
	for got < snap.Size {
		piece, err := rcallInto[string](a, "MoveRead", got, moveChunk)
		if err != nil {
			out.Close()
			return MoveResult{}, fmt.Errorf("copying stopped at %d of %d bytes: %w", got, snap.Size, err)
		}
		data, err := base64.StdEncoding.DecodeString(piece)
		if err != nil || len(data) == 0 {
			out.Close()
			return MoveResult{}, fmt.Errorf("copying stopped at %d of %d bytes: the data was cut short", got, snap.Size)
		}
		if _, err := out.Write(data); err != nil {
			out.Close()
			return MoveResult{}, err
		}
		h.Write(data)
		got += int64(len(data))
		if time.Since(lastLog) > 2*time.Second {
			logf("info", "MOVE", "copied %.1f of %.1f MB", float64(got)/1e6, float64(snap.Size)/1e6)
			lastLog = time.Now()
		}
	}
	if err := out.Close(); err != nil {
		return MoveResult{}, err
	}

	// 4. check the copy before anything here is touched
	if got != snap.Size || hex.EncodeToString(h.Sum(nil)) != snap.SHA256 {
		return MoveResult{}, errors.New("the copy does not match what the main PC sent (size or checksum differs); nothing was changed")
	}
	counts, err := localstore.VerifyDB(incoming)
	if err != nil {
		return MoveResult{}, err
	}
	for table, want := range snap.Counts {
		if counts[table] != want {
			return MoveResult{}, fmt.Errorf("the copy has %d rows in %s but the main PC has %d; nothing was changed", counts[table], table, want)
		}
	}
	logf("ok", "MOVE", "the copy is complete and checked (%d tables, same checksum, same row counts)", len(counts))

	// 5. swap it in, keeping this PC's own file, then put this PC's own things back
	backup, err := a.store.ReplaceDB(incoming)
	if err != nil {
		return MoveResult{}, err
	}
	rollback := func(cause error) (MoveResult, error) {
		if _, rerr := a.store.ReplaceDB(backup); rerr != nil {
			return MoveResult{}, fmt.Errorf("%v; and this PC's previous data could not be put back (it is kept at %s): %v", cause, backup, rerr)
		}
		return MoveResult{}, fmt.Errorf("%v; this PC's previous data was put back", cause)
	}
	for name, content := range ownFiles { // its device key, sign-ins and photos: these belong to this PC
		if err := a.store.WriteFile(name, content); err != nil {
			return rollback(fmt.Errorf("restoring %s: %w", name, err))
		}
	}
	if len(ownSecrets) > 0 {
		if err := a.importSecrets(ownSecrets); err != nil {
			return rollback(fmt.Errorf("restoring this PC's passwords: %w", err))
		}
	}
	for _, e := range own { // entries it had queued that the old main PC did not have
		if _, err := a.store.ImportEntry(e); err != nil {
			return rollback(fmt.Errorf("restoring a queued entry: %w", err))
		}
	}

	// 6. the old main PC may write again, and this PC takes over
	_ = rcall(a, "MoveDone", true)
	finished = true
	a.lan.SetMain(a.lan.ID())
	a.sh.mu.Lock()
	a.sh.shared, a.sh.mainID, a.sh.handover = false, "", handover{}
	a.sh.mu.Unlock()
	a.lan.Notify("lan:reload", nil) // the page opens its offline data again on the new file
	logf("ok", "MOVE", "this PC is now the main PC. The data file it had before is kept at %s", backup)
	return MoveResult{OK: true, Backup: backup, Message: "This PC is now the main PC. Its previous data file was kept as a backup."}, nil
}
