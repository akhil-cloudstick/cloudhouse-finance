package reminder

import (
	"github.com/gin-gonic/gin"

	"cloudhouse/backend/internal/platform"
)

// RegisterRoutes mounts the reminder endpoints under the given group
// (expected to be r.Group("/api/v1/reminders")). perms gates each verb by
// CRUD action against the "reminders" resource. /calendar and /:id/complete
// are gated by Read/Update respectively, since they're not plain CRUD verbs.
func RegisterRoutes(rg *gin.RouterGroup, h *Handler, perms platform.CRUDMiddlewares) {
	rg.POST("", perms.Create, h.Create)
	rg.GET("", perms.Read, h.List)
	rg.GET("/calendar", perms.Read, h.Calendar)
	rg.GET("/:id", perms.Read, h.Get)
	rg.PUT("/:id", perms.Update, h.Update)
	rg.PUT("/:id/complete", perms.Update, h.Complete)
	rg.PUT("/:id/send-whatsapp", perms.Update, h.SendWhatsApp)
	rg.DELETE("/:id", perms.Delete, h.Delete)
}
