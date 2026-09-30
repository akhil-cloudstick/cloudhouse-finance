package branch

import (
	"github.com/gin-gonic/gin"

	"cloudhouse/backend/internal/platform"
)

// RegisterRoutes mounts the branch endpoints under the given group
// (expected to be something like r.Group("/api/v1/branches")). perms gates
// each verb by CRUD action against the "branches" resource.
//
// moduleGate is platform.RequireTenantModule for the "branches" optional
// module, and it is applied to the WRITES ONLY. That split is deliberate and
// is the whole subtlety of gating this module:
//
//   - Turning Branch Management off means a business does not administer its
//     own branches — it does not mean branches stop existing. Reads back the
//     branch dropdown on the new-loan form, the branch column on reports, the
//     cash-book's branch filter and the branch switcher itself, all of which
//     are load-bearing for staff who will never open the management page.
//   - So gating the reads would not hide a feature, it would break the
//     application for every business that has the module switched off.
func RegisterRoutes(rg *gin.RouterGroup, h *Handler, perms platform.CRUDMiddlewares, moduleGate gin.HandlerFunc) {
	rg.POST("", moduleGate, perms.Create, h.Create)
	rg.GET("", perms.Read, h.List)
	// Registered before "/:id" for readability only — gin matches the static
	// segment regardless of order. Answers "which branches may I switch
	// between", which the scoped list above cannot: see Handler.Switchable.
	rg.GET("/switchable", perms.Read, h.Switchable)
	rg.GET("/quota", perms.Read, h.Quota)
	rg.GET("/:id", perms.Read, h.Get)
	rg.PUT("/:id", moduleGate, perms.Update, h.Update)
	rg.DELETE("/:id", moduleGate, perms.Delete, h.Delete)
}
