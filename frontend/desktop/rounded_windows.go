//go:build windows

package main

import (
	"syscall"
	"time"
	"unsafe"

	"golang.org/x/sys/windows"
)

const cornerRadius = 8

var (
	user32                 = windows.NewLazySystemDLL("user32.dll")
	gdi32                  = windows.NewLazySystemDLL("gdi32.dll")
	procEnumWindows        = user32.NewProc("EnumWindows")
	procGetWindowThreadPID = user32.NewProc("GetWindowThreadProcessId")
	procIsWindowVisible    = user32.NewProc("IsWindowVisible")
	procGetWindowTextW     = user32.NewProc("GetWindowTextW")
	procGetWindowRect      = user32.NewProc("GetWindowRect")
	procIsZoomed           = user32.NewProc("IsZoomed")
	procSetWindowRgn       = user32.NewProc("SetWindowRgn")
	procGetDpiForWindow    = user32.NewProc("GetDpiForWindow")
	procCreateRoundRectRgn = gdi32.NewProc("CreateRoundRectRgn")
)

type rect struct{ left, top, right, bottom int32 }

// findWindow returns this process's visible top-level window with the given title.
func findWindow(title string) uintptr {
	pid := windows.GetCurrentProcessId()
	var found uintptr
	cb := syscall.NewCallback(func(hwnd uintptr, _ uintptr) uintptr {
		var owner uint32
		procGetWindowThreadPID.Call(hwnd, uintptr(unsafe.Pointer(&owner)))
		if owner != pid {
			return 1
		}
		if visible, _, _ := procIsWindowVisible.Call(hwnd); visible == 0 {
			return 1
		}
		buf := make([]uint16, 256)
		n, _, _ := procGetWindowTextW.Call(hwnd, uintptr(unsafe.Pointer(&buf[0])), uintptr(len(buf)))
		if syscall.UTF16ToString(buf[:n]) == title {
			found = hwnd
			return 0
		}
		return 1
	})
	procEnumWindows.Call(cb, 0)
	return found
}

func isWindows11() bool {
	return windows.RtlGetVersion().BuildNumber >= 22000
}

// roundWindowCorners rounds a restored window and leaves a maximised one square.
// Windows 11 already rounds frameless windows itself, so only Windows 10 needs the region.
func roundWindowCorners(title string) {
	if isWindows11() {
		return
	}
	go func() {
		var hwnd uintptr
		for i := 0; i < 100 && hwnd == 0; i++ {
			hwnd = findWindow(title)
			time.Sleep(100 * time.Millisecond)
		}
		if hwnd == 0 {
			return
		}

		var lastW, lastH int32
		lastZoomed := int32(-1)
		for range time.Tick(80 * time.Millisecond) {
			var r rect
			if ok, _, _ := procGetWindowRect.Call(hwnd, uintptr(unsafe.Pointer(&r))); ok == 0 {
				return
			}
			w, h := r.right-r.left, r.bottom-r.top
			zoomed, _, _ := procIsZoomed.Call(hwnd)
			z := int32(zoomed)
			if w == lastW && h == lastH && z == lastZoomed {
				continue
			}
			lastW, lastH, lastZoomed = w, h, z

			if z != 0 {
				procSetWindowRgn.Call(hwnd, 0, 1)
				continue
			}
			dpi, _, _ := procGetDpiForWindow.Call(hwnd)
			if dpi == 0 {
				dpi = 96
			}
			diameter := uintptr(cornerRadius * 2 * int(dpi) / 96)
			rgn, _, _ := procCreateRoundRectRgn.Call(0, 0, uintptr(w+1), uintptr(h+1), diameter, diameter)
			procSetWindowRgn.Call(hwnd, rgn, 1)
		}
	}()
}
