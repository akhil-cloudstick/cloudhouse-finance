package billing

import (
	"github.com/gin-gonic/gin"

	"cloudhouse/backend/internal/platform"
)

// RegisterRoutes mounts the tenant-facing billing endpoints under the given
// group (expected to be r.Group("/billing"), inside the authenticated
// employee group). Gated by the single "can manage billing" permission
// (Administrator-only, per authz.Restrictions) rather than
// platform.CRUDPermissions — there is no create/update/delete resource
// here, just three related actions on one business's own subscription.
//
// The public Razorpay webhook is intentionally NOT registered here — see
// its own mount site in app.go, outside the authenticated group entirely.
func RegisterRoutes(rg *gin.RouterGroup, h *Handler, checker platform.PermissionChecker) {
	manage := platform.RequirePermission(checker, "can manage billing")
	rg.GET("/status", manage, h.Status)
	rg.POST("/subscribe", manage, h.Subscribe)
	rg.POST("/confirm", manage, h.Confirm)
}
