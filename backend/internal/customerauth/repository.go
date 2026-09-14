package customerauth

import (
	"context"
	"time"

	"gorm.io/gorm"

	"cloudhouse/backend/internal/platform"
)

// Repository provides GORM-backed persistence for OTP and DeviceToken
// records. Both live in the same repository (mirroring cash.Repository-style
// packages that own more than one small table) since they're always used
// together by Service and neither is large enough to warrant its own file.
type Repository struct {
	db platform.DB
}

func NewRepository(db platform.DB) *Repository {
	return &Repository{db: db}
}

// UpsertOTP replaces any existing OTP row for phone with a fresh one —
// requesting a new code always invalidates a previously issued one for the
// same phone.
func (r *Repository) UpsertOTP(ctx context.Context, rec *OTP) error {
	return r.db.WithContext(ctx).Where("phone = ?", rec.Phone).
		Assign(OTP{CodeHash: rec.CodeHash, ExpiresAt: rec.ExpiresAt, Attempts: 0}).
		FirstOrCreate(rec).Error
}

func (r *Repository) FindOTPByPhone(ctx context.Context, phone string) (*OTP, error) {
	var rec OTP
	if err := r.db.WithContext(ctx).Where("phone = ?", phone).First(&rec).Error; err != nil {
		return nil, err
	}
	return &rec, nil
}

func (r *Repository) IncrementOTPAttempts(ctx context.Context, id uint) error {
	return r.db.WithContext(ctx).Model(&OTP{}).Where("id = ?", id).UpdateColumn("attempts", gorm.Expr("attempts + 1")).Error
}

func (r *Repository) DeleteOTP(ctx context.Context, id uint) error {
	return r.db.WithContext(ctx).Delete(&OTP{}, id).Error
}

func (r *Repository) CreateDeviceToken(ctx context.Context, rec *DeviceToken) error {
	return r.db.WithContext(ctx).Create(rec).Error
}

func (r *Repository) FindDeviceTokenByHash(ctx context.Context, hash string) (*DeviceToken, error) {
	var rec DeviceToken
	if err := r.db.WithContext(ctx).Where("token_hash = ?", hash).First(&rec).Error; err != nil {
		return nil, err
	}
	return &rec, nil
}

func (r *Repository) TouchDeviceToken(ctx context.Context, id uint) error {
	now := time.Now()
	return r.db.WithContext(ctx).Model(&DeviceToken{}).Where("id = ?", id).Update("last_used_at", now).Error
}

// RevokeDeviceTokensForCustomerDevice revokes any prior, still-live tokens
// for this exact (customerId, deviceId) pair before a fresh register-device
// issues a new one — a device re-registering (e.g. after being logged out
// and OTP-signing-in again) should not leave its old token usable
// indefinitely.
func (r *Repository) RevokeDeviceTokensForCustomerDevice(ctx context.Context, customerID uint, deviceID string) error {
	now := time.Now()
	return r.db.WithContext(ctx).Model(&DeviceToken{}).
		Where("customer_id = ? AND device_id = ? AND revoked_at IS NULL", customerID, deviceID).
		Update("revoked_at", now).Error
}
