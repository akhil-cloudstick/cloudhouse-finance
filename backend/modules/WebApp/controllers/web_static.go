package controllers

import (
	"cloudhouse/backend/auth"
	common "cloudhouse/backend/common/controllers"
	"net/http"
	"os"
	"path/filepath"
	"strings"

	"github.com/labstack/echo/v4"
)

var mimeTypes = map[string]string{
	".html":  "text/html; charset=utf-8",
	".css":   "text/css",
	".js":    "text/javascript",
	".mjs":   "text/javascript",
	".json":  "application/json",
	".jpeg":  "image/jpeg",
	".jpg":   "image/jpeg",
	".png":   "image/png",
	".svg":   "image/svg+xml",
	".ico":   "image/x-icon",
	".woff":  "font/woff",
	".woff2": "font/woff2",
	".txt":   "text/plain",
}

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
	"ledger-bank": true, "ledger-customer": true, "ledger-branch": true, "ledger-category": true,
	"cash-ledger": true, "upi-ledger": true, "bank-transfer-ledger": true, "cheque-ledger": true,
	"party-bank": true, "party-customer": true, "party-category": true,
	"roles-permissions": true,
	"billing":           true, "settings": true,
}

var webRoot string

func resolveWebApp(urlPath string) string {
	clean := strings.TrimRight(urlPath, "/")
	if clean == "" {
		clean = "/"
	}
	base := filepath.Join(webRoot,
		filepath.FromSlash(clean))
	base = filepath.Clean(base)
	// Path traversal guard: resolved path must stay under root.
	if !strings.HasPrefix(base, webRoot) {
		return ""
	}
	if clean == "/" {
		candidate := filepath.Join(webRoot,
			"index.html")
		if isFile(candidate) {
			return candidate
		}
		return ""
	}
	candidates := []string{base, base + ".html", filepath.Join(base, "index.html")}
	for _, c := range candidates {
		if isFile(c) {
			return c
		}
	}
	if page := sluggedPage(clean); page != "" {
		candidate := filepath.Join(webRoot,
			page)
		if isFile(candidate) {
			return candidate
		}
	}
	return ""
}

func sluggedPage(clean string) string {
	parts := strings.Split(strings.TrimPrefix(clean, "/"), "/")
	if len(parts) == 0 || parts[0] == "" {
		return ""
	}
	if len(parts) > 3 {
		return ""
	}
	if isBusinessSlug(parts[0]) && !isReservedSegment(parts[0]) {
		parts = parts[1:]
		if len(parts) == 0 {
			return "app.html"
		}
	} else if len(parts) > 2 {
		return ""
	}
	switch parts[0] {
	case "login":
		if len(parts) != 1 {
			return ""
		}
		return "login.html"
	case "reset":
		if len(parts) != 1 {
			return ""
		}
		return "reset.html"
	case "superadmin":
		if len(parts) == 1 {
			return "superadmin.html"
		}
		if len(parts) == 2 && parts[1] == "login" {
			return "superadmin/login.html"
		}
		return ""
	}
	if appRoutes[parts[0]] {
		return "app.html"
	}
	return ""
}

func isReservedSegment(s string) bool {
	if appRoutes[s] {
		return true
	}
	switch s {
	case "login", "reset", "api", "uploads", "assets", "static", "_next",
		"favicon.ico", "index", "app", "superadmin", "forgot-password",
		"reset-password", "digilocker-callback", "esign-callback", "customer-app", "staff-app",
		"landing", "privacy-policy", "support", "terms",
		"account-deletion", "terms-and-conditions", "disclaimer", "refund-policy", "data-safety", "contact":
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

func isFile(p string) bool {
	info, err := os.Stat(p)
	return err == nil && !info.IsDir()
}

func isSuperAdminHost(host string) bool {
	h := common.NormalizeHost(host)
	if h == "" || common.BaseDomain == "" {
		return false
	}
	return h == "superadmin."+common.BaseDomain
}

/* The public marketing page (frontend/app/(landing)) is exported as
 * landing.html. It is shown at "/" ONLY on the hosts named in LANDING_HOSTS
 * (comma separated, default: the apex and www of cloudhousefinance.com) so a
 * tenant subdomain can never show the vendor's page — a business must only
 * see its own identity. Every other host keeps the old "/" behaviour. */
var landingHosts = parseLandingHosts(os.Getenv("LANDING_HOSTS"))

func parseLandingHosts(raw string) map[string]bool {
	if strings.TrimSpace(raw) == "" {
		raw = "cloudhousefinance.com,www.cloudhousefinance.com"
	}
	hosts := map[string]bool{}
	for _, h := range strings.Split(raw, ",") {
		if n := common.NormalizeHost(strings.TrimSpace(h)); n != "" {
			hosts[n] = true
		}
	}
	return hosts
}

func isLandingHost(host string) bool {
	return landingHosts[common.NormalizeHost(host)]
}

func isLandingPath(urlPath string) bool {
	clean := strings.TrimRight(urlPath, "/")
	return clean == "/landing" || strings.HasPrefix(clean, "/landing/")
}

func rewriteForLandingHost(urlPath string) string {
	if strings.TrimRight(urlPath, "/") == "" {
		return "/landing"
	}
	return urlPath
}

func isSuperAdminPath(urlPath string) bool {
	clean := strings.TrimRight(urlPath, "/")
	if clean == "" {
		clean = "/"
	}
	return clean == "/superadmin" || strings.HasPrefix(clean, "/superadmin/")
}

func rewriteForSuperAdminHost(urlPath string) string {
	clean := strings.TrimRight(urlPath, "/")
	if clean == "" {
		clean = "/"
	}
	switch clean {
	case "/":
		return "/superadmin"
	case "/login":
		return "/superadmin/login"
	default:
		return urlPath
	}
}

// cleanSuperAdminURL returns the clean superadmin-subdomain URL for an old
// /superadmin page URL, or "" when the path needs no redirect.
func cleanSuperAdminURL(urlPath string) string {
	switch strings.TrimRight(urlPath, "/") {
	case "/superadmin":
		return "/"
	case "/superadmin/login":
		return "/login"
	}
	return ""
}

func Register(router *echo.Echo, root string) {
	abs, err := filepath.Abs(root)
	if err != nil {
		abs = root
	}
	webRoot = abs
	router.RouteNotFound("/*", func(c echo.Context) error {
		if c.Request().Method != http.MethodGet && c.Request().Method != http.MethodHead {
			return c.JSON(http.StatusNotFound, echo.Map{"success": false, "error": "not found"})
		}
		if strings.HasPrefix(c.Request().URL.Path, "/api/") {
			return c.JSON(http.StatusNotFound, echo.Map{"success": false, "error": "not found"})
		}
		host, _ := auth.RequestHostFromContext(c.Request().Context())
		urlPath := c.Request().URL.Path
		switch {
		case isSuperAdminHost(host):
			// The subdomain already says "superadmin": send old /superadmin URLs to the clean ones.
			if clean := cleanSuperAdminURL(urlPath); clean != "" {
				if q := c.Request().URL.RawQuery; q != "" {
					clean += "?" + q
				}
				return c.Redirect(http.StatusMovedPermanently, clean)
			}
			urlPath = rewriteForSuperAdminHost(urlPath)
		case isLandingHost(host):
			urlPath = rewriteForLandingHost(urlPath)
		case isSuperAdminPath(urlPath), isLandingPath(urlPath):
			notFound := filepath.Join(webRoot,
				"404.html")
			if body, err := os.ReadFile(notFound); err == nil {
				return c.Blob(http.StatusNotFound, "text/html; charset=utf-8", body)
			}
			return c.String(http.StatusNotFound, "Not found")
		}
		file := resolveWebApp(urlPath)
		if file == "" {
			notFound := filepath.Join(webRoot,
				"404.html")
			if body, err := os.ReadFile(notFound); err == nil {
				return c.Blob(http.StatusNotFound, "text/html; charset=utf-8", body)
			}
			return c.String(http.StatusNotFound, "Not found")
		}
		ext := strings.ToLower(filepath.Ext(file))
		if ct, ok := mimeTypes[ext]; ok {
			c.Response().Header().Set("Content-Type", ct)
		}
		if ext == ".html" {
			c.Response().Header().Set("Cache-Control", "no-cache")
		} else {
			c.Response().Header().Set("Cache-Control", "public, max-age=86400")
		}
		return c.File(file)
	})
}
