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

	"ambikagold/backend/internal/platform/httpx"
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
//	/app         -> app.html (or app/index.html)
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
	return ""
}

func isFile(p string) bool {
	info, err := os.Stat(p)
	return err == nil && !info.IsDir()
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

		file := h.resolve(c.Request.URL.Path)
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
