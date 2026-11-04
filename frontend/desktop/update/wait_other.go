//go:build !windows

package update

import (
	"syscall"
	"time"
)

func waitForExit(pid int, timeout time.Duration) {
	deadline := time.Now().Add(timeout)
	for time.Now().Before(deadline) && syscall.Kill(pid, 0) == nil {
		time.Sleep(100 * time.Millisecond)
	}
}
