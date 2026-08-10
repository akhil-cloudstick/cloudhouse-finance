// Command migrate applies GORM AutoMigrate for all domain models against
// the configured database, standalone from the API server. Useful for CI
// or first-time local setup: `go run ./cmd/migrate`.
package main

import (
	"log"

	"gorm.io/gorm"

	"ambikagold/backend/internal/bank"
	"ambikagold/backend/internal/branch"
	"ambikagold/backend/internal/cash"
	"ambikagold/backend/internal/customer"
	"ambikagold/backend/internal/employee"
	"ambikagold/backend/internal/goldrate"
	"ambikagold/backend/internal/loan"
	"ambikagold/backend/internal/locker"
	"ambikagold/backend/internal/ornamenttype"
	"ambikagold/backend/internal/packet"
	"ambikagold/backend/internal/platform"
	"ambikagold/backend/internal/scheme"
	"ambikagold/backend/internal/settings"
)

func main() {
	cfg := platform.LoadConfig()

	db, err := platform.NewDatabase(cfg)
	if err != nil {
		log.Fatalf("database connection failed: %v", err)
	}

	if err := db.AutoMigrate(
		&branch.Branch{},
		&scheme.Scheme{},
		&goldrate.GoldRate{},
		&employee.Employee{},
		&cash.CashMovement{},
		&cash.Expense{},
		&cash.OpeningCashBalance{},
		&settings.ApiKeySetting{},
		&customer.Customer{},
		&loan.Loan{},
		&loan.Ornament{},
		&loan.OrnamentPurityTest{},
		&loan.OrnamentImage{},
		&loan.LoanApproval{},
		&loan.LoanPayment{},
		&loan.BankPledgeRecord{},
		&ornamenttype.OrnamentType{},
		&bank.Bank{},
		&locker.Locker{},
		&packet.Packet{},
		&packet.PacketMovement{},
	); err != nil {
		log.Fatalf("auto-migrate failed: %v", err)
	}

	if err := backfillBranches(db); err != nil {
		log.Fatalf("branch backfill failed: %v", err)
	}

	if err := dropLegacyBranchColumn(db); err != nil {
		log.Fatalf("legacy branch column cleanup failed: %v", err)
	}

	log.Println("migrations applied successfully")
}

// dropLegacyBranchColumn removes the old free-text `branch` column on
// employees/expenses once backfillBranches has copied its data into
// branch_id. Safe to re-run: HasColumn is false after the first successful
// drop, so this becomes a no-op. This used to be left as a manual cleanup
// step, but the leftover NOT NULL constraint on that column was rejecting
// every new INSERT that (correctly) no longer sets it.
func dropLegacyBranchColumn(db *gorm.DB) error {
	for _, table := range []string{"employees", "expenses"} {
		if !db.Migrator().HasColumn(table, "branch") {
			continue
		}
		if err := db.Migrator().DropColumn(table, "branch"); err != nil {
			return err
		}
		log.Printf("dropped legacy %s.branch column", table)
	}
	return nil
}

// backfillBranches is a one-time, idempotent step for existing databases
// that still have the legacy free-text `branch` column on employees/
// expenses (pre-dating the branches table). It turns each distinct branch
// name into a real Branch row and points branch_id at it. Safe to re-run:
// once every row has branch_id populated, the UPDATE ... WHERE branch_id
// IS NULL/0 clauses simply match nothing.
//
// AutoMigrate never drops the legacy `branch` string column on its own, so
// it's still there for this to read from; dropping it is a manual cleanup
// step once you've confirmed the backfill looks right (see
// database_architecture.md).
func backfillBranches(db *gorm.DB) error {
	branchRepo := branch.NewRepository(db)

	for _, table := range []string{"employees", "expenses"} {
		if !db.Migrator().HasColumn(table, "branch") {
			continue // already cleaned up / fresh install with no legacy column
		}

		var names []string
		if err := db.Table(table).
			Where("branch IS NOT NULL AND branch <> '' AND (branch_id IS NULL OR branch_id = 0)").
			Distinct("branch").Pluck("branch", &names).Error; err != nil {
			return err
		}

		for _, name := range names {
			b, err := branchRepo.FirstOrCreateByName(name)
			if err != nil {
				return err
			}
			if err := db.Table(table).
				Where("branch = ? AND (branch_id IS NULL OR branch_id = 0)", name).
				Update("branch_id", b.ID).Error; err != nil {
				return err
			}
			log.Printf("backfilled %s: %d row(s) -> branch %q (id=%d)", table, db.RowsAffected, name, b.ID)
		}
	}
	return nil
}
