package lan

import (
	"encoding/json"
	"net"
	"strconv"
	"time"
)

const (
	// AppTag marks a packet as ours, so other programs' broadcasts on the same port are ignored.
	AppTag       = "cloudhouse-lan"
	protoVersion = 1
)

// Beacon is the small packet every PC broadcasts every few seconds. Phase 0 sends it unsigned, so it says who is
// there but proves nothing; nothing is trusted because of it.
type Beacon struct {
	App     string   `json:"app"`
	V       int      `json:"v"`
	ID      string   `json:"id"`
	Name    string   `json:"name"`
	IPs     []string `json:"ips"`
	Port    int      `json:"port"`
	Version string   `json:"version"`
	TS      int64    `json:"ts"`
	// the main PC this PC knows of: its id and name, and the version number of that choice (higher wins)
	Epoch    int    `json:"epoch"`
	MainID   string `json:"mainId"`
	MainName string `json:"mainName"`
	// Sig proves the PC holds the business key (see key.go); it covers who the PC is and the main PC it announces
	Sig string `json:"sig"`
}

// sigParts are the fields a beacon's signature covers.
func (b Beacon) sigParts() []string {
	return []string{"beacon", b.ID, b.Name, strconv.Itoa(b.Port), strconv.Itoa(b.Epoch), b.MainID, b.MainName}
}

// encodeBeacon builds the packet, signed when this PC has the business key.
func encodeBeacon(b Beacon, key []byte) []byte {
	b.App = AppTag
	b.V = protoVersion
	b.TS = time.Now().Unix()
	if len(key) > 0 {
		b.Sig = sign(key, b.sigParts()...)
	}
	out, _ := json.Marshal(b)
	return out
}

// decodeBeacon returns false for anything that is not a beacon of this app.
func decodeBeacon(data []byte) (Beacon, bool) {
	var b Beacon
	if err := json.Unmarshal(data, &b); err != nil {
		return Beacon{}, false
	}
	if b.App != AppTag || b.V != protoVersion || b.ID == "" || b.Port <= 0 || b.Port > 65535 {
		return Beacon{}, false
	}
	return b, true
}

// sendUDP sends one packet. With a local address the packet leaves through that network card, which is what makes
// a broadcast reach the right cable when the PC has several networks.
func sendUDP(local net.IP, remote *net.UDPAddr, data []byte) error {
	var laddr *net.UDPAddr
	if local != nil {
		laddr = &net.UDPAddr{IP: local}
	}
	c, err := net.DialUDP("udp4", laddr, remote)
	if err != nil {
		return err
	}
	defer c.Close()
	_ = c.SetWriteDeadline(time.Now().Add(time.Second))
	_, err = c.Write(data)
	return err
}
