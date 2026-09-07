package tenant

import (
	"context"
	"errors"
	"fmt"

	"gorm.io/gorm"
	"gorm.io/gorm/clause"

	"ambikagold/backend/internal/platform/httpx"
)

// Repository provides GORM-backed persistence for Tenant and Tier.
//
// Every method here is deliberately UNSCOPED by tenant: this is the one
// package whose job is to see across businesses. Once the automatic query
// filter lands (plan Step 2), these calls opt out of it explicitly, which is
// what makes the opt-out greppable and auditable.
type Repository struct {
	db *gorm.DB
}

func NewRepository(db *gorm.DB) *Repository {
	return &Repository{db: db}
}

func (r *Repository) Create(ctx context.Context, t *Tenant) error {
	return r.db.WithContext(ctx).Create(t).Error
}

func (r *Repository) Update(ctx context.Context, t *Tenant) error {
	return r.db.WithContext(ctx).Save(t).Error
}

// FindByID loads a tenant with its Tier preloaded — the quota is read
// through the tier, so almost every caller needs it.
func (r *Repository) FindByID(ctx context.Context, id uint) (*Tenant, error) {
	var t Tenant
	if err := r.db.WithContext(ctx).Preload("Tier").First(&t, id).Error; err != nil {
		return nil, err
	}
	return &t, nil
}

// FindByCode resolves the business in a login URL (/login/<code>). Matching
// is case-insensitive: the code travels in URLs and gets retyped by people,
// so "AMBIKA" and "ambika" must reach the same business.
func (r *Repository) FindByCode(ctx context.Context, code string) (*Tenant, error) {
	var t Tenant
	if err := r.db.WithContext(ctx).Preload("Tier").Where("LOWER(code) = LOWER(?)", code).First(&t).Error; err != nil {
		return nil, err
	}
	return &t, nil
}

// FindByRazorpaySubscriptionID resolves the business a webhook event belongs
// to. Called with AllowCrossTenant by billing.Service — a webhook has no
// tenant of its own to scope the lookup to; this IS how it finds one.
func (r *Repository) FindByRazorpaySubscriptionID(ctx context.Context, subscriptionID string) (*Tenant, error) {
	var t Tenant
	if err := r.db.WithContext(ctx).Preload("Tier").
		Where("razorpay_subscription_id = ?", subscriptionID).First(&t).Error; err != nil {
		return nil, err
	}
	return &t, nil
}

func (r *Repository) FindAll(ctx context.Context) ([]Tenant, error) {
	var out []Tenant
	err := r.db.WithContext(ctx).Preload("Tier").Order("name asc").Find(&out).Error
	return out, err
}

// CountActiveBranches counts the branches currently counting against the
// tenant's quota. Queried by table name rather than importing internal/branch
// to keep the dependency one-way — branch will need to import tenant for the
// quota check, not the reverse.
func (r *Repository) CountActiveBranches(ctx context.Context, tenantID uint) (int64, error) {
	var n int64
	err := r.db.WithContext(ctx).Table("branches").
		Where("tenant_id = ? AND is_active = true AND deleted_at IS NULL", tenantID).
		Count(&n).Error
	return n, err
}

// ReserveBranchSlot enforces the tenant's tier quota AT THE MOMENT a branch
// becomes active — branch creation, and reactivating a deactivated branch,
// which is the other path back over quota that is easy to forget.
//
// The lock, the count, and apply all run inside ONE transaction, which is
// the part that actually matters: a plain "count, then create" done as two
// separate statements lets two concurrent requests both see room for one
// more branch and both create it, landing the tenant one over quota. Locking
// the tenant row first serializes any second concurrent call to this same
// method until the first transaction commits or rolls back.
//
// apply runs only if there is room, using the SAME transaction handle passed
// to it — the branch's own create/save must happen inside this transaction,
// not after it, or the race this exists to close reopens between the check
// and that later write.
func (r *Repository) ReserveBranchSlot(ctx context.Context, tenantID uint, apply func(tx *gorm.DB) error) error {
	return r.db.WithContext(ctx).Transaction(func(tx *gorm.DB) error {
		var t Tenant
		if err := tx.Clauses(clause.Locking{Strength: "UPDATE"}).First(&t, tenantID).Error; err != nil {
			return fmt.Errorf("locking tenant %d for quota check: %w", tenantID, err)
		}
		var tier Tier
		if err := tx.First(&tier, t.TierID).Error; err != nil {
			return fmt.Errorf("loading tier for tenant %d: %w", tenantID, err)
		}
		var active int64
		if err := tx.Table("branches").
			Where("tenant_id = ? AND is_active = true AND deleted_at IS NULL", tenantID).
			Count(&active).Error; err != nil {
			return err
		}
		if uint(active) >= tier.BranchQuota {
			return httpx.NewConflict(fmt.Sprintf(
				"the %s plan includes %d active branch(es); this business already has %d",
				tier.Name, tier.BranchQuota, active))
		}
		return apply(tx)
	})
}

// --- Tiers ---

func (r *Repository) FindTierByName(ctx context.Context, name string) (*Tier, error) {
	var t Tier
	if err := r.db.WithContext(ctx).Where("name = ?", name).First(&t).Error; err != nil {
		return nil, err
	}
	return &t, nil
}

func (r *Repository) FindAllTiers(ctx context.Context) ([]Tier, error) {
	var out []Tier
	err := r.db.WithContext(ctx).Order("branch_quota asc").Find(&out).Error
	return out, err
}

// UpsertTier creates a tier by name, or updates its quota if it already
// exists. Used by seeding; safe to re-run.
func (r *Repository) UpsertTier(ctx context.Context, name string, quota uint) (*Tier, error) {
	existing, err := r.FindTierByName(ctx, name)
	if err == nil {
		if existing.BranchQuota != quota {
			existing.BranchQuota = quota
			if err := r.db.WithContext(ctx).Save(existing).Error; err != nil {
				return nil, err
			}
		}
		return existing, nil
	}
	if !errors.Is(err, gorm.ErrRecordNotFound) {
		return nil, err
	}
	rec := &Tier{Name: name, BranchQuota: quota, IsActive: true}
	if err := r.db.WithContext(ctx).Create(rec).Error; err != nil {
		return nil, err
	}
	return rec, nil
}

// SaveTier persists changes to an existing tier — used by billing.Service to
// cache a lazily-created Razorpay Plan ID onto the tier the first time
// anyone subscribes to it.
func (r *Repository) SaveTier(ctx context.Context, t *Tier) error {
	return r.db.WithContext(ctx).Save(t).Error
}

func (r *Repository) FindTierByID(ctx context.Context, id uint) (*Tier, error) {
	var t Tier
	if err := r.db.WithContext(ctx).First(&t, id).Error; err != nil {
		return nil, err
	}
	return &t, nil
}
