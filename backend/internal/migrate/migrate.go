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
	"ambikagold/backend/internal/personalloan"
	"ambikagold/backend/internal/puritystandard"
	"ambikagold/backend/internal/reminder"
	"ambikagold/backend/internal/scheme"
	"ambikagold/backend/internal/settings"
)

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

	// The legacy (role, resource, action, allowed) permissions table is being
	// replaced by the roles/permissions/role_permissions schema — must run
	// BEFORE AutoMigrate for the same reason as the auction index above:
	// AutoMigrate only adds columns the new authz.Permission struct declares,
	// it never drops the old NOT NULL role/resource/action/allowed columns or
	// their unique index, which would otherwise reject every new-shape
	// insert.
	if err := dropLegacyAuthzColumns(db); err != nil {
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
		&personalloan.PersonalLoan{},
		&personalloan.PersonalLoanInstallment{},
		&personalloan.PersonalLoanPayment{},
		&authz.Role{},
		&authz.Permission{},
		&authz.RolePermission{},
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

	if err := purgeBankPledgeMirrorExpenses(db); err != nil {
		return err
	}

	// Role/permission catalogue — see internal/authz/catalogue.go for the
	// single copy of the role list, permission catalogue and restrictions
	// both this server and `cmd/migrate` seed from.
	authzRepo := authz.NewRepository(db)
	if err := authzRepo.SeedRoles(authz.StaffRoles); err != nil {
		return err
	}
	if err := authzRepo.SeedCatalogue(authz.Catalogue); err != nil {
		return err
	}
	// Must run BEFORE BackfillGrants: it copies each new "can create/update/
	// delete <noun>" grant from that role's existing "can change <noun>" row,
	// rather than the generic backfill's default-grant-TRUE, since these are
	// finer-grained authorities than the blanket "change" permission they
	// split from (see the CRUDSplitNouns/BackfillCRUDSplitGrants doc comments
	// for the deliberate deviation from the house standard's view/change
	// default).
	splitInserted, err := authzRepo.BackfillCRUDSplitGrants(authz.CRUDSplitNouns)
	if err != nil {
		return err
	}
	log.Printf("permissions seed: %d create/update/delete role_permissions row(s) back-filled from existing change grants", splitInserted)
	// Runs immediately after the copy-forward above and BEFORE BackfillGrants:
	// the blanket "can change <noun>" permissions are gone from the catalogue,
	// so their leftover rows are dropped once their grants have been carried
	// onto create/update/delete (and, for role permissions, onto "can update
	// role") — see authz.Repository.PurgeLegacyChangePermissions.
	purged, err := authzRepo.PurgeLegacyChangePermissions()
	if err != nil {
		return err
	}
	log.Printf("permissions seed: %d legacy \"can change ...\" permission(s) purged", purged)
	inserted, err := authzRepo.BackfillGrants()
	if err != nil {
		return err
	}
	log.Printf("permissions seed: %d role_permissions row(s) back-filled", inserted)
	if err := authzRepo.ApplyRestrictions(authz.Restrictions); err != nil {
		return err
	}

	// Bootstrap Administrator — create-only, so a fresh database always has
	// a way in, while an existing admin's password/role is never reverted on
	// a later boot. Runs BEFORE backfillEmployeeRoleID so the row it creates
	// gets its role_id filled in on the same pass. `go run ./cmd/seedadmin`
	// calls the same function with reset=true as the lockout escape hatch.
	if err := employee.SeedAdmin(db, false); err != nil {
		return err
	}

	if err := backfillEmployeeRoleID(db, authzRepo); err != nil {
		return err
	}

	log.Println("migrations applied successfully")
	return nil
}

// backfillEmployeeRoleID keeps employees.role_id in sync with the free-text
// employees.role column on every boot — RoleID is the authorization key
// (see internal/authz), Role stays the field employee.Service actually
// reads/writes, so this is the one place the two are reconciled rather than
// threading a role lookup through employee.Service itself. Idempotent: only
// rows whose role_id doesn't already match their role name are touched.
func backfillEmployeeRoleID(db *gorm.DB, authzRepo *authz.Repository) error {
	for _, name := range authz.StaffRoles {
		roleID, err := authzRepo.RoleIDByName(name)
		if err != nil {
			return err
		}
		if err := db.Table("employees").
			Where("role = ? AND (role_id IS NULL OR role_id <> ?)", name, roleID).
			Update("role_id", roleID).Error; err != nil {
			return err
		}
		if db.RowsAffected > 0 {
			log.Printf("backfilled employees: %d row(s) role %q -> role_id %d", db.RowsAffected, name, roleID)
		}
	}
	return nil
}

// dropLegacyAuthzColumns drops the whole "permissions" table if it still has
// the old (role, resource, action, allowed) shape from the pre-role-
// permission-standard authz.Permission. AutoMigrate recreates it fresh in
// the new (name, description, module_name, is_active) shape immediately
// after. A plain DropColumn would not work here: the new `name` column is
// NOT NULL with no default, and Postgres refuses to add a NOT NULL column
// to a table that still has rows — the old rows carry no meaningful data
// under the new shape anyway (SeedCatalogue/BackfillGrants below repopulate
// everything from internal/authz.Catalogue), so dropping and recreating is
// simpler and safer than trying to migrate them in place. Safe to re-run:
// HasColumn is false once the table has already been recreated in the new
// shape.
func dropLegacyAuthzColumns(db *gorm.DB) error {
	if !db.Migrator().HasColumn("permissions", "resource") {
		return nil
	}
	if err := db.Migrator().DropTable("permissions"); err != nil {
		return err
	}
	log.Println("dropped legacy permissions table (role/resource/action shape) — recreating in the new roles/permissions/role_permissions shape")
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

// purgeBankPledgeMirrorExpenses removes the auto-generated "Bank Pledge"
// expense rows that RecordBankPledge used to write alongside its cash-in
// movement. The bank's advance against pledged gold is borrowing, not
// spending, so mirroring it as an expense double-counted a single pledge as
// both Cash In and Expenses on the same day and inflated the expense
// register, the expense-cashflow report and the dashboard's expense donut.
// Pledging now books cash in only; the expense is booked at release
// (see loan.CashRecorder / cash.MovementService.RecordBankPledgeReleaseExpense).
//
// Both predicates matter. Category alone would also match a manually
// entered expense that staff happened to file under "Bank Pledge"; the
// Remarks string is written only by cash.recordSystemExpense, so requiring
// it confines the delete to system-generated rows. "Bank Pledge Release"
// rows are a different category and are deliberately left alone.
//
// Idempotent: once the rows are gone the DELETE matches nothing. The
// matching bank_pledge_records.expense_id links are nulled first so no
// pledge is left pointing at a deleted expense.
func purgeBankPledgeMirrorExpenses(db *gorm.DB) error {
	const mirrorRemark = "Auto-recorded from bank pledge workflow"

	if err := db.Exec(`
		UPDATE bank_pledge_records SET expense_id = NULL
		WHERE expense_id IS NOT NULL AND expense_id IN (
			SELECT id FROM expenses WHERE category = ? AND remarks = ?
		)`, "Bank Pledge", mirrorRemark).Error; err != nil {
		return err
	}

	res := db.Exec(`DELETE FROM expenses WHERE category = ? AND remarks = ?`,
		"Bank Pledge", mirrorRemark)
	if res.Error != nil {
		return res.Error
	}
	if res.RowsAffected > 0 {
		log.Printf("purged %d mirrored bank-pledge expense row(s) — pledges are cash-in only", res.RowsAffected)
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
