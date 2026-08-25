package dashboard

import (
	"github.com/gin-gonic/gin"

	"ambikagold/backend/internal/platform"
)

// RegisterRoutes mounts the dashboard aggregation endpoints under rg
// (expected to be r.Group("/api/v1/dashboard")). Gated by the same "can
// view loan" permission the underlying loan/request rows are already gated
// by everywhere else — this package only re-shapes and paginates rows the
// caller could otherwise already read loan-by-loan/request-by-request.
func RegisterRoutes(rg *gin.RouterGroup, h *Handler, perms platform.CRUDMiddlewares) {
	rg.GET("/needs-attention", perms.Read, h.NeedsAttention)
}
