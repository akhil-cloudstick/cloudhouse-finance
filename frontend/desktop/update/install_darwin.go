//go:build darwin

package update

import (
	"errors"
	"os"
	"os/exec"
	"path/filepath"
	"strconv"
	"strings"
)

// On macOS the update is the whole .app bundle, zipped. Nothing is ever written inside the installed bundle: a
// changed bundle no longer matches its signature, and macOS then shows its "could not verify" warning again.
// The zip is downloaded and unpacked in the user's cache folder, then the bundle is swapped in one rename.

// appBundle is the installed .app this program runs from (…/Name.app/Contents/MacOS/exe).
func appBundle() (string, error) {
	exe, err := os.Executable()
	if err != nil {
		return "", err
	}
	if resolved, err := filepath.EvalSymlinks(exe); err == nil {
		exe = resolved
	}
	app := filepath.Dir(filepath.Dir(filepath.Dir(exe)))
	if !strings.HasSuffix(app, ".app") {
		return "", errors.New("this copy is not running from an .app bundle, so it cannot update itself")
	}
	return app, nil
}

// updateDir is this app's own scratch folder for updates, outside the bundle.
func updateDir() (string, error) {
	base, err := os.UserCacheDir()
	if err != nil {
		return "", err
	}
	exe, err := os.Executable()
	if err != nil {
		return "", err
	}
	return filepath.Join(base, filepath.Base(exe)+"-update"), nil
}

func stagingFile() (string, error) {
	dir, err := updateDir()
	if err != nil {
		return "", err
	}
	if err := os.MkdirAll(dir, 0o755); err != nil {
		return "", err
	}
	return filepath.Join(dir, "update.zip.part"), nil
}

// oldBundle is where the replaced bundle waits until the next start deletes it; hidden, so it never shows in Applications.
func oldBundle(app string) string {
	return filepath.Join(filepath.Dir(app), "."+filepath.Base(app)+".old")
}

func swapAndRelaunch(staged string) error {
	app, err := appBundle()
	if err != nil {
		return err
	}
	dir, err := updateDir()
	if err != nil {
		return err
	}
	unpacked := filepath.Join(dir, "unpacked")
	os.RemoveAll(unpacked)
	// ditto keeps the bundle's symlinks, permissions and signature intact (a plain unzip can lose them).
	if out, err := exec.Command("ditto", "-x", "-k", staged, unpacked).CombinedOutput(); err != nil {
		return errors.New("could not unpack the update: " + strings.TrimSpace(string(out)))
	}
	matches, _ := filepath.Glob(filepath.Join(unpacked, "*.app"))
	if len(matches) != 1 {
		return errors.New("the update does not contain an app")
	}
	fresh := matches[0]

	old := oldBundle(app)
	os.RemoveAll(old)
	if err := os.Rename(app, old); err != nil {
		return errors.New("could not replace the app (is it in a folder you can change?): " + err.Error())
	}
	if err := os.Rename(fresh, app); err != nil {
		// The cache can sit on another disk than Applications: copy instead.
		if out, cerr := exec.Command("ditto", fresh, app).CombinedOutput(); cerr != nil {
			os.RemoveAll(app)
			os.Rename(old, app)
			return errors.New("could not install the update: " + strings.TrimSpace(string(out)))
		}
	}
	os.RemoveAll(dir)
	// Downloaded by the app itself, so it carries no quarantine flag; clear it anyway so no warning can appear.
	exec.Command("xattr", "-dr", "com.apple.quarantine", app).Run()
	// -n: a new instance even though this one is still open; it waits for this one to quit (WaitForPreviousInstance).
	return exec.Command("open", "-n", app, "--args", waitPIDFlag+strconv.Itoa(os.Getpid())).Start()
}

// CleanupOld removes the bundle replaced by the last update, and any half-finished download.
func CleanupOld() {
	if app, err := appBundle(); err == nil {
		os.RemoveAll(oldBundle(app))
	}
	if dir, err := updateDir(); err == nil {
		os.RemoveAll(dir)
	}
}
