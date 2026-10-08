package update

import (
	"context"
	"crypto/sha512"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"os"
	"path"
	"strconv"
	"strings"
	"sync"
	"time"
)

type Emitter func(event string, data any)

type Manifest struct {
	Version string `json:"version"`
	File    string `json:"file"`
	SHA512  string `json:"sha512"`
	Size    int64  `json:"size"`
}

type Updater struct {
	current string
	baseURL string
	emit    Emitter

	mu       sync.Mutex
	manifest *Manifest
	staged   string
}

func New(current, baseURL string, emit Emitter) *Updater {
	return &Updater{current: current, baseURL: strings.TrimRight(baseURL, "/"), emit: emit}
}

func (u *Updater) fail(err error) error {
	u.emit("error", map[string]any{"message": err.Error()})
	return err
}

func (u *Updater) Check(ctx context.Context) error {
	u.emit("checking", nil)
	if u.baseURL == "" {
		return u.fail(errors.New("updates are not configured for this build"))
	}

	ctx, cancel := context.WithTimeout(ctx, 30*time.Second)
	defer cancel()

	req, err := http.NewRequestWithContext(ctx, http.MethodGet, u.baseURL+"/latest.json", nil)
	if err != nil {
		return u.fail(err)
	}
	res, err := http.DefaultClient.Do(req)
	if err != nil {
		return u.fail(err)
	}
	defer res.Body.Close()
	if res.StatusCode != http.StatusOK {
		return u.fail(fmt.Errorf("update feed returned %s", res.Status))
	}

	var m Manifest
	if err := json.NewDecoder(io.LimitReader(res.Body, 1<<20)).Decode(&m); err != nil {
		return u.fail(fmt.Errorf("update feed is not valid JSON: %w", err))
	}
	if m.Version == "" || m.File == "" || m.SHA512 == "" || path.Base(m.File) != m.File {
		return u.fail(errors.New("update feed is incomplete"))
	}

	if !SemverGreater(m.Version, u.current) {
		u.emit("not-available", map[string]any{"version": m.Version})
		return nil
	}

	u.mu.Lock()
	u.manifest = &m
	u.mu.Unlock()
	u.emit("available", map[string]any{"version": m.Version})
	return nil
}

func (u *Updater) Download(ctx context.Context) error {
	u.mu.Lock()
	m := u.manifest
	u.mu.Unlock()
	if m == nil {
		return u.fail(errors.New("no update to download; check for updates first"))
	}

	exe, err := os.Executable()
	if err != nil {
		return u.fail(err)
	}
	part := exe + ".part"

	staged, err := u.fetch(ctx, m, part)
	if err != nil {
		os.Remove(part)
		return u.fail(err)
	}

	u.mu.Lock()
	u.staged = staged
	u.mu.Unlock()
	u.emit("downloaded", map[string]any{"version": m.Version})
	return nil
}

func (u *Updater) fetch(ctx context.Context, m *Manifest, part string) (string, error) {
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, u.baseURL+"/"+m.File, nil)
	if err != nil {
		return "", err
	}
	res, err := http.DefaultClient.Do(req)
	if err != nil {
		return "", err
	}
	defer res.Body.Close()
	if res.StatusCode != http.StatusOK {
		return "", fmt.Errorf("download returned %s", res.Status)
	}

	out, err := os.Create(part)
	if err != nil {
		return "", err
	}

	total := res.ContentLength
	if total <= 0 {
		total = m.Size
	}
	hash := sha512.New()
	var done int64
	lastPercent := -1
	buf := make([]byte, 64*1024)
	for {
		n, readErr := res.Body.Read(buf)
		if n > 0 {
			if _, err := out.Write(buf[:n]); err != nil {
				out.Close()
				return "", err
			}
			hash.Write(buf[:n])
			done += int64(n)
			if total > 0 {
				if p := int(done * 100 / total); p != lastPercent {
					lastPercent = p
					u.emit("progress", map[string]any{"percent": p})
				}
			}
		}
		if readErr == io.EOF {
			break
		}
		if readErr != nil {
			out.Close()
			return "", readErr
		}
	}
	if err := out.Close(); err != nil {
		return "", err
	}

	if !strings.EqualFold(hex.EncodeToString(hash.Sum(nil)), m.SHA512) {
		return "", errors.New("downloaded update failed its checksum")
	}
	staged := strings.TrimSuffix(part, ".part") + ".new"
	if err := os.Rename(part, staged); err != nil {
		return "", err
	}
	return staged, nil
}

func (u *Updater) Install() error {
	u.mu.Lock()
	staged := u.staged
	u.mu.Unlock()
	if staged == "" {
		return u.fail(errors.New("no downloaded update to install"))
	}
	if err := swapAndRelaunch(staged); err != nil {
		return u.fail(err)
	}
	return nil
}

// SemverGreater reports whether a is a higher version than b; a pre-release ranks below its release.
func SemverGreater(a, b string) bool {
	ac, ap := splitVersion(a)
	bc, bp := splitVersion(b)
	for i := 0; i < 3; i++ {
		if ac[i] != bc[i] {
			return ac[i] > bc[i]
		}
	}
	switch {
	case ap == bp:
		return false
	case ap == "":
		return true
	case bp == "":
		return false
	}
	return ap > bp
}

func splitVersion(v string) ([3]int, string) {
	v = strings.TrimPrefix(strings.TrimSpace(v), "v")
	pre := ""
	if i := strings.IndexByte(v, '-'); i >= 0 {
		v, pre = v[:i], v[i+1:]
	}
	var core [3]int
	for i, part := range strings.SplitN(v, ".", 3) {
		core[i], _ = strconv.Atoi(part)
	}
	return core, pre
}
