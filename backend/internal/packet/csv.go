package packet

import (
	"strconv"
	"strings"
)

// splitCSV splits a comma-separated query value into trimmed, non-empty parts
// (the Packets page's multi-select filters send several values this way).
func splitCSV(v string) []string {
	var out []string
	for _, p := range strings.Split(v, ",") {
		if p = strings.TrimSpace(p); p != "" {
			out = append(out, p)
		}
	}
	return out
}

// parseUintCSV is splitCSV for numeric ids; unparseable parts are dropped.
func parseUintCSV(v string) []uint {
	var out []uint
	for _, p := range splitCSV(v) {
		if id, err := strconv.ParseUint(p, 10, 64); err == nil {
			out = append(out, uint(id))
		}
	}
	return out
}
