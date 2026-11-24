package controllers

import (
	"strconv"
	"strings"
)

func parseUintCSV(v string) []uint {
	var out []uint
	for _, p := range strings.Split(v, ",") {
		if id, err := strconv.ParseUint(strings.TrimSpace(p), 10, 64); err == nil {
			out = append(out, uint(id))
		}
	}
	return out
}
