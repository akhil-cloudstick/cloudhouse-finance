package lan

import (
	"crypto/hmac"
	"crypto/sha256"
	"encoding/hex"
	"errors"
	"os"
	"path/filepath"
	"strings"
)

// The business key. The server derives one key per business (backend/modules/Sync/controllers/lan_key.go) and gives it to
// every PC that signs in to that business online. The PCs of the business use it to sign what they announce and every
// request one makes to the main PC, so a PC that does not belong to the business can neither take over as the main PC
// nor read or change its data. It is kept sealed for this Windows user, like the other secrets of the app.

const sepByte = "\x1f"

// sign returns the HMAC-SHA256 of the parts under the key, as hex.
func sign(key []byte, parts ...string) string {
	m := hmac.New(sha256.New, key)
	m.Write([]byte(strings.Join(parts, sepByte)))
	return hex.EncodeToString(m.Sum(nil))
}

// verifySig reports whether sig is the signature of the parts under the key.
func verifySig(key []byte, sig string, parts ...string) bool {
	if len(key) == 0 || sig == "" {
		return false
	}
	want, err := hex.DecodeString(sign(key, parts...))
	if err != nil {
		return false
	}
	got, err := hex.DecodeString(sig)
	if err != nil {
		return false
	}
	return hmac.Equal(want, got)
}

func (a *Agent) keyPath() string {
	if a.cfg.DataDir == "" {
		return ""
	}
	name := "lan-key.bin"
	if a.cfg.Instance != "" {
		name = "lan-key-" + sanitize(a.cfg.Instance) + ".bin"
	}
	return filepath.Join(a.cfg.DataDir, name)
}

// loadKey restores the key kept from an earlier run.
func (a *Agent) loadKey() {
	p := a.keyPath()
	if p == "" {
		return
	}
	b, err := os.ReadFile(p)
	if err != nil {
		return
	}
	if a.cfg.Unseal != nil {
		if b, err = a.cfg.Unseal(b); err != nil {
			a.log.Log("warn", "KEY", "the saved business key could not be read by this Windows user; sign in online again to get it")
			return
		}
	}
	if k, ok := parseKey(string(b)); ok {
		a.key = k
	}
}

func parseKey(s string) ([]byte, bool) {
	s = strings.TrimSpace(s)
	if len(s) < 32 || len(s) > 256 {
		return nil, false
	}
	k, err := hex.DecodeString(s)
	if err != nil || len(k) < 16 {
		return nil, false
	}
	return k, true
}

// SetKey stores the business key the server gave this PC. It is safe to call at every sign-in.
func (a *Agent) SetKey(key string) error {
	k, ok := parseKey(key)
	if !ok {
		return errors.New("that is not a valid business key")
	}
	a.mu.Lock()
	same := hmac.Equal(a.key, k)
	a.key = k
	a.mu.Unlock()
	if same {
		return nil
	}
	if p := a.keyPath(); p != "" {
		out := []byte(strings.TrimSpace(key))
		if a.cfg.Seal != nil {
			var err error
			if out, err = a.cfg.Seal(out); err != nil {
				return err
			}
		}
		if err := os.WriteFile(p, out, 0o600); err != nil {
			return err
		}
	}
	a.log.Log("ok", "KEY", "this PC now has the business key: it can trust the main PC announcements and join the main PC")
	a.modeChanged()
	return nil
}

// HasKey says whether this PC has the business key.
func (a *Agent) HasKey() bool {
	a.mu.Lock()
	defer a.mu.Unlock()
	return len(a.key) > 0
}

func (a *Agent) keyBytes() []byte {
	a.mu.Lock()
	defer a.mu.Unlock()
	return a.key
}

// modeChanged tells the screen that what this PC uses for its data may have changed (the key arrived, or the main PC
// was chosen or removed), so the app can reopen its offline store on the right one.
func (a *Agent) modeChanged() { a.emit("lan:mode", nil) }

// Notify tells the page something happened that it should react to (for example: a counter saved an entry on this main PC,
// so the page can start sending it to the server at once).
func (a *Agent) Notify(event string, data any) { a.emit(event, data) }
