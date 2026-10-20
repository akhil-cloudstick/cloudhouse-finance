package update

import (
	"archive/zip"
	"context"
	"crypto/sha512"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"os"
	"os/exec"
	"path"
	"path/filepath"
	"strings"
	"sync"
	"time"
)

// relaunchSelf restarts the exe without renaming/replacing it, so it works on every OS.
func relaunchSelf() error {
	exe, err := os.Executable()
	if err != nil {
		return err
	}
	return exec.Command(exe).Start()
}

// ContentManifest is the shared (not per-tenant) web-content feed.
type ContentManifest struct {
	Version string `json:"version"`
	File    string `json:"file"`
	SHA512  string `json:"sha512"`
	Size    int64  `json:"size"`
}

// ContentUpdater checks, downloads and activates a content-only release without touching the installed exe, icon or name.
type ContentUpdater struct {
	baseURL string
	dir     string // <exeDir>/content
	emit    Emitter

	mu       sync.Mutex
	manifest *ContentManifest
	staged   string // extracted dir ready to activate, e.g. <dir>/<version>
}

func NewContent(baseURL, contentDir string, emit Emitter) *ContentUpdater {
	return &ContentUpdater{baseURL: strings.TrimRight(baseURL, "/"), dir: contentDir, emit: emit}
}

// ActiveVersion returns the version active on disk, or "" if still on the embedded assets.
func (c *ContentUpdater) ActiveVersion() string {
	b, err := os.ReadFile(filepath.Join(c.dir, "active-version.txt"))
	if err != nil {
		return ""
	}
	return strings.TrimSpace(string(b))
}

// ActiveAssetsDir returns the on-disk assets directory to serve, or false to serve the embedded assets.
func (c *ContentUpdater) ActiveAssetsDir() (string, bool) {
	return ActiveContentAssetsDir(c.dir)
}

// ActiveContentAssetsDir is ActiveAssetsDir callable before any ContentUpdater exists.
func ActiveContentAssetsDir(contentDir string) (string, bool) {
	b, err := os.ReadFile(filepath.Join(contentDir, "active-version.txt"))
	if err != nil {
		return "", false
	}
	v := strings.TrimSpace(string(b))
	if v == "" {
		return "", false
	}
	dir := filepath.Join(contentDir, v, "assets")
	if st, err := os.Stat(dir); err != nil || !st.IsDir() {
		return "", false
	}
	return dir, true
}

// ContentDir is the on-disk directory next to the exe a content package lives in.
func ContentDir() (string, error) {
	exe, err := os.Executable()
	if err != nil {
		return "", err
	}
	return filepath.Join(filepath.Dir(exe), "content"), nil
}

func (c *ContentUpdater) fail(err error) error {
	c.emit("content:error", map[string]any{"message": err.Error()})
	return err
}

func (c *ContentUpdater) Check(ctx context.Context) error {
	c.emit("content:checking", nil)
	if c.baseURL == "" {
		return c.fail(errors.New("content updates are not configured for this build"))
	}

	ctx, cancel := context.WithTimeout(ctx, 30*time.Second)
	defer cancel()

	req, err := http.NewRequestWithContext(ctx, http.MethodGet, c.baseURL+"/latest-content.json", nil)
	if err != nil {
		return c.fail(err)
	}
	res, err := http.DefaultClient.Do(req)
	if err != nil {
		return c.fail(err)
	}
	defer res.Body.Close()
	if res.StatusCode != http.StatusOK {
		return c.fail(fmt.Errorf("content feed returned %s", res.Status))
	}

	var m ContentManifest
	if err := json.NewDecoder(io.LimitReader(res.Body, 1<<20)).Decode(&m); err != nil {
		return c.fail(fmt.Errorf("content feed is not valid JSON: %w", err))
	}
	if m.Version == "" || m.File == "" || m.SHA512 == "" || path.Base(m.File) != m.File {
		return c.fail(errors.New("content feed is incomplete"))
	}

	if !SemverGreater(m.Version, c.ActiveVersion()) {
		c.emit("content:not-available", map[string]any{"version": m.Version})
		return nil
	}

	c.mu.Lock()
	c.manifest = &m
	c.mu.Unlock()
	c.emit("content:available", map[string]any{"version": m.Version})
	return nil
}

func (c *ContentUpdater) Download(ctx context.Context) error {
	c.mu.Lock()
	m := c.manifest
	c.mu.Unlock()
	if m == nil {
		return c.fail(errors.New("no content update to download; check for updates first"))
	}

	if err := os.MkdirAll(c.dir, 0o755); err != nil {
		return c.fail(err)
	}
	zipPath := filepath.Join(c.dir, m.File)

	if err := c.fetch(ctx, m, zipPath); err != nil {
		os.Remove(zipPath)
		return c.fail(err)
	}

	destDir := filepath.Join(c.dir, m.Version)
	os.RemoveAll(destDir)
	if err := extractZip(zipPath, destDir); err != nil {
		os.RemoveAll(destDir)
		os.Remove(zipPath)
		return c.fail(err)
	}
	os.Remove(zipPath)

	c.mu.Lock()
	c.staged = destDir
	c.mu.Unlock()
	c.emit("content:downloaded", map[string]any{"version": m.Version})
	return nil
}

func (c *ContentUpdater) fetch(ctx context.Context, m *ContentManifest, dest string) error {
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, c.baseURL+"/"+m.File, nil)
	if err != nil {
		return err
	}
	res, err := http.DefaultClient.Do(req)
	if err != nil {
		return err
	}
	defer res.Body.Close()
	if res.StatusCode != http.StatusOK {
		return fmt.Errorf("download returned %s", res.Status)
	}

	out, err := os.Create(dest)
	if err != nil {
		return err
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
				return err
			}
			hash.Write(buf[:n])
			done += int64(n)
			if total > 0 {
				if p := int(done * 100 / total); p != lastPercent {
					lastPercent = p
					c.emit("content:progress", map[string]any{"percent": p})
				}
			}
		}
		if readErr == io.EOF {
			break
		}
		if readErr != nil {
			out.Close()
			return readErr
		}
	}
	if err := out.Close(); err != nil {
		return err
	}

	if !strings.EqualFold(hex.EncodeToString(hash.Sum(nil)), m.SHA512) {
		return errors.New("downloaded content package failed its checksum")
	}
	return nil
}

// Apply activates the downloaded content and relaunches the same exe (icon/name untouched).
func (c *ContentUpdater) Apply() error {
	c.mu.Lock()
	staged := c.staged
	c.mu.Unlock()
	if staged == "" {
		return c.fail(errors.New("no downloaded content update to apply"))
	}
	version := filepath.Base(staged)
	if err := os.WriteFile(filepath.Join(c.dir, "active-version.txt"), []byte(version), 0o644); err != nil {
		return c.fail(err)
	}
	c.emit("content:applied", map[string]any{"version": version})
	return relaunchSelf()
}

func extractZip(zipPath, destDir string) error {
	r, err := zip.OpenReader(zipPath)
	if err != nil {
		return err
	}
	defer r.Close()

	if err := os.MkdirAll(destDir, 0o755); err != nil {
		return err
	}
	for _, f := range r.File {
		target := filepath.Join(destDir, f.Name)
		if !strings.HasPrefix(target, filepath.Clean(destDir)+string(os.PathSeparator)) {
			return fmt.Errorf("content package entry escapes destination: %s", f.Name)
		}
		if f.FileInfo().IsDir() {
			if err := os.MkdirAll(target, 0o755); err != nil {
				return err
			}
			continue
		}
		if err := os.MkdirAll(filepath.Dir(target), 0o755); err != nil {
			return err
		}
		rc, err := f.Open()
		if err != nil {
			return err
		}
		out, err := os.Create(target)
		if err != nil {
			rc.Close()
			return err
		}
		if _, err := io.Copy(out, rc); err != nil {
			out.Close()
			rc.Close()
			return err
		}
		out.Close()
		rc.Close()
	}
	return nil
}
