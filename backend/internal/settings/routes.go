package settings

import (
	"github.com/gin-gonic/gin"

	"cloudhouse/backend/internal/platform"
)

// RegisterRoutes mounts the settings endpoints under the given group
// (expected to be something like r.Group("/api/v1/settings/api-keys")).
// perms gates each verb by CRUD action against the "settings" resource —
// deliberately gated since this holds sensitive integration API keys.
//
// moduleGate is platform.RequireTenantModule for the "settings" optional
// module, applied to the WHOLE group including reads. Unlike branches, this
// page is self-contained: nothing else in the app reads the integration keys
// through this API, so hiding it hides a feature rather than breaking one.
func RegisterRoutes(rg *gin.RouterGroup, h *Handler, perms platform.CRUDMiddlewares, moduleGate gin.HandlerFunc) {
	rg.Use(moduleGate)

	rg.GET("", perms.Read, h.List)
	rg.GET("/:category", perms.Read, h.Get)
	rg.PUT("/:category", perms.Update, h.Set)
	rg.DELETE("/:category", perms.Delete, h.Delete)
}
