package upload

import (
	"github.com/gin-gonic/gin"

	"ambikagold/backend/internal/platform"
)

// RegisterRoutes mounts the upload endpoint under the given group (expected
// to be something like r.Group("/api/v1/uploads")). perms gates the verb by
// CRUD action against the "uploads" resource.
func RegisterRoutes(rg *gin.RouterGroup, h *Handler, perms platform.CRUDMiddlewares) {
	rg.POST("", perms.Create, h.Upload)
}
