package update

import (
	"os"
	"os/exec"
	"strconv"
	"strings"
	"time"
)

const waitPIDFlag = "--wait-pid="

// The relaunched exe waits for this process to exit first, or the single-instance lock would make it quit instead.
func relaunch(exe string) error {
	return exec.Command(exe, waitPIDFlag+strconv.Itoa(os.Getpid())).Start()
}

// WaitForPreviousInstance blocks until the process that relaunched this one has exited, up to 15 seconds.
func WaitForPreviousInstance(args []string) {
	for _, arg := range args {
		if !strings.HasPrefix(arg, waitPIDFlag) {
			continue
		}
		if pid, err := strconv.Atoi(strings.TrimPrefix(arg, waitPIDFlag)); err == nil && pid > 0 {
			waitForExit(pid, 15*time.Second)
		}
		return
	}
}
