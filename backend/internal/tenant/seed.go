package tenant

import (
	"ambikagold/backend/internal/platform"
	"context"
	"errors"
	"log"

	"gorm.io/gorm"
)

// The tiers seeded on every boot. Quotas are the vendor's price list, not a
// technical limit — adding a tier here is how a new plan is introduced.
var SeedTiers = []struct {
	Name        string
	BranchQuota uint
}{
	{"Starter", 1},
	{"Growth", 3},
	{"Enterprise", 10},
}

const (
	// DefaultTenantName/Code identify the single business that every row
	// predating multi-tenancy is backfilled into. See EnsureDefault.
	DefaultTenantName = "Default Business"

	// DefaultTenantCode becomes part of this business's login URL
	// (/login/default). Codes are immutable once staff have the link, but
	// this one is safe to change while it is still the ONLY tenant and the
	// per-business login has not shipped — after that, don't.
	DefaultTenantCode = "default"

	// DefaultTenantTier is deliberately the largest plan: the existing
	// installation may already have more branches than a smaller tier
	// allows, and a backfill must never put a live business instantly over
	// quota.
	DefaultTenantTier = "Enterprise"
)

// Seed creates the tier catalogue. Idempotent — safe on every boot.
func Seed(db *gorm.DB) error {
	// Boot-time seeding runs outside any request, so it has no tenant.
	// Marked cross-tenant deliberately — see platform.AllowCrossTenant.
	ctx := platform.AllowCrossTenant(context.Background())
	repo := NewRepository(db)
	for _, t := range SeedTiers {
		if _, err := repo.UpsertTier(ctx, t.Name, t.BranchQuota); err != nil {
			return err
		}
	}
	return nil
}

// EnsureDefault returns the tenant that pre-multi-tenancy rows belong to,
// creating it on first run. Everything that existed before this feature is
// one business, so there is exactly one such tenant and it is found by code.
//
// Idempotent, and it never adopts an arbitrary existing row: it matches on
// DefaultTenantCode specifically, so running this against a database that has
// since gained real tenants cannot silently repoint the backfill at one of
// them.
func EnsureDefault(db *gorm.DB) (*Tenant, error) {
	// Boot-time seeding runs outside any request, so it has no tenant.
	// Marked cross-tenant deliberately — see platform.AllowCrossTenant.
	ctx := platform.AllowCrossTenant(context.Background())
	repo := NewRepository(db)

	existing, err := repo.FindByCode(ctx, DefaultTenantCode)
	if err == nil {
		return existing, nil
	}
	if !errors.Is(err, gorm.ErrRecordNotFound) {
		return nil, err
	}

	tier, err := repo.FindTierByName(ctx, DefaultTenantTier)
	if err != nil {
		return nil, err
	}

	rec := &Tenant{
		Name:   DefaultTenantName,
		Code:   DefaultTenantCode,
		TierID: tier.ID,
		Status: StatusActive,
	}
	if err := repo.Create(ctx, rec); err != nil {
		return nil, err
	}
	log.Printf("created default tenant %q (code %q, tier %q, id=%d) — existing data will be backfilled into it",
		rec.Name, rec.Code, tier.Name, rec.ID)
	return rec, nil
}
