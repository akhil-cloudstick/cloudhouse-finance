//go:build !darwin

package update

import "os"

// Windows and Linux ship one plain executable, so an update swaps that file in place: a running exe can be
// renamed on both, never overwritten.

// stagingFile is where Download writes the new exe: beside the old one, so the final rename stays on one disk.
func stagingFile() (string, error) {
	exe, err := os.Executable()
	if err != nil {
		return "", err
	}
	return exe + ".part", nil
}

func swapAndRelaunch(staged string) error {
	exe, err := os.Executable()
	if err != nil {
		return err
	}
	// A downloaded file is not executable on Linux until marked so; harmless on Windows.
	if err := os.Chmod(staged, 0o755); err != nil {
		return err
	}
	old := exe + ".old"
	os.Remove(old)
	if err := os.Rename(exe, old); err != nil {
		return err
	}
	if err := os.Rename(staged, exe); err != nil {
		os.Rename(old, exe)
		return err
	}
	return relaunch(exe)
}

// CleanupOld removes the previous binary left behind by the last install.
func CleanupOld() {
	if exe, err := os.Executable(); err == nil {
		os.Remove(exe + ".old")
	}
}
