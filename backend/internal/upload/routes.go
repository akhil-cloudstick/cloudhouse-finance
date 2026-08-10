package upload

import "github.com/gin-gonic/gin"

// RegisterRoutes mounts the upload endpoint under the given group (expected
// to be something like r.Group("/api/v1/uploads")).
func RegisterRoutes(rg *gin.RouterGroup, h *Handler) {
	rg.POST("", h.Upload)
}
