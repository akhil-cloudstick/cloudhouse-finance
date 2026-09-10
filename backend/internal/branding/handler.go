package branding

import (
	"net/http"

	"github.com/gin-gonic/gin"

	"cloudhouse/backend/internal/platform"
	"cloudhouse/backend/internal/platform/httpx"
)

type Handler struct {
	svc *Service
}

func NewHandler(svc *Service) *Handler { return &Handler{svc: svc} }

// PublicBranding answers /public/branding/:code for the login page.
//
// Always 200. An unknown code yields the platform default rather than a 404
// — see the package doc: a 404 would turn this into a business-enumeration
// oracle, which is precisely what auth.Service avoids at login.
func (h *Handler) PublicBranding(c *gin.Context) {
	httpx.Success(c, http.StatusOK, h.svc.PublicByCode(platform.RequestContext(c), c.Param("code")))
}

// PublicLogo streams a business's logo, unauthenticated.
//
// Unlike upload.ServeHandler — which gates every file behind a session
// because those files are customer KYC scans — a logo is public branding by
// definition, so this responds to anyone. What makes that safe is that the
// file is resolved from the tenant row's own LogoStorageKey and never from
// the URL: there is no key parameter here to point somewhere else.
func (h *Handler) PublicLogo(c *gin.Context) {
	path, contentType, err := h.svc.LogoFile(platform.RequestContext(c), c.Param("code"))
	if err != nil {
		httpx.FailErr(c, err)
		return
	}
	// Content-Type is the value sniffed at upload, never guessed from the
	// extension; nosniff stops the browser second-guessing it, which is what
	// turns a mislabelled file into script execution on this origin.
	c.Header("Content-Type", contentType)
	c.Header("X-Content-Type-Options", "nosniff")
	// "public" here where upload/serve.go says "private", and deliberately:
	// this is a logo every visitor to the sign-in page loads. The URL carries
	// the storage key as a cache-buster, so a replaced logo is a new URL and a
	// long max-age never serves a stale one.
	c.Header("Cache-Control", "public, max-age=3600")
	c.File(path)
}

// MyBranding answers /branding for a signed-in employee. The business comes
// from the token; there is no parameter, so asking for another one is not
// expressible.
func (h *Handler) MyBranding(c *gin.Context) {
	rec, err := h.svc.ForTenant(platform.RequestContext(c))
	if err != nil {
		httpx.FailErr(c, err)
		return
	}
	httpx.Success(c, http.StatusOK, rec)
}
