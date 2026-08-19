// Package migrate applies GORM AutoMigrate for all domain models, plus every
// backfill and permission-seed step, against a *gorm.DB. It is the single
// source of the schema, called from two places: the API server itself on
// every boot (backend/main.go), and the standalone `go run ./cmd/migrate`
// command (useful for CI or a migrate-only invocation without starting the
// HTTP server). Both call Run so the two never drift apart.
package migrate

import (
	"log"

	"gorm.io/gorm"

	"ambikagold/backend/internal/authz"
	"ambikagold/backend/internal/bank"
	"ambikagold/backend/internal/branch"
	"ambikagold/backend/internal/cash"
	"ambikagold/backend/internal/commlog"
	"ambikagold/backend/internal/customer"
	"ambikagold/backend/internal/customerauth"
	"ambikagold/backend/internal/employee"
	"ambikagold/backend/internal/goldrate"
	"ambikagold/backend/internal/loan"
	"ambikagold/backend/internal/locker"
	"ambikagold/backend/internal/notification"
	"ambikagold/backend/internal/ornamenttype"
	"ambikagold/backend/internal/packet"
	"ambikagold/backend/internal/platform"
	"ambikagold/backend/internal/puritystandard"
	"ambikagold/backend/internal/reminder"
	"ambikagold/backend/internal/scheme"
	"ambikagold/backend/internal/settings"
)

// authResources/staffRoles seed the permissions table on every run. Kept as
// the single copy — both the server and `cmd/migrate` call Run, so there is
// no second list anywhere to drift out of sync with this one. "branches" is
// deliberately NOT in authResources — see the RestrictResourceToRole call
// below.
var authResources = []string{
	"banks", "cash", "customers", "employees", "goldrates",
	"loans", "lockers", "ornamenttypes", "packets", "puritystandards", "reminders",
	"schemes", "settings", "uploads", "kyc-documents", "reports",
}

var staffRoles = []string{
	"Administrator", "Management", "Branch Manager", "Loan Operator", "Cashier",
	"Accountant", "Collection Staff", "Auction Administrator", "Auditor",
}

// Run applies every backfill, AutoMigrate, post-migrate cleanup and
// permission seed, in the fixed order each step's own comments document as
// required. Safe to call on every server boot: every step here is either
// additive, an idempotent backfill guarded by a WHERE ... IS NULL clause, or
// a column drop that only runs after that column's data has already been
// copied forward (see the individual step doc comments for specifics).
func Run(db *gorm.DB) error {
	if err := scheme.BackfillDurationMonths(db); err != nil {
		return err
	}

	if err := scheme.BackfillBranchID(db); err != nil {
		return err
	}

	if err := loan.BackfillNullMoney(db); err != nil {
		return err
	}

	if err := goldrate.MigrateLegacyColumns(db); err != nil {
		return err
	}

	// The auction uniqueness rule must be relaxed BEFORE AutoMigrate runs:
	// GORM never drops an index it once created, so the old "one auction per
	// loan, ever" constraint would otherwise survive and keep rejecting a
	// second auction attempt regardless of what the struct tags now say.
	if err := loan.RelaxAuctionLoanUniqueIndex(db); err != nil {
		return err
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
		&loan.BankPledgeEvent{},
		&loan.AuctionRecord{},
		&loan.AuctionNotice{},
		&loan.AuctionEvent{},
		&loan.AuctionDecisionRequest{},
		&loan.LoanRequest{},
		&loan.RequestApproval{},
		&loan.ApprovalLimit{},
		// Unsubmitted New Gold Loan forms behind the "Save Draft" button.
		&loan.LoanDraft{},
		&loan.LoanDraftOrnament{},
		&ornamenttype.OrnamentType{},
		&bank.Bank{},
		&locker.Locker{},
		&packet.Packet{},
		&packet.PacketMovement{},
		&puritystandard.PurityStandard{},
		&reminder.Reminder{},
		&authz.Permission{},
		&commlog.CommunicationLog{},
		&customerauth.OTP{},
		&customerauth.DeviceToken{},
		// Realtime notifications (WebSocket, ack-and-resend) — the durable
		// in-app inbox behind the customer app's bell.
		&notification.Notification{},
	); err != nil {
		return err
	}

	if err := scheme.DropLegacyDateColumns(db); err != nil {
		return err
	}

	// loan_payments.received_by_employee_id became nullable (batch 3:
	// Razorpay/customer payments — an online payment has no employee
	// actor). GORM's AutoMigrate above only adds/alters columns to be less
	// restrictive in some drivers, but does not reliably drop an existing
	// NOT NULL constraint on Postgres, so this explicit step follows it up.
	// Idempotent: DROP NOT NULL on an already-nullable column is a no-op,
	// not an error.
	if err := db.Exec(`ALTER TABLE loan_payments ALTER COLUMN received_by_employee_id DROP NOT NULL`).Error; err != nil {
		return err
	}

	if err := puritystandard.SeedStandards(db); err != nil {
		return err
	}

	if err := loan.NormalizeLegacyPurities(db); err != nil {
		return err
	}

	if err := loan.SeedLoanOperatorLimit(db); err != nil {
		return err
	}

	if err := loan.MigrateRetiredSanctionStage(db); err != nil {
		return err
	}

	// Must run AFTER AutoMigrate: the partial indexes reference the stage/kind
	// columns, which AutoMigrate is what creates.
	if err := loan.CreateAuctionPartialIndexes(db); err != nil {
		return err
	}

	if err := backfillBranches(db); err != nil {
		return err
	}

	if err := dropLegacyBranchColumn(db); err != nil {
		return err
	}

	if err := backfillEmployeeBranch(db); err != nil {
		return err
	}

	if err := backfillCashMovementBranch(db); err != nil {
		return err
	}

	if err := backfillBankPledgeBankID(db); err != nil {
		return err
	}

	authzRepo := authz.NewRepository(db)
	inserted, skipped, err := authzRepo.SeedDefaults(staffRoles, authResources)
	if err != nil {
		return err
	}
	log.Printf("permissions seed: %d inserted, %d already present", inserted, skipped)

	nonAdminRoles := make([]string, 0, len(staffRoles))
	for _, role := range staffRoles {
		if role != platform.AdministratorRole {
			nonAdminRoles = append(nonAdminRoles, role)
		}
	}
	if err := authzRepo.RestrictResourceToRole("branches", platform.AdministratorRole, nonAdminRoles); err != nil {
		return err
	}
	if err := authzRepo.SetPermission("Cashier", "loans", "create", false); err != nil {
		return err
	}

	reportRoles := []string{"Administrator", "Management", "Branch Manager", "Auditor"}
	reportRolesSet := make(map[string]bool, len(reportRoles))
	for _, r := range reportRoles {
		reportRolesSet[r] = true
	}
	nonReportRoles := make([]string, 0, len(staffRoles))
	for _, role := range staffRoles {
		if !reportRolesSet[role] {
			nonReportRoles = append(nonReportRoles, role)
		}
	}
	if err := authzRepo.RestrictResourceToRoles("reports", reportRoles, nonReportRoles); err != nil {
		return err
	}

	log.Println("migrations applied successfully")
	return nil
}

// dropLegacyBranchColumn removes the old free-text `branch` column on
// employees/expenses once backfillBranches has copied its data into
// branch_id. Safe to re-run: HasColumn is false after the first successful
// drop, so this becomes a no-op.
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
// allowed a nil BranchID, ended up with no branch at all. Points every such
// row at branch 1, matching the same convention used elsewhere in this file.
// Safe to re-run.
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
// matching bank.Bank row (case-insensitively, via bank.Service.FindOrCreate)
// and points bank_id at it. Safe to re-run: once every row has bank_id
// populated, the WHERE clause matches nothing.
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
// it's still there for this to read from; dropping it is handled by
// dropLegacyBranchColumn right after this runs (see database_architecture.md).
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
