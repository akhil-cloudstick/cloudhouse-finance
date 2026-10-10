package controllers

import (
	commonModels "cloudhouse/backend/common/models"
	"cloudhouse/backend/config"
	"context"
	"errors"
	"fmt"

	"gorm.io/gorm"
	"gorm.io/gorm/clause"
)

type BranchUsage struct {
	Plan      string `json:"plan"`
	Quota     uint   `json:"quota"`
	Used      int64  `json:"used"`
	Unlimited bool   `json:"unlimited"`
}

func insertTenant(ctx context.Context, t *commonModels.Tenant) error {
	return config.BaseDB.
		WithContext(ctx).Create(t).Error
}

func PersistTenant(ctx context.Context, t *commonModels.Tenant) error {
	return config.BaseDB.
		WithContext(ctx).Omit(clause.Associations).Save(t).Error
}

func FindTenantByID(ctx context.Context, id uint) (*commonModels.Tenant, error) {
	var t commonModels.Tenant
	if err := config.BaseDB.
		WithContext(ctx).Preload("Tier").First(&t, id).Error; err != nil {
		return nil, err
	}
	return &t, nil
}

func FindByCode(ctx context.Context, code string) (*commonModels.Tenant, error) {
	var t commonModels.Tenant
	if err := config.BaseDB.
		WithContext(ctx).Preload("Tier").Where("LOWER(code) = LOWER(?)", code).First(&t).Error; err != nil {
		return nil, err
	}
	return &t, nil
}

func FindByHostLabel(ctx context.Context, host string) (*commonModels.Tenant, error) {
	label, ok := SubdomainLabel(host)
	if !ok {
		return nil, gorm.ErrRecordNotFound
	}
	return FindByCode(ctx, label)
}

func FindByRazorpaySubscriptionID(ctx context.Context, subscriptionID string) (*commonModels.Tenant, error) {
	var t commonModels.Tenant
	if err := config.BaseDB.
		WithContext(ctx).Preload("Tier").
		Where("razorpay_subscription_id = ?", subscriptionID).First(&t).Error; err != nil {
		return nil, err
	}
	return &t, nil
}

func FindTenants(ctx context.Context) ([]commonModels.Tenant, error) {
	var out []commonModels.Tenant
	err := config.BaseDB.
		WithContext(ctx).Preload("Tier").Order("name asc").Find(&out).Error
	return out, err
}

func countActiveBranches(ctx context.Context, tenantID uint) (int64, error) {
	var n int64
	err := config.BaseDB.
		WithContext(ctx).Table("branches").
		Where("tenant_id = ? AND is_active = true AND deleted_at IS NULL", tenantID).
		Count(&n).Error
	return n, err
}

func reserveBranchSlot(ctx context.Context, tenantID uint, apply func(tx *gorm.DB) error) error {
	return config.BaseDB.
		WithContext(ctx).Transaction(func(tx *gorm.DB) error {
		var t commonModels.Tenant
		if err := tx.Clauses(clause.Locking{Strength: "UPDATE"}).First(&t, tenantID).Error; err != nil {
			return fmt.Errorf("locking tenant %d for quota check: %w", tenantID, err)
		}
		var tier commonModels.Tier
		if err := tx.First(&tier, t.TierID).Error; err != nil {
			return fmt.Errorf("loading tier for tenant %d: %w", tenantID, err)
		}
		if t.SingleBranch {
			tier.BranchQuota = 1
		}
		if TierIsUnlimited(tier) {
			return apply(tx)
		}
		var active int64
		if err := tx.Table("branches").
			Where("tenant_id = ? AND is_active = true AND deleted_at IS NULL", tenantID).
			Count(&active).Error; err != nil {
			return err
		}
		if uint(active) >= tier.BranchQuota {
			return NewConflict(BranchLimitMessage(tier, active))
		}
		return apply(tx)
	})
}

func findTierByName(ctx context.Context, name string) (*commonModels.Tier, error) {
	var t commonModels.Tier
	if err := config.BaseDB.
		WithContext(ctx).Where("name = ?", name).First(&t).Error; err != nil {
		return nil, err
	}
	return &t, nil
}

func FindAllTiers(ctx context.Context) ([]commonModels.Tier, error) {
	var out []commonModels.Tier
	err := config.BaseDB.
		WithContext(ctx).Order("branch_quota asc").Find(&out).Error
	return out, err
}

func upsertTier(ctx context.Context, name string, quota uint) (*commonModels.Tier, error) {
	existing, err := findTierByName(ctx, name)
	if err == nil {
		if existing.BranchQuota != quota {
			existing.BranchQuota = quota
			if err := config.BaseDB.
				WithContext(ctx).Save(existing).Error; err != nil {
				return nil, err
			}
		}
		return existing, nil
	}
	if !errors.Is(err, gorm.ErrRecordNotFound) {
		return nil, err
	}
	rec := &commonModels.Tier{Name: name, BranchQuota: quota, IsActive: true}
	if err := config.BaseDB.
		WithContext(ctx).Create(rec).Error; err != nil {
		return nil, err
	}
	if quota == commonModels.UnlimitedBranches {
		if err := config.BaseDB.
			WithContext(ctx).Model(rec).Update("branch_quota", 0).Error; err != nil {
			return nil, err
		}
		rec.BranchQuota = 0
	}
	return rec, nil
}

func BranchLimitMessage(tier commonModels.Tier, active int64) string {
	return fmt.Sprintf(
		"Your current plan (%s) allows %d branch%s and you already have %d. "+
			"To add more branches, contact your administrator to upgrade your plan.",
		tier.Name, tier.BranchQuota, plural(tier.BranchQuota), active)
}

func plural(n uint) string {
	if n == 1 {
		return ""
	}
	return "es"
}

func branchUsage(ctx context.Context, tenantID uint) (*BranchUsage, error) {
	t, err := FindTenantByID(ctx, tenantID)
	if err != nil {
		return nil, err
	}
	var tier commonModels.Tier
	if err := config.BaseDB.
		WithContext(ctx).First(&tier, t.TierID).Error; err != nil {
		return nil, err
	}
	used, err := countActiveBranches(ctx, tenantID)
	if err != nil {
		return nil, err
	}
	return &BranchUsage{Plan: tier.Name, Quota: tier.BranchQuota, Used: used, Unlimited: TierIsUnlimited(tier)}, nil
}

func SaveTier(ctx context.Context, t *commonModels.Tier) error {
	return config.BaseDB.
		WithContext(ctx).Save(t).Error
}

func FindTierByID(ctx context.Context, id uint) (*commonModels.Tier, error) {
	var t commonModels.Tier
	if err := config.BaseDB.
		WithContext(ctx).First(&t, id).Error; err != nil {
		return nil, err
	}
	return &t, nil
}

func HasModule(ctx context.Context, tenantID uint, moduleKey string) (bool, error) {
	var row struct {
		Enabled      string
		SingleBranch bool
	}
	err := config.BaseDB.
		WithContext(ctx).Model(&commonModels.Tenant{}).
		Select("COALESCE(enabled_modules, '') AS enabled, COALESCE(single_branch, false) AS single_branch").
		Where("id = ?", tenantID).
		Take(&row).Error
	if err != nil {
		return false, err
	}
	if moduleKey == commonModels.ModuleBranches && row.SingleBranch {
		return false, nil
	}
	return commonModels.ContainsCSV(row.Enabled, moduleKey), nil
}
