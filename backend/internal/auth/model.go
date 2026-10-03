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

	// BusinessCode identifies which business to authenticate against
	// (tenant.Tenant.Code). Usernames are only unique WITHIN a business, so
	// "ravi" alone is ambiguous once a second business exists.
	//
	// Optional while exactly one business exists, so the existing single
	// installation keeps working unchanged; required as soon as there is
	// more than one. In normal use it arrives from the per-business login
	// URL (/login/<code>) rather than being typed.
	BusinessCode string `json:"businessCode"`
}

// ForgotPasswordInput is the JSON body accepted by POST /auth/forgot-password.
// Username and Phone must both belong to the same employee — a phone number
// alone is not enough to start a reset.
type ForgotPasswordInput struct {
	// BusinessCode — see LoginInput. A phone is only unique within a
	// business, so a reset must know which one it is for.
	BusinessCode string `json:"businessCode"`
	Username     string `json:"username" binding:"required"`
	Phone        string `json:"phone" binding:"required"`
}

// VerifyResetCodeInput is the JSON body accepted by POST
// /auth/verify-reset-code — checks the texted code before the new-password
// step, without consuming it.
type VerifyResetCodeInput struct {
	BusinessCode string `json:"businessCode"`
	Username     string `json:"username" binding:"required"`
	Phone        string `json:"phone" binding:"required"`
	OTP          string `json:"otp" binding:"required"`
}

// ResetPasswordInput is the JSON body accepted by POST /auth/reset-password.
// OTP is the 6-digit code texted to Phone by ForgotPassword.
type ResetPasswordInput struct {
	// BusinessCode — see LoginInput. A phone is only unique within a
	// business, so a reset must know which one it is for.
	BusinessCode string `json:"businessCode"`
	Username     string `json:"username" binding:"required"`
	Phone        string `json:"phone" binding:"required"`
	OTP          string `json:"otp" binding:"required"`
	NewPassword  string `json:"newPassword" binding:"required"`
}
