package tenant

import (
	"context"
	"log"

	"ambikagold/backend/internal/platform"
)

// ForEachActive runs fn once per active business, each time with a context
// scoped to that business.
//
// This is how background work is meant to reach the database. A cron job has
// no request and therefore no tenant, and the two ways of dealing with that
// are very different:
//
//   - AllowCrossTenant — the job sees every business's rows at once. Correct
//     for migrations. Wrong for anything that acts on the rows it finds.
//   - ForEachActive — the job runs N times, each pass seeing exactly one
//     business, exactly as a logged-in user of that business would.
//
// The distinction matters most for the due/overdue sweep, which SENDS
// MESSAGES TO REAL BORROWERS. Run cross-tenant, one pass would text every
// business's customers in a single undifferentiated batch; any per-business
// rule — branding, quotas, suspension — would have nothing to key on.
//
// Suspended and cancelled businesses are skipped deliberately. Outbound
// messaging goes through shared provider credentials, so continuing to send
// on behalf of a business that has stopped paying spends the vendor's money
// and, worse, keeps contacting borrowers in that business's name.
//
// One business failing never stops the others: the error is logged and the
// loop continues. A single bad row should not silently halt reminders for
// every other customer.
func ForEachActive(ctx context.Context, repo *Repository, label string, fn func(ctx context.Context, t Tenant) error) {
	all, err := repo.FindAll(platform.AllowCrossTenant(ctx))
	if err != nil {
		log.Printf("%s: could not list businesses: %v", label, err)
		return
	}

	for i := range all {
		t := all[i]
		if t.Status != StatusActive {
			continue
		}
		tenantCtx := platform.WithTenant(ctx, t.ID)
		if err := fn(tenantCtx, t); err != nil {
			log.Printf("%s: business %d (%s) failed: %v", label, t.ID, t.Code, err)
		}
	}
}
