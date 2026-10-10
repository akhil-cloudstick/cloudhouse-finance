package controllers

import (
	"strconv"
	"strings"
)

func splitCSV(v string) []string {
	var out []string
	for _, p := range strings.Split(v, ",") {
		if p = strings.TrimSpace(p); p != "" {
			out = append(out, p)
		}
	}
	return out
}

func parseUintCSV(v string) []uint {
	var out []uint
	for _, p := range splitCSV(v) {
		if id, err := strconv.ParseUint(p, 10, 64); err == nil {
			out = append(out, uint(id))
		}
	}
	return out
}
