package tenant

import (
	"cloudhouse/backend/internal/platform"
	"context"
	"errors"
	"log"

	"gorm.io/gorm"
)

// The tiers seeded on every boot. Quotas are the vendor's price list, not a
// technical limit — adding a tier here is how a new plan is introduced.
//
// BranchQuota 0 is UnlimitedBranches.
var SeedTiers = []struct {
	Name        string
	BranchQuota uint
}{
	{"Single Branch", 1},
	{"Up to 5 Branches", 5},
	{"Unlimited", UnlimitedBranches},
}

// legacyTierNames maps the original tier names onto the ones that replaced
// them. Seed renames in place — same row, same id — so every business
// already on a tier stays on it and simply sees the new name and quota.
var legacyTierNames = []struct{ from, to string }{
	{"Starter", "Single Branch"},
	{"Growth", "Up to 5 Branches"},
	{"Enterprise", "Unlimited"},
}

const (
	// DefaultTenantName/Code identify the single business that every row
	// predating multi-tenancy is backfilled into. See EnsureDefault.
	//
	// The name is only ever applied when this tenant is CREATED — EnsureDefault
	// finds an existing one by code, never by name — so changing it rebrands a
	// fresh install without touching a deployment that is already running under
	// its own business name. That distinction matters because this string is
	// what brandedMessage substitutes into every borrower SMS.
	DefaultTenantName = "CloudHouse Finance"

	// DefaultTenantCode becomes part of this business's login URL/subdomain
	// (demo.cloudhousefinance.com). Codes are immutable once staff have the
	// link, but this one is safe to change while it is still the ONLY tenant
	// and the per-business login has not shipped — after that, don't.
	//
	// "demo" rather than "default": this deployment reaches its one seeded
	// tenant at demo.cloudhousefinance.com (see tenant.SubdomainLabel), and
	// "default" reads oddly as a live subdomain. This is a seed-constant
	// change only, for a fresh/empty database — an existing populated
	// database with a tenant already coded "default" needs a data migration
	// (UPDATE tenants SET code = 'demo' WHERE code = 'default'), which is out
	// of scope here.
	DefaultTenantCode = "demo"

	// DefaultTenantTier is deliberately the largest plan: the existing
	// installation may already have more branches than a smaller tier
	// allows, and a backfill must never put a live business instantly over
	// quota.
	DefaultTenantTier = "Unlimited"
)

// Seed creates the tier catalogue. Idempotent — safe on every boot.
func Seed(db *gorm.DB) error {
	// Boot-time seeding runs outside any request, so it has no tenant.
	// Marked cross-tenant deliberately — see platform.AllowCrossTenant.
	ctx := platform.AllowCrossTenant(context.Background())
	repo := NewRepository(db)
	// Renames first, or the upserts below would create fresh rows under the
	// new names and leave every existing business on an orphaned old tier.
	for _, r := range legacyTierNames {
		if err := repo.RenameTier(ctx, r.from, r.to); err != nil {
			return err
		}
	}
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
