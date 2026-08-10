package branch

import "github.com/gin-gonic/gin"

// RegisterRoutes mounts the branch endpoints under the given group
// (expected to be something like r.Group("/api/v1/branches")).
func RegisterRoutes(rg *gin.RouterGroup, h *Handler) {
	rg.POST("", h.Create)
	rg.GET("", h.List)
	rg.GET("/:id", h.Get)
	rg.PUT("/:id", h.Update)
	rg.DELETE("/:id", h.Delete)
}
