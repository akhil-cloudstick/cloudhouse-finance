package branding

import "github.com/gin-gonic/gin"

// RegisterPublicRoutes mounts the unauthenticated reads (expected group:
// r.Group("/api/v1/public")).
//
// These carry NO middleware at all, which is the point — a login page has no
// session yet. See the package doc for why that is safe here and is not in
// internal/upload.
func RegisterPublicRoutes(rg *gin.RouterGroup, h *Handler) {
	// No :code — resolves the tenant from the request's own subdomain
	// instead (see Handler.PublicBrandingByHost). Registered before the
	// :code routes below only for readability; gin's router does not care
	// about registration order between a literal and a distinct pattern.
	rg.GET("/branding", h.PublicBrandingByHost)
	rg.GET("/branding/:code", h.PublicBranding)
	rg.GET("/branding/:code/logo", h.PublicLogo)
	// The staff mobile app redeeming the short code shown in the web
	// dashboard's "Connect mobile app" modal (see connect.go).
	rg.GET("/connect/:code", h.RedeemConnectCode)
}

// RegisterRoutes mounts the signed-in read (expected group:
// r.Group("/api/v1/branding") already carrying AuthMiddleware).
//
// No CRUDPermissions: every employee of a business needs its logo, colour and
// enabled modules to render the app at all, so gating this behind a grant
// would mean a role could be configured into a blank application.
func RegisterRoutes(rg *gin.RouterGroup, h *Handler) {
	rg.GET("", h.MyBranding)
	rg.POST("/connect-code", h.IssueConnectCode)
}
