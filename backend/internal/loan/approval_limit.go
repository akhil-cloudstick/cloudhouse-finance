package loan

import (
	"cloudhouse/backend/internal/platform"
	"context"
	"errors"
	"time"

	"gorm.io/gorm"
)

// ApprovalLimit is a per-role hard cap on the principal a loan sanction
// stage's role may approve, replacing the old hardcoded, advisory-only
// sanctionLimits["Loan Operator"] entry. Currently only ever has a
// "Loan Operator" row — Branch Manager/Management stay hardcoded/
// advisory-only in sanctionLimits (see that var's doc comment) per an
// explicit scope decision, not an oversight; extending this table to other
// roles later just means inserting another row, no schema change.
type ApprovalLimit struct {
	platform.TenantScoped
	ID        uint      `json:"id" gorm:"primaryKey"`
	Role      string    `json:"role" gorm:"index;not null;size:40"`
	MaxAmount float64   `json:"maxAmount" gorm:"not null"`
	UpdatedAt time.Time `json:"updatedAt"`
}

func (ApprovalLimit) TableName() string { return "approval_limits" }

// DefaultLoanOperatorApprovalLimit seeds the Loan Operator's limit on a
// fresh install / first migration after this feature shipped — matches
// the value sanctionLimits used to hardcode, so behavior doesn't silently
// change for existing deployments the moment this migrates.
const DefaultLoanOperatorApprovalLimit = 50000

// ApprovalLimitRepository provides GORM-backed persistence for
// ApprovalLimit rows.
type ApprovalLimitRepository struct {
	db platform.DB
}

func NewApprovalLimitRepository(db platform.DB) *ApprovalLimitRepository {
	return &ApprovalLimitRepository{db: db}
}

func (r *ApprovalLimitRepository) FindByRole(ctx context.Context, role string) (*ApprovalLimit, error) {
	var rec ApprovalLimit
	if err := r.db.WithContext(ctx).Where("role = ?", role).First(&rec).Error; err != nil {
		return nil, err
	}
	return &rec, nil
}

// Upsert creates or updates the single row for role.
func (r *ApprovalLimitRepository) Upsert(ctx context.Context, role string, maxAmount float64) (*ApprovalLimit, error) {
	rec, err := r.FindByRole(ctx, role)
	if err != nil {
		if !errors.Is(err, gorm.ErrRecordNotFound) {
			return nil, err
		}
		rec = &ApprovalLimit{Role: role, MaxAmount: maxAmount}
		if err := r.db.WithContext(ctx).Create(rec).Error; err != nil {
			return nil, err
		}
		return rec, nil
	}
	rec.MaxAmount = maxAmount
	if err := r.db.WithContext(ctx).Save(rec).Error; err != nil {
		return nil, err
	}
	return rec, nil
}

// SeedLoanOperatorLimit is a one-time, idempotent step that inserts the
// Loan Operator's default limit row if none exists yet — safe to re-run.
func SeedLoanOperatorLimit(db *gorm.DB) error {
	// Boot-time seeding: no request, so no tenant. Deliberate opt-out.
	ctx := platform.AllowCrossTenant(context.Background())
	repo := NewApprovalLimitRepository(db)
	if _, err := repo.FindByRole(ctx, "Loan Operator"); err == nil {
		return nil // already seeded
	} else if !errors.Is(err, gorm.ErrRecordNotFound) {
		return err
	}
	_, err := repo.Upsert(ctx, "Loan Operator", DefaultLoanOperatorApprovalLimit)
	return err
}
