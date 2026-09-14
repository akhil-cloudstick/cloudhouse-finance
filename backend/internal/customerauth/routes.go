package customerauth

import "github.com/gin-gonic/gin"

// RegisterRoutes mounts the customer auth endpoints under the given group
// (expected to be r.Group("/api/v1/customer/auth")). request-otp,
// verify-otp, and device-login are public (that's the point of them —
// they're how a session JWT is obtained in the first place); register-device
// and refresh require an already-valid customer session JWT, so
// customerAuthMiddleware is applied to them specifically here, the same
// pattern internal/auth/routes.go uses for /auth/me.
func RegisterRoutes(rg *gin.RouterGroup, h *Handler, customerAuth ...gin.HandlerFunc) {
	rg.POST("/request-otp", h.RequestOTP)
	rg.POST("/verify-otp", h.VerifyOTP)
	rg.POST("/device-login", h.DeviceLogin)
	rg.POST("/register-device", append(append([]gin.HandlerFunc{}, customerAuth...), h.RegisterDevice)...)
	rg.POST("/refresh", append(append([]gin.HandlerFunc{}, customerAuth...), h.Refresh)...)
}
