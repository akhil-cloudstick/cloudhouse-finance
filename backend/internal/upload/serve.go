package upload

import (
	"net/http"
	"path/filepath"
	"strings"

	"github.com/gin-gonic/gin"

	"cloudhouse/backend/internal/platform"
	"cloudhouse/backend/internal/platform/httpx"
)

// AuthCookieName carries the session token to file requests.
//
// A cookie rather than the Authorization header, because the browser sends
// it automatically on <img src="/uploads/...">. An <img> tag cannot carry a
// header, and there is no way to make it do so — so a header-only scheme
// would mean rewriting every image in the app to fetch bytes through
// JavaScript. The cookie is HttpOnly (script cannot read it), SameSite=Lax,
// and scoped to the /uploads path so it is never sent to the API, which
// keeps using the header.
//
// A query-string token was the other option and is worse: URLs end up in
// server logs, browser history, and Referer headers on any outbound link.
const AuthCookieName = "cloudhouse_files"

// ServeHandler replaces router.Static("/uploads", ...).
//
// The old mount served every file to anyone who asked, with no login and no
// ownership check. Since files include customer photos and KYC documents,
// that was a privacy problem before multi-tenancy and a cross-business one
// after it.
type ServeHandler struct {
	repo      *Repository
	dir       string
	jwtSecret string
	sessions  platform.EmployeeSessionChecker
}

// NewServeHandler wires sessions in for the same reason AuthMiddleware does
// (Step 8b, token invalidation): the plan explicitly calls out that
// revoking a session must also cover this path-scoped cookie, or a deleted
// employee keeps reading files with an outstanding cookie until it expires.
// A borrower cookie has no analogous "disable a customer" concept in this
// codebase today, so only the staff half is revalidated here.
func NewServeHandler(repo *Repository, dir, jwtSecret string, sessions platform.EmployeeSessionChecker) *ServeHandler {
	return &ServeHandler{repo: repo, dir: dir, jwtSecret: jwtSecret, sessions: sessions}
}

// Serve authenticates the request, resolves the file through the database,
// and only then reads from disk.
//
// The order matters: the path is never used to find the file. The URL
// segment is looked up as an exact StorageKey, and the file is read from a
// path this code builds itself from that row. A request for
// "../../etc/passwd" finds no matching row and stops there — traversal is
// not defended against, it is unreachable.
func (h *ServeHandler) Serve(c *gin.Context) {
	key := strings.TrimPrefix(c.Param("key"), "/")
	if key == "" || strings.ContainsAny(key, `/\`) || key == "." || key == ".." {
		httpx.Fail(c, http.StatusNotFound, "file not found")
		return
	}

	tenantID, ok := h.tenantFromCookie(c)
	if !ok {
		// Not "unauthorized" — a stranger should not learn that a given URL
		// corresponds to a real file.
		httpx.Fail(c, http.StatusNotFound, "file not found")
		return
	}

	ctx := platform.WithTenant(c.Request.Context(), tenantID)
	rec, err := h.repo.FindByStorageKey(ctx, key)
	if err != nil {
		httpx.Fail(c, http.StatusNotFound, "file not found")
		return
	}

	// Content-Type comes from the sniffed value recorded at upload, never
	// from the extension. X-Content-Type-Options stops the browser
	// second-guessing it, which is what turns a mislabelled file into
	// script execution on this origin.
	c.Header("Content-Type", rec.ContentType)
	c.Header("X-Content-Type-Options", "nosniff")
	c.Header("Content-Disposition", "inline; filename=\""+sanitizeHeaderValue(rec.OriginalName)+"\"")
	// Private: these are one business's customer documents. A shared cache
	// must never hold them.
	c.Header("Cache-Control", "private, max-age=300")

	c.File(filepath.Join(h.dir, rec.StorageKey))
}

// tenantFromCookie accepts either a staff or a borrower session, since both
// legitimately view files — staff a customer's KYC document, a borrower
// their own loan paperwork.
func (h *ServeHandler) tenantFromCookie(c *gin.Context) (uint, bool) {
	raw, err := c.Cookie(AuthCookieName)
	if err != nil || raw == "" {
		return 0, false
	}
	if claims, err := platform.ParseToken(raw, h.jwtSecret); err == nil && claims.TenantID != 0 {
		// Revalidated against the live employee row, same as AuthMiddleware
		// — a deleted employee's cookie must stop working immediately, not
		// at its natural expiry (up to JWTExpiry, days by default).
		if _, _, _, ok := h.sessions.CurrentSession(platform.WithTenant(c.Request.Context(), claims.TenantID), claims.EmployeeID); !ok {
			return 0, false
		}
		return claims.TenantID, true
	}
	if claims, err := platform.ParseCustomerToken(raw, h.jwtSecret); err == nil && claims.TenantID != 0 {
		return claims.TenantID, true
	}
	return 0, false
}

// sanitizeHeaderValue strips anything that could break out of the quoted
// filename in Content-Disposition. The original name came from a caller.
func sanitizeHeaderValue(s string) string {
	s = strings.ReplaceAll(s, `"`, "")
	s = strings.ReplaceAll(s, "\r", "")
	s = strings.ReplaceAll(s, "\n", "")
	if s == "" {
		return "file"
	}
	return s
}

// SetAuthCookie is called on successful login so subsequent <img> requests
// carry a session. It mirrors the token the client already holds and grants
// nothing extra — anyone who can read this cookie could already call the API.
//
// Secure is inferred from the request rather than configured, so it is set
// automatically in production and omitted on plain-HTTP local development
// (where a Secure cookie would simply never be sent, and file loading would
// break in a way that looks like a permissions bug).
func SetAuthCookie(c *gin.Context, token string, maxAgeSeconds int) {
	c.SetSameSite(http.SameSiteLaxMode)
	c.SetCookie(AuthCookieName, token, maxAgeSeconds, "/uploads", "", isSecureRequest(c), true)
}

// ClearAuthCookie is called on logout.
func ClearAuthCookie(c *gin.Context) {
	c.SetSameSite(http.SameSiteLaxMode)
	c.SetCookie(AuthCookieName, "", -1, "/uploads", "", isSecureRequest(c), true)
}

// isSecureRequest reports whether the connection reached us over HTTPS,
// including the common case of TLS terminated at a reverse proxy.
func isSecureRequest(c *gin.Context) bool {
	if c.Request.TLS != nil {
		return true
	}
	return strings.EqualFold(c.GetHeader("X-Forwarded-Proto"), "https")
}
