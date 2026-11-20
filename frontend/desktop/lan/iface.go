package lan

import "net"

// Iface is one usable IPv4 address of this PC on a network.
type Iface struct {
	Name      string `json:"name"`
	Index     int    `json:"index"` // the network card's number in Windows
	IP        string `json:"ip"`
	Mask      string `json:"mask"`
	Broadcast string `json:"broadcast"`
	// LinkLocal is true for 169.254.x.x: the address Windows gives itself on a direct cable with no router or DHCP.
	LinkLocal bool `json:"linkLocal"`
}

// IfaceReport is what this PC currently has.
type IfaceReport struct {
	Usable []Iface `json:"usable"`
	// NoAddress lists connected network cards that have no IPv4 address yet (a direct cable takes Windows about
	// 30 to 60 seconds to assign one).
	NoAddress []string `json:"noAddress"`
}

// makeIface builds the entry for one address, or reports false when it cannot carry a broadcast.
func makeIface(name string, ip net.IP, mask net.IPMask) (Iface, bool) {
	ip4 := ip.To4()
	if ip4 == nil || ip4.IsUnspecified() || ip4.IsLoopback() {
		return Iface{}, false
	}
	if len(mask) == net.IPv6len {
		mask = mask[12:]
	}
	if len(mask) != net.IPv4len {
		return Iface{}, false
	}
	bcast := make(net.IP, net.IPv4len)
	ones := 0
	for i := 0; i < net.IPv4len; i++ {
		bcast[i] = ip4[i] | ^mask[i]
		if mask[i] == 0xff {
			ones++
		}
	}
	if ones == net.IPv4len { // a /32 has no broadcast address
		return Iface{}, false
	}
	return Iface{
		Name:      name,
		IP:        ip4.String(),
		Mask:      net.IP(mask).String(),
		Broadcast: bcast.String(),
		LinkLocal: ip4[0] == 169 && ip4[1] == 254,
	}, true
}

// overlappingLinkLocal returns the names of the network cards that all hold a 169.254.x.x address, when there is more
// than one. Windows then has several cards on the same range (a direct cable plus a VPN adapter such as Tailscale, or an
// idle Wi-Fi), and connections can leave through the wrong one.
func overlappingLinkLocal(usable []Iface) []string {
	var names []string
	for _, i := range usable {
		if i.LinkLocal {
			names = append(names, i.Name)
		}
	}
	if len(names) < 2 {
		return nil
	}
	return names
}

// ScanInterfaces lists the connected network cards and their IPv4 addresses, including 169.254.x.x ones.
func ScanInterfaces() IfaceReport {
	var rep IfaceReport
	ifs, err := net.Interfaces()
	if err != nil {
		return rep
	}
	for _, i := range ifs {
		if i.Flags&net.FlagUp == 0 || i.Flags&net.FlagLoopback != 0 {
			continue
		}
		addrs, _ := i.Addrs()
		found := false
		for _, a := range addrs {
			ipnet, ok := a.(*net.IPNet)
			if !ok {
				continue
			}
			if f, ok := makeIface(i.Name, ipnet.IP, ipnet.Mask); ok {
				f.Index = i.Index
				rep.Usable = append(rep.Usable, f)
				found = true
			}
		}
		if !found && i.Flags&net.FlagBroadcast != 0 {
			rep.NoAddress = append(rep.NoAddress, i.Name)
		}
	}
	return rep
}
