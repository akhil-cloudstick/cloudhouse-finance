package customer

import (
	"github.com/gin-gonic/gin"

	"cloudhouse/backend/internal/platform"
)

// RegisterRoutes mounts the customer endpoints under the given group
// (expected to be something like r.Group("/api/v1/customers")). perms gates
// each verb by CRUD action against the "customers" resource.
func RegisterRoutes(rg *gin.RouterGroup, h *Handler, perms platform.CRUDMiddlewares) {
	rg.POST("", perms.Create, h.Create)
	rg.GET("", perms.Read, h.List)
	rg.GET("/:id", perms.Read, h.Get)
	// Full decrypted Aadhaar — only ever returned here, gated at the same
	// elevated bar as the Aadhaar-verify endpoints below. See handler.go's
	// GetAadhaarFull.
	rg.GET("/:id/aadhaar-full", perms.Update, h.GetAadhaarFull)
	rg.PUT("/:id", perms.Update, h.Update)
	rg.POST("/:id/verify-pan", perms.Update, h.VerifyPAN)
	rg.POST("/:id/verify-aadhaar/start", perms.Update, h.StartAadhaarVerify)
	rg.POST("/:id/verify-aadhaar/check", perms.Update, h.CheckAadhaarVerify)
	rg.DELETE("/:id", perms.Delete, h.Delete)
}
