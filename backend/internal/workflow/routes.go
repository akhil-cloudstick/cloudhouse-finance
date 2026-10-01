package workflow

import (
	"github.com/gin-gonic/gin"
)

// RegisterRoutes mounts the approval-workflow endpoints under rg (expected
// to be protected.Group("/approval-workflow")). Reading the resolved flows
// needs only a valid token — every client draws its stage trackers and
// approve buttons from it. The admin screen's category view is gated by
// view ("can view role and permission") and writes by update ("can update
// role"), the same grants as the rest of the Roles & Permissions screen.
func RegisterRoutes(rg *gin.RouterGroup, h *Handler, view, update gin.HandlerFunc) {
	rg.GET("", h.List)
	rg.GET("/categories", view, h.Categories)
	rg.PUT("/categories/:category", update, h.UpdateCategory)
}
