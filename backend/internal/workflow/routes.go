package workflow

import (
	"github.com/gin-gonic/gin"
)

// RegisterRoutes mounts the approval-workflow endpoints under rg (expected
// to be protected.Group("/approval-workflow")). Reading needs only a valid
// token — every client draws its stage trackers and approve buttons from
// it. Writing is gated by update, the same "can update role" permission
// that edits role grants on the Roles & Permissions screen.
func RegisterRoutes(rg *gin.RouterGroup, h *Handler, update gin.HandlerFunc) {
	rg.GET("", h.List)
	rg.PUT("/:flow", update, h.Update)
}
