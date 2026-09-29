// Package webstatic serves the built Next.js static export
// (frontend/out — output: 'export') from the Go binary, mirroring the
// clean-URL resolution and MIME handling that backend/server.mjs (the
// legacy Node static server) already implements. This lets cmd/api serve
// both the REST API and the admin web app on a single port, per
// documents/architecture.md.
package webstatic

import (
	"net/http"
	"os"
	"path/filepath"
	"strings"

	"github.com/gin-gonic/gin"

	"cloudhouse/backend/internal/platform"
	"cloudhouse/backend/internal/platform/httpx"
	"cloudhouse/backend/internal/tenant"
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

// Handler serves files out of root, resolving Next.js "clean URL" style
// paths the same way a static host would:
//
//	/            -> index.html
//	/ctfi/loans  -> app.html (the console, which reads the path itself)
//	/whatever.js -> whatever.js (exact asset)
//
// Falls back to 404.html (if present) for anything unresolved.
type Handler struct {
	root string
}

// New returns a Handler rooted at the given directory (the Next.js static
// export folder, e.g. "../frontend/out"). If root doesn't exist, routes
// registered with Register will 404 for everything — the API itself still
// works fine without a frontend build present.
func New(root string) *Handler {
	abs, err := filepath.Abs(root)
	if err != nil {
		abs = root
	}
	return &Handler{root: abs}
}

// resolve mirrors server.mjs's resolveFile: returns the on-disk file to
// serve for a given URL path, or "" if nothing matches.
func (h *Handler) resolve(urlPath string) string {
	clean := strings.TrimRight(urlPath, "/")
	if clean == "" {
		clean = "/"
	}

	base := filepath.Join(h.root, filepath.FromSlash(clean))
	base = filepath.Clean(base)
	// Path traversal guard: resolved path must stay under root.
	if !strings.HasPrefix(base, h.root) {
		return ""
	}

	if clean == "/" {
		candidate := filepath.Join(h.root, "index.html")
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

	// Per-business links: /<slug>/login and /<slug>/<route> serve the login
	// page and the app shell, which read the business and the page from their
	// own URL.
	//
	// Nothing matches them on disk, and nothing can: the frontend builds with
	// Next's output: "export", where a dynamic route needs every parameter
	// known at build time, and tenant slugs are created at runtime by the
	// vendor. So the fallback lives here instead. `next dev` does the same
	// thing with a rewrite (see frontend/next.config.ts) — keep the two in
	// step, because a path that works in dev and 404s in production is worse
	// than one that never worked.
	//
	// This resolves the PAGE only. The slug grants nothing: the business is
	// established from the session token, and a signed-in user who edits the
	// slug in the address bar still sees exactly their own business's data.
	if page := sluggedPage(clean); page != "" {
		candidate := filepath.Join(h.root, page)
		if isFile(candidate) {
			return candidate
		}
	}
	return ""
}

// sluggedPage maps a per-business URL to the static page that serves it, and
// returns "" for anything it does not recognise.
//
// The URL shape is business-first — the code leads the path and the page
// follows it:
//
//	/ctfi/login          -> login.html
//	/ctfi/reset          -> reset.html
//	/ctfi                -> app.html
//	/ctfi/dashboard      -> app.html
//	/ctfi/loan/GL-1001   -> app.html
//	/dashboard           -> app.html   (the single-business install)
//
// The console is ONE static document for every route, because a static export
// has no per-route HTML to serve and tenant slugs are created at runtime, so
// there is no list of paths to pre-render. The document reads the path back
// and renders the right page — see frontend/hooks/useAppRoute.ts.
//
// This resolves the PAGE only. The slug grants nothing: the business is
// established from the session token, and a signed-in user who edits the slug
// in the address bar still sees exactly their own business's data.
//
// Keep in step with frontend/next.config.ts's rewrites, which do the same job
// under `next dev`, and with frontend/common/config/routes.ts, which is where
// appRoutes and isBusinessSlug below take their vocabulary from.
func sluggedPage(clean string) string {
	parts := strings.Split(strings.TrimPrefix(clean, "/"), "/")
	if len(parts) == 0 || parts[0] == "" {
		return ""
	}
	// Deeper than /<slug>/<route>/<arg> is not part of the link design and
	// should keep 404ing rather than silently serving the app shell — a
	// fallback that is too eager stops being a fallback and hides real 404s.
	if len(parts) > 3 {
		return ""
	}

	// A leading business code is optional: the single-business install reaches
	// the same pages without one.
	if isBusinessSlug(parts[0]) && !isReservedSegment(parts[0]) {
		parts = parts[1:]
		if len(parts) == 0 {
			return "app.html" // /ctfi alone -> the console's landing page
		}
	} else if len(parts) > 2 {
		// No business code, so at most /<route>/<arg> can follow.
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
		// The super admin console — a separate app/superadmin/* route tree
		// (frontend/superadmin), never part of a business's own app shell.
		// /superadmin never carries a business code ahead of it (it is
		// reserved, see isReservedSegment), so parts here is exactly what the
		// browser sent.
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

// appRoutes is every page the console can show, and therefore every word that
// may appear where a route is expected. It exists so that "/ctfi/loans" (the
// loans page) can be told apart from "/ctfi/nonsense" (a 404), and so that a
// business can never be coded with a word that would shadow a page.
//
// Mirrors APP_ROUTES in frontend/common/config/routes.ts. A route added there
// and not here is reachable in dev and 404s in production.
var appRoutes = map[string]bool{
	"dashboard": true, "customers": true, "customer": true,
	"loans": true, "loan": true, "newloan": true,
	"schemes": true, "goldrates": true, "requests": true,
	"loanrisk": true, "personalloans": true, "personalloan": true,
	"investments": true, "investment": true, "cash": true,
	"auctions": true, "packets": true, "packet": true,
	"bankpledge": true, "reports": true, "employees": true,
	"calendar": true, "branches": true, "banks": true,
	"party-bank": true, "party-customer": true, "roles-permissions": true,
	"billing": true, "settings": true,
}

// isReservedSegment reports whether a first path segment can never name a
// business. That is the cost of putting the code first: "/loans" is either a
// business called "loans" or the bare install's loans page, and only a list
// can decide. Mirrors RESERVED_ROOT_SEGMENTS in
// frontend/common/config/routes.ts, which also refuses to let such a code be
// created in the first place.
func isReservedSegment(s string) bool {
	if appRoutes[s] {
		return true
	}
	switch s {
	case "login", "reset", "api", "uploads", "assets", "static", "_next",
		"favicon.ico", "index", "app", "superadmin", "forgot-password",
		"reset-password", "digilocker-callback", "esign-callback":
		return true
	}
	return false
}

// isBusinessSlug mirrors the frontend's slug rule (lowercase alphanumerics
// and dashes — see frontend/common/services/tenantSession.ts).
//
// Validated rather than accepted as-is so a stray path segment is not treated
// as a business, and so this can never be turned into a way to reach a file:
// the slug is only ever compared, never joined onto a path.
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

// isSuperAdminHost reports whether host IS the platform's own reserved
// superadmin subdomain (e.g. "superadmin.cloudhousesupport.site").
//
// tenant.SubdomainLabel cannot answer this: it deliberately returns ok=false
// for every RESERVED label — "superadmin" included, see
// tenant.ReservedHostLabels — because a reserved label never names a
// business, which is exactly right for tenant resolution. This handler needs
// the opposite question answered ("is this host that one specific reserved
// subdomain") so it repeats SubdomainLabel's own host comparison
// (tenant.NormalizeHost against "."+tenant.BaseDomain) rather than reusing
// its boolean, which cannot tell "superadmin" apart from any other host that
// simply matches no business either (an IP, localhost, the shared API
// domain).
func isSuperAdminHost(host string) bool {
	h := tenant.NormalizeHost(host)
	if h == "" || tenant.BaseDomain == "" {
		return false
	}
	return h == "superadmin."+tenant.BaseDomain
}

// isSuperAdminPath reports whether urlPath is /superadmin itself or anything
// under it.
func isSuperAdminPath(urlPath string) bool {
	clean := strings.TrimRight(urlPath, "/")
	if clean == "" {
		clean = "/"
	}
	return clean == "/superadmin" || strings.HasPrefix(clean, "/superadmin/")
}

// rewriteForSuperAdminHost maps the bare paths the superadmin console is
// reached at ON ITS OWN SUBDOMAIN onto the paths sluggedPage already knows how
// to serve, so that host carries no /superadmin segment in its URL at all.
//
// Only "/" and "/login" are rewritten. Everything else — a real asset under
// /_next/..., or /superadmin and /superadmin/login typed directly, which keep
// working exactly as before — passes through untouched into the normal
// resolution below.
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

// Register mounts the static handler as Gin's catch-all NoRoute handler.
// It only serves GET/HEAD requests to non-API paths, so JSON 404s from the
// REST API (e.g. GET /api/v1/schemes/999) are unaffected.
func Register(router *gin.Engine, root string) {
	h := New(root)

	router.NoRoute(func(c *gin.Context) {
		if c.Request.Method != http.MethodGet && c.Request.Method != http.MethodHead {
			httpx.Fail(c, http.StatusNotFound, "not found")
			return
		}
		if strings.HasPrefix(c.Request.URL.Path, "/api/") {
			httpx.Fail(c, http.StatusNotFound, "not found")
			return
		}

		// The superadmin console is reserved to its own subdomain: reachable
		// with no /superadmin segment at all on THAT host, and reachable from
		// NOWHERE else — not even /superadmin typed explicitly on a tenant's
		// own subdomain. See internal/tenant/host.go's ReservedHostLabels.
		//
		// Read via platform.RequestHostFromContext (populated by
		// platform.CarryRequestHost, mounted globally ahead of NoRoute) rather
		// than c.Request.Host directly, for the same one-directional-trust
		// reasoning already documented there and in tenant.FindByAppURL: this
		// only ever narrows which bundle is served, never grants anything —
		// the console's own auth still gates every API call it makes.
		host, _ := platform.RequestHostFromContext(c.Request.Context())
		urlPath := c.Request.URL.Path
		switch {
		case isSuperAdminHost(host):
			urlPath = rewriteForSuperAdminHost(urlPath)
		case isSuperAdminPath(urlPath):
			notFound := filepath.Join(h.root, "404.html")
			if body, err := os.ReadFile(notFound); err == nil {
				c.Data(http.StatusNotFound, "text/html; charset=utf-8", body)
				return
			}
			c.String(http.StatusNotFound, "Not found")
			return
		}

		file := h.resolve(urlPath)
		if file == "" {
			notFound := filepath.Join(h.root, "404.html")
			if body, err := os.ReadFile(notFound); err == nil {
				c.Data(http.StatusNotFound, "text/html; charset=utf-8", body)
				return
			}
			c.String(http.StatusNotFound, "Not found")
			return
		}

		ext := strings.ToLower(filepath.Ext(file))
		if ct, ok := mimeTypes[ext]; ok {
			c.Header("Content-Type", ct)
		}
		if ext == ".html" {
			c.Header("Cache-Control", "no-cache")
		} else {
			c.Header("Cache-Control", "public, max-age=86400")
		}
		c.File(file)
	})
}
