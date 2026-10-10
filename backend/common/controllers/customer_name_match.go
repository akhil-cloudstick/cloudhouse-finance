package controllers

import (
	"strings"
)

func normalizeName(name string) []string {
	var b strings.Builder
	for _, r := range strings.ToLower(name) {
		switch {
		case r >= 'a' && r <= 'z', r == ' ':
			b.WriteRune(r)
		default:
			b.WriteRune(' ')
		}
	}
	return strings.Fields(b.String())
}

func namesMatch(customerName, setuName string) bool {
	a := normalizeName(customerName)
	b := normalizeName(setuName)
	if len(a) == 0 || len(b) == 0 {
		return false
	}
	shorter, longer := a, b
	if len(b) < len(a) {
		shorter, longer = b, a
	}
	longerSet := make(map[string]bool, len(longer))
	for _, tok := range longer {
		longerSet[tok] = true
	}
	for _, tok := range shorter {
		if !longerSet[tok] {
			return false
		}
	}
	return true
}
