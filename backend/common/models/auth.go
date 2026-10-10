package models

type LoginInput struct {
	Identifier   string `json:"identifier" binding:"required"`
	Password     string `json:"password" binding:"required"`
	BusinessCode string `json:"business_code"`
}

type QRRedeemInput struct {
	Token string `json:"token" binding:"required"`
}

type ForgotPasswordInput struct {
	BusinessCode string `json:"business_code"`
	Username     string `json:"username" binding:"required"`
	Phone        string `json:"phone" binding:"required"`
}

type VerifyResetCodeInput struct {
	BusinessCode string `json:"business_code"`
	Username     string `json:"username" binding:"required"`
	Phone        string `json:"phone" binding:"required"`
	OTP          string `json:"otp" binding:"required"`
}

type ResetPasswordInput struct {
	BusinessCode string `json:"business_code"`
	Username     string `json:"username" binding:"required"`
	Phone        string `json:"phone" binding:"required"`
	OTP          string `json:"otp" binding:"required"`
	NewPassword  string `json:"new_password" binding:"required"`
}
