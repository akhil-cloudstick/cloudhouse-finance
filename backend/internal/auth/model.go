// Package auth implements employee login, forgot/reset password, and the
// "who am I" endpoint on top of the employee domain's Username/Phone/
// PasswordHash fields (see internal/employee/model.go). Login identifies
// an employee by Username OR Phone (never Email) plus Password; a
// forgotten password is reset via a 6-digit OTP sent by SMS to the
// employee's Phone (see platform.SMSSender), not an emailed link. JWT
// issuing/parsing lives in internal/platform (platform/jwt.go) to avoid an
// import cycle with AuthMiddleware, which also needs to parse tokens (see
// platform/middleware.go).
package auth

// LoginInput is the JSON body accepted by POST /auth/login. Identifier is
// matched against either the employee's Username or Phone.
type LoginInput struct {
	Identifier string `json:"identifier" binding:"required"`
	Password   string `json:"password" binding:"required"`
}

// ForgotPasswordInput is the JSON body accepted by POST /auth/forgot-password.
type ForgotPasswordInput struct {
	Phone string `json:"phone" binding:"required"`
}

// ResetPasswordInput is the JSON body accepted by POST /auth/reset-password.
// OTP is the 6-digit code texted to Phone by ForgotPassword.
type ResetPasswordInput struct {
	Phone       string `json:"phone" binding:"required"`
	OTP         string `json:"otp" binding:"required"`
	NewPassword string `json:"newPassword" binding:"required"`
}
