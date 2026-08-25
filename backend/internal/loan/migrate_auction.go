package loan

import (
	"log"

	"gorm.io/gorm"
)

// RelaxAuctionLoanUniqueIndex drops the old UNIQUE index on
// auction_records.loan_id, which enforced "one auction case per loan, ever".
//
// That rule was too strong. A case withdrawn because the customer caught up on
// payments left the loan permanently unauctionable: if they later defaulted
// again, no new case could be opened, because a concluded row still occupied
// the loan's one unique slot. The replacement rule — one *active* case per loan,
// created by CreateAuctionPartialIndexes below — keeps the protection that
// matters (never two live auctions over the same gold) and drops only the
// unintended "forever" part.
//
// NOTHING IS DELETED HERE. This drops an index, which is a constraint, not
// data: every auction_records row and the loan_id column itself are untouched.
//
// Must run BEFORE AutoMigrate. GORM does not drop an index it previously
// created just because the struct tag changed from uniqueIndex to index, so
// without this step the old constraint survives and every second auction insert
// keeps failing no matter what the model says.
//
// Safe to re-run: DROP INDEX IF EXISTS matches nothing once done, and the index
// name is verified against the live schema first (GORM's generated names do not
// always follow the convention, and a blind DROP ... IF EXISTS on a wrong name
// would silently succeed while leaving the real constraint in place — a failure
// that would only surface much later, when someone tried to restart an auction).
func RelaxAuctionLoanUniqueIndex(db *gorm.DB) error {
	m := db.Migrator()
	if !m.HasTable(&AuctionRecord{}) {
		return nil // fresh install — no legacy index to relax
	}

	// Conventional GORM name first, then any other unique index actually
	// present on the column, so an unconventionally-named one is still caught.
	candidates := []string{"idx_auction_records_loan_id"}
	if indexes, err := m.GetIndexes(&AuctionRecord{}); err == nil {
		for _, idx := range indexes {
			unique, ok := idx.Unique()
			if !ok || !unique {
				continue
			}
			for _, col := range idx.Columns() {
				if col == "loan_id" {
					candidates = append(candidates, idx.Name())
				}
			}
		}
	}

	seen := map[string]bool{}
	for _, name := range candidates {
		if name == "" || seen[name] || name == singleActiveAuctionIndex {
			continue
		}
		seen[name] = true
		if !m.HasIndex(&AuctionRecord{}, name) {
			continue
		}
		if err := db.Exec(`DROP INDEX IF EXISTS ` + name).Error; err != nil {
			return err
		}
		log.Printf("relaxed auction uniqueness: dropped index %s (one-active-per-loan now enforced instead)", name)
	}
	return nil
}

// Index names are referenced in more than one place, so they are named
// constants rather than repeated string literals.
const (
	singleActiveAuctionIndex   = "idx_single_active_auction_per_loan"
	singlePendingDecisionIndex = "idx_single_pending_auction_decision"
)

// CreateAuctionPartialIndexes installs the two correctness guarantees that GORM
// struct tags cannot express, because both are PARTIAL (conditional) unique
// indexes:
//
//  1. One ACTIVE auction case per loan. Concluded cases (Settled/Withdrawn) are
//     excluded, which is precisely what allows a re-defaulted loan to open a
//     fresh case while its history stays intact.
//
//  2. One PENDING decision request per (case, kind). A second part-payment
//     updates the existing escalation in place rather than stacking duplicates.
//
// These matter because the equivalent application-level checks are racy: two
// concurrent requests (or one double-clicked button) can both read "no active
// case" and both insert. The database is the only place that check can be made
// atomically.
//
// Must run AFTER AutoMigrate, since the predicates reference the stage/kind
// columns it creates. Safe to re-run via IF NOT EXISTS.
//
// Partial indexes are PostgreSQL/SQLite syntax; this is a no-op on engines that
// reject it, logged rather than fatal so a non-Postgres dev database still
// starts — the application-level checks continue to apply, just without the
// race protection.
func CreateAuctionPartialIndexes(db *gorm.DB) error {
	statements := []struct {
		name string
		sql  string
	}{
		{
			name: singleActiveAuctionIndex,
			sql: `CREATE UNIQUE INDEX IF NOT EXISTS ` + singleActiveAuctionIndex + `
			       ON auction_records (loan_id)
			       WHERE stage NOT IN ('Settled', 'Withdrawn')`,
		},
		{
			name: singlePendingDecisionIndex,
			sql: `CREATE UNIQUE INDEX IF NOT EXISTS ` + singlePendingDecisionIndex + `
			       ON auction_decision_requests (auction_record_id, kind)
			       WHERE status = 'Pending'`,
		},
	}

	for _, st := range statements {
		if err := db.Exec(st.sql).Error; err != nil {
			log.Printf("could not create partial index %s (%v) — application-level checks still apply, but concurrent inserts are not guarded", st.name, err)
			continue
		}
	}
	return nil
}
