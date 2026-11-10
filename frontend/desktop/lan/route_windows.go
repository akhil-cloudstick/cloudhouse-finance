//go:build windows

package lan

import "syscall"

// IP_UNICAST_IF (winsock): the network card, by index, that unicast traffic from this socket must leave through.
// For IPv4 the index is given in network byte order.
const ipUnicastIf = 31

// controlFor forces a connection out of one network card. Windows otherwise picks the card from its routing table,
// and two cards on the same 169.254.x.x range (a direct cable plus a VPN adapter) make that pick unreliable.
func controlFor(index int) func(network, address string, c syscall.RawConn) error {
	return func(network, address string, c syscall.RawConn) error {
		if index <= 0 {
			return nil
		}
		var serr error
		if err := c.Control(func(fd uintptr) {
			i := uint32(index)
			be := (i&0xff)<<24 | (i&0xff00)<<8 | (i&0xff0000)>>8 | i>>24
			serr = syscall.SetsockoptInt(syscall.Handle(fd), syscall.IPPROTO_IP, ipUnicastIf, int(be))
		}); err != nil {
			return err
		}
		return serr
	}
}
