package personalloan

import (
	"github.com/gin-gonic/gin"

	"cloudhouse/backend/internal/platform"
)

// RegisterRoutes mounts the personal-loan endpoints under the given group
// (expected to be r.Group("/api/v1/personal-loans")). perms gates each verb
// by CRUD action against the "personalloans" resource (see
// platform.CRUDPermissions). Payment collection, renewal and its preview are
// all state-changing actions on an existing loan, so they gate on
// perms.Update — matching how internal/loan gates RecordPayment/Approve.
func RegisterRoutes(rg *gin.RouterGroup, h *Handler, perms platform.CRUDMiddlewares) {
	rg.POST("", perms.Create, h.Create)
	rg.GET("", perms.Read, h.List)
	rg.GET("/by-number/:number", perms.Read, h.ByNumber)
	rg.GET("/:id", perms.Read, h.Get)
	rg.GET("/:id/schedule", perms.Read, h.Schedule)
	rg.GET("/:id/payments", perms.Read, h.Payments)
	rg.GET("/:id/history", perms.Read, h.History)
	rg.GET("/:id/bond", perms.Read, h.DownloadBond)
	rg.POST("/:id/payments", perms.Update, h.RecordPayment)
	rg.POST("/:id/renewal-preview", perms.Update, h.RenewalPreview)
	rg.POST("/:id/renew", perms.Update, h.Renew)
	// Stage permission (workflow.FlowPersonalLoan) is checked in the service.
	rg.POST("/:id/approve", perms.Update, h.Approve)
	rg.GET("/:id/approvals", perms.Read, h.Approvals)
}
