// Command migrate applies GORM AutoMigrate for all domain models against
// the configured database, standalone from the API server. Useful for CI
// or first-time local setup: `go run ./cmd/migrate`.
package main

import (
	"log"

	"gorm.io/gorm"

	"ambikagold/backend/internal/authz"
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
	"ambikagold/backend/internal/puritystandard"
	"ambikagold/backend/internal/scheme"
	"ambikagold/backend/internal/settings"
)

// authResources/staffRoles mirror the copies in backend/main.go (see that
// file's doc comment) — kept identical so cmd/migrate seeds the exact same
// permission rows the API server would seed on startup. "branches" is
// deliberately NOT in this list, same as main.go — see the
// RestrictResourceToRole call below.
var authResources = []string{
	"banks", "cash", "customers", "employees", "goldrates",
	"loans", "lockers", "ornamenttypes", "packets", "puritystandards", "reminders",
	"schemes", "settings", "uploads", "kyc-documents",
}

var staffRoles = []string{
	"Administrator", "Management", "Branch Manager", "Loan Operator", "Cashier",
	"Accountant", "Collection Staff", "Auction Administrator", "Auditor",
}

func main() {
	cfg := platform.LoadConfig()

	db, err := platform.NewDatabase(cfg)
	if err != nil {
		log.Fatalf("database connection failed: %v", err)
	}

	if err := scheme.BackfillDurationMonths(db); err != nil {
		log.Fatalf("scheme duration backfill failed: %v", err)
	}

	if err := scheme.BackfillBranchID(db); err != nil {
		log.Fatalf("scheme branch_id backfill failed: %v", err)
	}

	if err := goldrate.MigrateLegacyColumns(db); err != nil {
		log.Fatalf("gold rate legacy column migration failed: %v", err)
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
		&loan.LoanRequest{},
		&loan.RequestApproval{},
		&loan.ApprovalLimit{},
		&ornamenttype.OrnamentType{},
		&bank.Bank{},
		&locker.Locker{},
		&packet.Packet{},
		&packet.PacketMovement{},
		&puritystandard.PurityStandard{},
		&authz.Permission{},
	); err != nil {
		log.Fatalf("auto-migrate failed: %v", err)
	}

	if err := scheme.DropLegacyDateColumns(db); err != nil {
		log.Fatalf("legacy scheme date column cleanup failed: %v", err)
	}

	if err := puritystandard.SeedStandards(db); err != nil {
		log.Fatalf("purity standard seeding failed: %v", err)
	}

	if err := loan.NormalizeLegacyPurities(db); err != nil {
		log.Fatalf("legacy ornament purity normalization failed: %v", err)
	}

	if err := loan.SeedLoanOperatorLimit(db); err != nil {
		log.Fatalf("loan operator approval limit seeding failed: %v", err)
	}

	if err := backfillBranches(db); err != nil {
		log.Fatalf("branch backfill failed: %v", err)
	}

	if err := dropLegacyBranchColumn(db); err != nil {
		log.Fatalf("legacy branch column cleanup failed: %v", err)
	}

	if err := backfillEmployeeBranch(db); err != nil {
		log.Fatalf("employee branch backfill failed: %v", err)
	}

	if err := backfillCashMovementBranch(db); err != nil {
		log.Fatalf("cash movement branch backfill failed: %v", err)
	}

	if err := backfillBankPledgeBankID(db); err != nil {
		log.Fatalf("bank pledge bank_id backfill failed: %v", err)
	}

	authzRepo := authz.NewRepository(db)
	inserted, skipped, err := authzRepo.SeedDefaults(staffRoles, authResources)
	if err != nil {
		log.Fatalf("permissions seed failed: %v", err)
	}
	log.Printf("permissions seed: %d inserted, %d already present", inserted, skipped)

	// Mirrors backend/main.go's post-seed permission overrides — see there
	// for the reasoning.
	nonAdminRoles := make([]string, 0, len(staffRoles))
	for _, role := range staffRoles {
		if role != platform.AdministratorRole {
			nonAdminRoles = append(nonAdminRoles, role)
		}
	}
	if err := authzRepo.RestrictResourceToRole("branches", platform.AdministratorRole, nonAdminRoles); err != nil {
		log.Fatalf("branches permission restriction failed: %v", err)
	}
	if err := authzRepo.SetPermission("Cashier", "loans", "create", false); err != nil {
		log.Fatalf("cashier loan-create permission restriction failed: %v", err)
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

// backfillEmployeeBranch is a one-time, idempotent safety net for any
// employee row that still has no branch_id despite the app layer requiring
// one on create/update (e.g. a row that slipped through before that
// validation existed). Points it at branch 1, matching the same
// "default to branch 1" convention used elsewhere in this file. Safe to
// re-run: once every row has branch_id populated, the WHERE clause matches
// nothing.
func backfillEmployeeBranch(db *gorm.DB) error {
	if err := db.Table("employees").
		Where("branch_id IS NULL OR branch_id = 0").
		Update("branch_id", 1).Error; err != nil {
		return err
	}
	log.Printf("backfilled employees: %d row(s) -> branch_id 1", db.RowsAffected)
	return nil
}

// backfillCashMovementBranch is a one-time, idempotent step for cash
// movements whose branch_id was never set — CashMovement.BranchID is
// nullable ("not every cash movement is tied to a till yet"), but movements
// predating that column, or created via a code path that historically
// allowed a nil BranchID, ended up with no branch at all. This directly
// fixes a reported bug: the "all branches" cash-in-hand total sums every
// movement unfiltered (NULL rows included), but filtering to a single
// branch excludes them via the now-scoped repository's WHERE branch_id = ?,
// so the two totals disagreed. Points every such row at branch 1, matching
// the same convention used elsewhere in this file. Safe to re-run.
func backfillCashMovementBranch(db *gorm.DB) error {
	if err := db.Table("cash_movements").
		Where("branch_id IS NULL").
		Update("branch_id", 1).Error; err != nil {
		return err
	}
	log.Printf("backfilled cash_movements: %d row(s) -> branch_id 1", db.RowsAffected)
	return nil
}

// backfillBankPledgeBankID is a one-time, idempotent step for the new
// bank_pledge_records.bank_id column (added via AutoMigrate above as
// nullable so this migration doesn't fail against existing rows). For every
// distinct bank_name on a row still missing bank_id, it finds-or-creates a
// matching bank.Bank row (case-insensitively, via bank.Service.FindOrCreate
// — the same find-or-create convention already used for banks picked from
// the frontend's search dropdown) and points bank_id at it. Safe to re-run:
// once every row has bank_id populated, the WHERE clause matches nothing.
func backfillBankPledgeBankID(db *gorm.DB) error {
	bankRepo := bank.NewRepository(db)
	bankSvc := bank.NewService(bankRepo)

	var names []string
	if err := db.Table("bank_pledge_records").
		Where("bank_name IS NOT NULL AND bank_name <> '' AND (bank_id IS NULL OR bank_id = 0)").
		Distinct("bank_name").Pluck("bank_name", &names).Error; err != nil {
		return err
	}

	for _, name := range names {
		b, _, err := bankSvc.FindOrCreate(bank.CreateInput{Name: name})
		if err != nil {
			return err
		}
		if err := db.Table("bank_pledge_records").
			Where("bank_name = ? AND (bank_id IS NULL OR bank_id = 0)", name).
			Update("bank_id", b.ID).Error; err != nil {
			return err
		}
		log.Printf("backfilled bank_pledge_records: %d row(s) -> bank %q (id=%d)", db.RowsAffected, name, b.ID)
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
