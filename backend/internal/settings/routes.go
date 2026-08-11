package settings

import (
	"github.com/gin-gonic/gin"

	"ambikagold/backend/internal/platform"
)

// RegisterRoutes mounts the settings endpoints under the given group
// (expected to be something like r.Group("/api/v1/settings/api-keys")).
// perms gates each verb by CRUD action against the "settings" resource —
// deliberately gated since this holds sensitive integration API keys.
func RegisterRoutes(rg *gin.RouterGroup, h *Handler, perms platform.CRUDMiddlewares) {
	rg.GET("", perms.Read, h.List)
	rg.GET("/:category", perms.Read, h.Get)
	rg.PUT("/:category", perms.Update, h.Set)
	rg.DELETE("/:category", perms.Delete, h.Delete)
}
