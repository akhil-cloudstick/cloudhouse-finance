package settings

import "github.com/gin-gonic/gin"

// RegisterRoutes mounts the settings endpoints under the given group
// (expected to be something like r.Group("/api/v1/settings/api-keys")).
func RegisterRoutes(rg *gin.RouterGroup, h *Handler) {
	rg.GET("", h.List)
	rg.GET("/:category", h.Get)
	rg.PUT("/:category", h.Set)
	rg.DELETE("/:category", h.Delete)
}
