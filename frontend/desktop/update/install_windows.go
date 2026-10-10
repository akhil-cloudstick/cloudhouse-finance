package update

import (
	"os"
	"os/exec"
)

func swapAndRelaunch(staged string) error {
	exe, err := os.Executable()
	if err != nil {
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
	return exec.Command(exe).Start()
}

// CleanupOld removes the previous binary left behind by the last install.
func CleanupOld() {
	if exe, err := os.Executable(); err == nil {
		os.Remove(exe + ".old")
	}
}
