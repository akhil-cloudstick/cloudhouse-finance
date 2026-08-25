package auth

import "github.com/gin-gonic/gin"

// RegisterRoutes mounts the auth endpoints under the given group (expected
// to be r.Group("/api/v1/auth")). login/forgot-password/reset-password are
// public by design (that's the point of them); /me requires a valid JWT, so
// the caller must apply authMiddleware to it specifically — main.go wraps
// the rest of /api/v1 in AuthMiddleware but explicitly excludes /auth/*, so
// /me needs its own middleware applied here.
func RegisterRoutes(rg *gin.RouterGroup, h *Handler, authMiddleware gin.HandlerFunc) {
	rg.POST("/login", h.Login)
	rg.POST("/forgot-password", h.ForgotPassword)
	rg.POST("/reset-password", h.ResetPassword)
	rg.GET("/me", authMiddleware, h.Me)
}
