//go:build !windows

package lan

import "syscall"

// Off Windows the connection follows the system's own routing.
func controlFor(index int) func(network, address string, c syscall.RawConn) error { return nil }
