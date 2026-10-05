package main

import "strings"

// Mirrors backend/internal/webstatic sluggedPage; keep the two in step.
var appRoutes = map[string]bool{
	"dashboard": true, "customers": true, "customer": true,
	"loans": true, "loan": true, "newloan": true,
	"schemes": true, "goldrates": true, "requests": true,
	"loanrisk": true, "personalloans": true, "personalloan": true,
	"investments": true, "investment": true, "ledger": true,
	"cash":     true,
	"auctions": true, "packets": true, "packet": true,
	"bankpledge": true, "reports": true, "employees": true,
	"calendar": true, "branches": true, "banks": true,
	"ledger-bank": true, "ledger-customer": true, "ledger-category": true,
	"cash-ledger": true, "upi-ledger": true, "bank-transfer-ledger": true, "cheque-ledger": true,
	"party-bank": true, "party-customer": true, "party-category": true,
	"roles-permissions": true,
	"billing":           true, "settings": true,
}

var standalonePages = map[string]bool{
	"forgot-password": true, "reset-password": true,
	"digilocker-callback": true, "esign-callback": true,
}

func isReservedSegment(s string) bool {
	if appRoutes[s] || standalonePages[s] {
		return true
	}
	switch s {
	case "login", "reset", "api", "uploads", "assets", "static", "_next",
		"favicon.ico", "index", "app", "superadmin":
		return true
	}
	return false
}

func isBusinessSlug(s string) bool {
	if s == "" || len(s) > 60 {
		return false
	}
	for i, r := range s {
		switch {
		case r >= 'a' && r <= 'z', r >= '0' && r <= '9':
		case r == '-' && i > 0:
		default:
			return false
		}
	}
	return true
}

// pageFor maps a URL path to the exported page that serves it, or "" for a 404.
func pageFor(urlPath string) string {
	clean := strings.Trim(urlPath, "/")
	if clean == "" {
		return ""
	}
	parts := strings.Split(clean, "/")
	if len(parts) > 3 {
		return ""
	}

	hasSlug := isBusinessSlug(parts[0]) && !isReservedSegment(parts[0])
	if hasSlug {
		parts = parts[1:]
		if len(parts) == 0 {
			return "app.html"
		}
	} else if len(parts) > 2 {
		return ""
	}

	switch parts[0] {
	case "login", "reset":
		if len(parts) != 1 {
			return ""
		}
		return parts[0] + ".html"
	}
	if !hasSlug && standalonePages[parts[0]] && len(parts) == 1 {
		return parts[0] + ".html"
	}
	if appRoutes[parts[0]] {
		return "app.html"
	}
	return ""
}
