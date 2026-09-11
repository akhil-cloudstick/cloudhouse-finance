package superadmin

import "github.com/gin-gonic/gin"

// RegisterRoutes mounts the superadmin console under the given group (expected
// to be r.Group("/api/v1/superadmin")).
//
// login is public within this group (there is no session yet to check); the
// rest sit behind superAdminAuth — platform.SuperAdminAuthMiddleware — and NOTHING
// else. In particular, no platform.CRUDPermissions call appears anywhere in
// this file: tenant role grants must have no bearing on who can reach these
// routes. See the package doc comment.
func RegisterRoutes(rg *gin.RouterGroup, h *Handler, superAdminAuth gin.HandlerFunc) {
	rg.POST("/login", h.Login)

	protected := rg.Group("")
	protected.Use(superAdminAuth)

	protected.POST("/businesses", h.CreateBusiness)
	protected.GET("/businesses", h.ListBusinesses)
	protected.GET("/businesses/:id", h.GetBusiness)
	protected.POST("/businesses/:id/suspend", h.SuspendBusiness)
	protected.POST("/businesses/:id/reactivate", h.ReactivateBusiness)
	protected.PUT("/businesses/:id/tier", h.ChangeTier)
	protected.PUT("/businesses/:id/expiry", h.AdjustExpiry)

	protected.GET("/tiers", h.ListTiers)
	protected.PUT("/tiers/:id/price", h.SetTierPrice)

	// Branding and entitlements. Same gate as everything above — see the
	// function doc comment on why CRUDPermissions must never appear here.
	protected.GET("/catalogue", h.Catalogue)
	protected.PUT("/businesses/:id/profile", h.UpdateProfile)
	protected.PUT("/businesses/:id/branding", h.SetBranding)
	protected.POST("/businesses/:id/logo", h.SetLogo)
	protected.PUT("/businesses/:id/modules", h.SetModules)
	protected.PUT("/businesses/:id/languages", h.SetLanguages)

	protected.GET("/audit-log", h.ListAuditLog)
}
