// Package auth implements employee login, forgot/reset password, and the
// "who am I" endpoint on top of the employee domain's Email/PasswordHash
// fields (see internal/employee/model.go). JWT issuing/parsing lives in
// internal/platform (platform/jwt.go) to avoid an import cycle with
// AuthMiddleware, which also needs to parse tokens (see
// platform/middleware.go).
package auth

// LoginInput is the JSON body accepted by POST /auth/login.
type LoginInput struct {
	Email    string `json:"email" binding:"required"`
	Password string `json:"password" binding:"required"`
}

// ForgotPasswordInput is the JSON body accepted by POST /auth/forgot-password.
type ForgotPasswordInput struct {
	Email string `json:"email" binding:"required"`
}

// ResetPasswordInput is the JSON body accepted by POST /auth/reset-password.
type ResetPasswordInput struct {
	Token       string `json:"token" binding:"required"`
	NewPassword string `json:"newPassword" binding:"required"`
}
