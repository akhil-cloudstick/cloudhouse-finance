package update

import (
	"time"

	"golang.org/x/sys/windows"
)

func waitForExit(pid int, timeout time.Duration) {
	h, err := windows.OpenProcess(windows.SYNCHRONIZE, false, uint32(pid))
	if err != nil {
		return
	}
	defer windows.CloseHandle(h)
	windows.WaitForSingleObject(h, uint32(timeout.Milliseconds()))
}
