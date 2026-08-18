package customerauth

import (
	"time"

	"gorm.io/gorm"
)

// Repository provides GORM-backed persistence for OTP and DeviceToken
// records. Both live in the same repository (mirroring cash.Repository-style
// packages that own more than one small table) since they're always used
// together by Service and neither is large enough to warrant its own file.
type Repository struct {
	db *gorm.DB
}

func NewRepository(db *gorm.DB) *Repository {
	return &Repository{db: db}
}

// UpsertOTP replaces any existing OTP row for phone with a fresh one —
// requesting a new code always invalidates a previously issued one for the
// same phone.
func (r *Repository) UpsertOTP(rec *OTP) error {
	return r.db.Where("phone = ?", rec.Phone).
		Assign(OTP{CodeHash: rec.CodeHash, ExpiresAt: rec.ExpiresAt, Attempts: 0}).
		FirstOrCreate(rec).Error
}

func (r *Repository) FindOTPByPhone(phone string) (*OTP, error) {
	var rec OTP
	if err := r.db.Where("phone = ?", phone).First(&rec).Error; err != nil {
		return nil, err
	}
	return &rec, nil
}

func (r *Repository) IncrementOTPAttempts(id uint) error {
	return r.db.Model(&OTP{}).Where("id = ?", id).UpdateColumn("attempts", gorm.Expr("attempts + 1")).Error
}

func (r *Repository) DeleteOTP(id uint) error {
	return r.db.Delete(&OTP{}, id).Error
}

func (r *Repository) CreateDeviceToken(rec *DeviceToken) error {
	return r.db.Create(rec).Error
}

func (r *Repository) FindDeviceTokenByHash(hash string) (*DeviceToken, error) {
	var rec DeviceToken
	if err := r.db.Where("token_hash = ?", hash).First(&rec).Error; err != nil {
		return nil, err
	}
	return &rec, nil
}

func (r *Repository) TouchDeviceToken(id uint) error {
	now := time.Now()
	return r.db.Model(&DeviceToken{}).Where("id = ?", id).Update("last_used_at", now).Error
}

// RevokeDeviceTokensForCustomerDevice revokes any prior, still-live tokens
// for this exact (customerId, deviceId) pair before a fresh register-device
// issues a new one — a device re-registering (e.g. after being logged out
// and OTP-signing-in again) should not leave its old token usable
// indefinitely.
func (r *Repository) RevokeDeviceTokensForCustomerDevice(customerID uint, deviceID string) error {
	now := time.Now()
	return r.db.Model(&DeviceToken{}).
		Where("customer_id = ? AND device_id = ? AND revoked_at IS NULL", customerID, deviceID).
		Update("revoked_at", now).Error
}
