// Package customerauth implements sign-in for the customer mobile app
// (customer-mobile/) — batch 1 of that app's build plan. Two sign-in
// mechanisms:
//
//   - OTP over WhatsApp: request-otp / verify-otp, always available, the
//     only path for a customer's very first sign-in on any device.
//   - Device-bound biometric login: right after a successful verify-otp the
//     app registers the device (register-device), receiving a long-lived,
//     revocable device token stored behind a local biometric gate. On a
//     later cold start, a successful local biometric check lets the app
//     exchange that device token for a fresh session JWT (device-login) —
//     the server still validates the device token is real and not revoked,
//     so a stolen/rooted device can't fake this without ever having passed
//     an OTP check first.
//
// Distinct from internal/auth (employee login): a customer JWT carries
// "type":"customer" (platform.CustomerClaims) and is verified by
// platform.CustomerAuthMiddleware, never platform.AuthMiddleware — the two
// token kinds are not interchangeable.
package customerauth

import (
	"cloudhouse/backend/internal/platform"
	"time"
)

// OTP is one outstanding (or already-consumed) OTP request for a phone
// number. Only one row is meaningful per phone at a time — RequestOTP
// overwrites/replaces any prior row for that phone rather than
// accumulating history, mirroring employee.Employee's single
// PasswordResetTokenHash field.
type OTP struct {
	platform.TenantScoped
	ID        uint      `json:"-" gorm:"primaryKey"`
	Phone     string    `json:"-" gorm:"not null;size:20;index"`
	CodeHash  string    `json:"-" gorm:"not null;size:64"`
	ExpiresAt time.Time `json:"-" gorm:"not null"`
	// Attempts counts failed verify tries against this OTP — capped by
	// maxOTPAttempts in service.go so a code can't be brute-forced.
	Attempts  int       `json:"-" gorm:"not null;default:0"`
	CreatedAt time.Time `json:"-"`
}

func (OTP) TableName() string { return "customer_otp" }

// DeviceToken is one device's long-lived, revocable credential, minted once
// per successful register-device call. DeviceID is a client-generated
// stable identifier for that install (not a hardware id); the raw token
// itself is never stored, only its SHA-256 hash (TokenHash), the same
// "never store the secret" convention as employee.Employee's password-reset
// OTP hash.
type DeviceToken struct {
	platform.TenantScoped
	ID         uint       `json:"-" gorm:"primaryKey"`
	CustomerID uint       `json:"-" gorm:"not null;index"`
	DeviceID   string     `json:"-" gorm:"not null;size:100;index"`
	TokenHash  string     `json:"-" gorm:"not null;size:64;uniqueIndex"`
	CreatedAt  time.Time  `json:"-"`
	RevokedAt  *time.Time `json:"-"`
	LastUsedAt *time.Time `json:"-"`
}

func (DeviceToken) TableName() string { return "customer_device_tokens" }
