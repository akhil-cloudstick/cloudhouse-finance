//go:build !windows

package update

import "errors"

func swapAndRelaunch(string) error {
	return errors.New("installing updates is only supported on Windows")
}

func CleanupOld() {}
