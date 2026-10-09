// Package migrate applies GORM AutoMigrate for all domain models, plus every
// backfill and permission-seed step, against a *gorm.DB. It is the single
// source of the schema, called from two places: the API server itself on
// every boot (backend/main.go), and the standalone `go run ./cmd/migrate`
// command (useful for CI or a migrate-only invocation without starting the
// HTTP server). Both call Run so the two never drift apart.
package migrate

import (
	"context"
	"fmt"
	"log"

	"gorm.io/gorm"

	"cloudhouse/backend/internal/auditlog"
	"cloudhouse/backend/internal/authz"
	"cloudhouse/backend/internal/bank"
	"cloudhouse/backend/internal/branch"
	"cloudhouse/backend/internal/cash"
	"cloudhouse/backend/internal/commlog"
	"cloudhouse/backend/internal/customer"
	"cloudhouse/backend/internal/customerauth"
	"cloudhouse/backend/internal/dashboard"
	"cloudhouse/backend/internal/employee"
	"cloudhouse/backend/internal/goldrate"
	"cloudhouse/backend/internal/investment"
	"cloudhouse/backend/internal/loan"
	"cloudhouse/backend/internal/locker"
	"cloudhouse/backend/internal/notification"
	"cloudhouse/backend/internal/ornamenttype"
	"cloudhouse/backend/internal/packet"
	"cloudhouse/backend/internal/personalloan"
	"cloudhouse/backend/internal/platform"
	"cloudhouse/backend/internal/puritystandard"
	"cloudhouse/backend/internal/reminder"
	"cloudhouse/backend/internal/scheme"
	"cloudhouse/backend/internal/settings"
	"cloudhouse/backend/internal/superadmin"
	"cloudhouse/backend/internal/tenant"
	"cloudhouse/backend/internal/upload"
	"cloudhouse/backend/internal/workflow"
)

// Run applies every backfill, AutoMigrate, post-migrate cleanup and
// permission seed, in the fixed order each step's own comments document as
// required. Safe to call on every server boot: every step here is either
// additive, an idempotent backfill guarded by a WHERE ... IS NULL clause, or
// a column drop that only runs after that column's data has already been
// copied forward (see the individual step doc comments for specifics).
//
// cfg supplies the one thing this step needs from the environment rather
// than the database: SuperAdminBootstrapUsername/Password/Name, for seeding the
// very first superadmin console login (see superadmin.SeedBootstrapUser). Everything
// else Run does is fully self-contained.
func Run(db *gorm.DB, cfg platform.Config) error {
	// Migrations run outside any request and legitimately span every
	// business. This is the single largest deliberate exemption from tenant
	// filtering in the codebase; see platform.AllowCrossTenant.
	ctx := platform.AllowCrossTenant(context.Background())
	if err := scheme.BackfillDurationMonths(db); err != nil {
		return err
	}

	if err := scheme.BackfillBranchID(db); err != nil {
		return err
	}

	if err := loan.BackfillNullMoney(db); err != nil {
		return err
	}

	// goldrate.MigrateLegacyColumns used to run here — retired now that
	// K22/K18 are live struct fields again (see goldrate.GoldRate's doc
	// comment): that step's whole premise (renaming k22/k18 away because
	// nothing used them) is now backwards, and re-running it against a DB
	// that already has both the historical legacy_k22/legacy_k18 columns
	// AND live k22/k18 columns fails outright (RENAME onto an
	// already-occupied name). Nothing reads legacy_k22/legacy_k18 going
	// forward; they stay orphaned in the schema, harmlessly.

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

	// gold_sales grew NOT NULL money columns after it shipped; AutoMigrate
	// cannot add those to a table that already has rows. See
	// cash.BackfillGoldSaleColumns - must run BEFORE AutoMigrate.
	if err := cash.BackfillGoldSaleColumns(db); err != nil {
		return err
	}

	// opening_cash_balances became per-mode. See
	// cash.PrepareOpeningBalanceMode - must run BEFORE AutoMigrate.
	if err := cash.PrepareOpeningBalanceMode(db); err != nil {
		return err
	}

	// personal_loans grew a NOT NULL full_disbursement column after it
	// shipped — same AutoMigrate limitation as gold_sales above. See
	// personalloan.BackfillFullDisbursementColumn - must run BEFORE
	// AutoMigrate.
	if err := personalloan.BackfillFullDisbursementColumn(db); err != nil {
		return err
	}

	// personal_loans grew NOT NULL penal-interest columns after it shipped —
	// same AutoMigrate limitation as above. See
	// personalloan.BackfillPenalColumns - must run BEFORE AutoMigrate.
	if err := personalloan.BackfillPenalColumns(db); err != nil {
		return err
	}

	// personal_loans and bank_pledge_records grew NOT NULL payment-mode
	// columns (how a disbursement / pledge advance was paid) — same AutoMigrate
	// limitation as above. Must run BEFORE AutoMigrate.
	if err := personalloan.BackfillDisbursementSplitColumns(db); err != nil {
		return err
	}
	if err := loan.BackfillBankPledgeSplitColumns(db); err != nil {
		return err
	}

	// loan_payments/personal_loan_payments/investment_payouts all grew NOT
	// NULL split-mode columns after they shipped — same AutoMigrate
	// limitation as gold_sales above, plus (for the first two) a one-time
	// exact-mapping backfill of the pre-existing free-text Method into
	// exactly one split column. Must run BEFORE AutoMigrate.
	if err := loan.BackfillPaymentSplitColumns(db); err != nil {
		return err
	}
	if err := personalloan.BackfillPaymentSplitColumns(db); err != nil {
		return err
	}
	if err := investment.BackfillPayoutSplitColumns(db); err != nil {
		return err
	}
	if err := investment.BackfillEngineColumn(db); err != nil {
		return err
	}

	if err := db.AutoMigrate(allModels...); err != nil {
		return err
	}

	if err := scheme.DropLegacyDateColumns(db); err != nil {
		return err
	}

	if err := cash.EnsureOpeningBalanceModeIndex(db); err != nil {
		return err
	}

	if err := cash.BackfillInvestmentDepositParty(db); err != nil {
		return err
	}

	if err := cash.BackfillGoldPurchaseCostMode(db); err != nil {
		return err
	}

	// Pledge movements first (it spots unlinked legacy pledge-ins by their
	// blank mode), then the missing movements, then the blank-mode fill-in.
	if err := cash.BackfillBankPledgeBranch(db); err != nil {
		return err
	}
	if err := cash.BackfillMissingLoanMovements(db); err != nil {
		return err
	}
	if err := cash.BackfillBlankMovementMode(db); err != nil {
		return err
	}

	// Must run AFTER AutoMigrate: it backfills the scheme_* snapshot columns
	// AutoMigrate itself creates on loans. See loan.BackfillSchemeSnapshot.
	if err := loan.BackfillSchemeSnapshot(db); err != nil {
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

	// categories replaced cash_sources + expense_categories - copy the legacy
	// rows over once, after AutoMigrate created the table and before seeding.
	if err := cash.MigrateCategories(db); err != nil {
		return err
	}

	if err := cash.SeedDefaultSourcesAndCategories(db); err != nil {
		return err
	}

	if err := loan.NormalizeLegacyPurities(db); err != nil {
		return err
	}

	if err := loan.MigrateRetiredSanctionStage(db); err != nil {
		return err
	}

	if err := personalloan.BackfillRenewedLoanInstallments(db); err != nil {
		return err
	}

	if err := personalloan.BackfillRenewedLoanStatus(db); err != nil {
		return err
	}

	// Must run AFTER AutoMigrate: the partial indexes reference the stage/kind
	// columns, which AutoMigrate is what creates.
	if err := loan.CreateAuctionPartialIndexes(db); err != nil {
		return err
	}

	if err := loan.BackfillAuctionedLoanStatus(db); err != nil {
		return err
	}

	if err := loan.BackfillRejectedLoanStatus(db); err != nil {
		return err
	}

	// Must run AFTER the loan backfill above — it reads loans.status to
	// decide which packets are stuck.
	if err := packet.BackfillAuctionedPacketStatus(db); err != nil {
		return err
	}

	// Partial Ornament Release: both must run AFTER AutoMigrate (they write
	// into columns AutoMigrate itself creates — see each function's own doc
	// comment for why this ordering, unlike some other steps in this file,
	// is a same-table copy rather than a pre-AutoMigrate NOT-NULL
	// workaround).
	if err := loan.BackfillReleaseChecklistColumns(db); err != nil {
		return err
	}
	if err := loan.BackfillPacketWeightTotals(db); err != nil {
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

	if err := backfillCashMovementBankID(db); err != nil {
		return err
	}

	if err := purgeBankPledgeMirrorExpenses(db); err != nil {
		return err
	}

	// Role/permission catalogue — see internal/authz/catalogue.go for the
	// single copy of the role list, permission catalogue and restrictions
	// both this server and `cmd/migrate` seed from.
	authzRepo := authz.NewRepository(db)
	if err := authzRepo.SeedRoles(ctx, authz.StaffRoles); err != nil {
		return err
	}
	// Before any backfill reads role_permissions: grants written by earlier
	// boots' cross-tenant backfills were never stamped with their role's
	// tenant and got swept to the default one, where the business that owns
	// the role cannot see them — its Roles & Permissions screen came up empty.
	// A grant belongs to its role's business; re-file any that say otherwise.
	// No-op once repaired.
	if res := db.Exec(`UPDATE role_permissions rp SET tenant_id = r.tenant_id
		FROM roles r WHERE r.id = rp.role_id AND rp.tenant_id <> r.tenant_id`); res.Error != nil {
		return fmt.Errorf("re-filing role_permissions under their role's business: %w", res.Error)
	} else if res.RowsAffected > 0 {
		log.Printf("permissions seed: %d role_permissions row(s) re-filed under their role's business", res.RowsAffected)
	}

	// Renames first, so each renamed permission keeps its row (and every
	// role's grant of it) instead of being re-seeded fresh under the new name.
	if _, err := authzRepo.RenamePermissions(ctx, authz.PermissionRenames); err != nil {
		return err
	}
	seededNames, err := authzRepo.SeedCatalogue(ctx, authz.Catalogue)
	if err != nil {
		return err
	}
	seededNow := make(map[string]bool, len(seededNames))
	for _, n := range seededNames {
		seededNow[n] = true
	}
	var resyncDefs []authz.PermissionDef
	for _, def := range authz.Catalogue {
		for _, n := range authz.ResyncedDescriptions {
			if def.Name == n {
				resyncDefs = append(resyncDefs, def)
			}
		}
	}
	if _, err := authzRepo.RegroupModules(resyncDefs); err != nil {
		return err
	}
	// Resyncs the approval -stage permissions' ModuleName back onto the four
	// split-out modules (Loan Sanction / Loan Extension Approval / Release
	// Approval / Auction Workflow) — SeedCatalogue above never touches an
	// already-seeded permission row, so an install that seeded these under
	// the original lumped "Approval Workflow" module would otherwise stay
	// stuck there forever even after this file's own grouping changed. See
	// authz.ApprovalModuleNames' doc comment for why this is safe to do
	// unconditionally (unlike SeedCatalogue's general policy) for exactly
	// these permissions.
	var approvalDefs []authz.PermissionDef
	for _, def := range authz.Catalogue {
		for _, m := range authz.ApprovalModuleNames {
			if def.ModuleName == m {
				approvalDefs = append(approvalDefs, def)
				break
			}
		}
	}
	regrouped, err := authzRepo.RegroupModules(approvalDefs)
	if err != nil {
		return err
	}
	if regrouped > 0 {
		log.Printf("permissions seed: %d approval permission(s) regrouped onto their split modules", regrouped)
	}
	// Must run BEFORE BackfillGrants: it copies each new "can create/update/
	// delete <noun>" grant from that role's existing "can change <noun>" row,
	// rather than the generic backfill's default-grant-TRUE, since these are
	// finer-grained authorities than the blanket "change" permission they
	// split from (see the CRUDSplitNouns/BackfillCRUDSplitGrants doc comments
	// for the deliberate deviation from the house standard's view/change
	// default).
	splitInserted, err := authzRepo.BackfillCRUDSplitGrants(ctx, authz.CRUDSplitNouns)
	if err != nil {
		return err
	}
	log.Printf("permissions seed: %d create/update/delete role_permissions row(s) back-filled from existing change grants", splitInserted)
	// Runs immediately after the copy-forward above and BEFORE BackfillGrants:
	// the blanket "can change <noun>" permissions are gone from the catalogue,
	// so their leftover rows are dropped once their grants have been carried
	// onto create/update/delete (and, for role permissions, onto "can update
	// role") — see authz.Repository.PurgeLegacyChangePermissions.
	purged, err := authzRepo.PurgeLegacyChangePermissions(ctx)
	if err != nil {
		return err
	}
	log.Printf("permissions seed: %d legacy \"can change ...\" permission(s) purged", purged)
	// A brand-new permission that splits off an existing one starts with that
	// one's grants (see NewPermissionGrantCopies) — BEFORE BackfillGrants,
	// which would otherwise default it to true for every role.
	for _, cp := range authz.NewPermissionGrantCopies {
		if _, err := authzRepo.CopyGrants(ctx, cp.To, cp.From); err != nil {
			return err
		}
	}
	if _, err := authzRepo.PurgePermissions(ctx, authz.RemovedPermissions); err != nil {
		return err
	}
	inserted, err := authzRepo.BackfillGrants(ctx)
	if err != nil {
		return err
	}
	log.Printf("permissions seed: %d role_permissions row(s) back-filled", inserted)
	// Restrictions are first-time defaults: applied only to permissions this
	// boot just seeded, so an admin's edits on the Roles screen survive a
	// restart instead of being reset to the hardcoded lists every time.
	var newRestrictions []authz.RoleRestriction
	for _, rr := range authz.Restrictions {
		if seededNow[rr.PermissionName] {
			newRestrictions = append(newRestrictions, rr)
		}
	}
	if err := authzRepo.ApplyRestrictions(ctx, newRestrictions); err != nil {
		return err
	}
	// Last: a child permission granted while its parent is off cannot work,
	// so it is revoked (see authz/dependencies.go).
	if _, err := authzRepo.EnforceDependencies(ctx); err != nil {
		return err
	}
	// The Administrator of every business holds every permission, always.
	if _, err := authzRepo.GrantAllToSystemRoles(ctx); err != nil {
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

	// Bootstrap the first superadmin console login — same create-only shape as
	// SeedAdmin above, but from env vars rather than a hardcoded password;
	// see superadmin.SeedBootstrapUser's doc comment for why. superadmin_users is
	// NOT tenant-scoped, so this has no ordering dependency on the tenancy
	// backfill below and could in principle run anywhere in this function —
	// kept next to SeedAdmin because both answer the same question
	// ("how does anyone get in on a fresh database") for their own domain.
	if err := superadmin.SeedBootstrapUser(db, cfg.SuperAdminBootstrapUsername, cfg.SuperAdminBootstrapPassword, cfg.SuperAdminBootstrapName); err != nil {
		return err
	}

	if err := backfillEmployeeRoleID(db); err != nil {
		return err
	}

	// Tenancy is applied LAST, and the ordering is load-bearing.
	//
	// Every seeding step above creates rows: authz seeds 9 roles and ~620
	// grants, SeedAdmin creates an employee and a "Head Office" branch,
	// puritystandard seeds 15 rows. Run the backfill before them and all of
	// those arrive with tenant_id = 0 — which satisfies NOT NULL, so nothing
	// complains, and the result is a fresh install whose admin cannot log in
	// and whose roles belong to no business. That is exactly what happened
	// when this ran earlier in the sequence.
	//
	// Being last also means it is the single point where "every row has a
	// tenant" becomes true, so the NOT NULL and the composite unique indexes
	// can both be applied with confidence.
	// Must run BEFORE backfillTenancy, which would otherwise hand these rows
	// to the default business as if they were its own.
	if err := purgeGlobalDashboardSnapshots(db); err != nil {
		return err
	}

	// Must run BEFORE backfillTenancy — see backfillTenantFromParent.
	if err := backfillTenantFromParent(db); err != nil {
		return err
	}

	if err := backfillTenancy(db); err != nil {
		return err
	}

	if err := createTenantCompositeUniques(db); err != nil {
		return err
	}
	if err := createCustomerPhoneUnique(db); err != nil {
		return err
	}
	if err := createCustomerKYCUnique(db); err != nil {
		return err
	}

	// Last, and only after every tenant_id is populated and NOT NULL: the
	// policies below compare against that column, so applying them earlier
	// would be comparing against nulls.
	if err := applyRowLevelSecurity(db); err != nil {
		return err
	}

	// Must run AFTER backfillTenancy: every record it creates inherits the
	// tenant of the row that references the file, so those rows need their
	// own tenant_id populated first.
	if err := backfillUploadedFiles(db); err != nil {
		return err
	}

	if err := backfillTenantGrantColumns(db); err != nil {
		return err
	}

	if err := backfillEmptyBranchNames(db); err != nil {
		return err
	}

	// Deliberately LAST: stamping the version is how the API server (which
	// no longer runs Run itself — see CheckSchemaVersion, Step 12) knows
	// migrations actually completed. If any step above this one starts
	// failing, the version must not be stamped, so the server keeps
	// refusing to start against a half-migrated database instead of
	// guessing it's fine.
	if err := stampSchemaVersion(db); err != nil {
		return err
	}

	log.Println("migrations applied successfully")
	return nil
}

// backfillEmptyBranchNames repairs the specific, previously-documented bug
// in branch.Repository.FirstOrCreateByName: a raw string Where("name = ?", …)
// condition gives GORM's FirstOrCreate nothing it can read a column value
// back out of, so every branch it ever created — including the very first
// "Head Office" this app seeds for a brand new installation — was inserted
// with an EMPTY name, and branch.FindAll's `WHERE name <> ”` then made it
// invisible in the branch list forever. Confirmed to have hit the CURRENT
// default tenant's own Head Office, not just a theoretical case.
//
// One name only, "Head Office", because that is the one and only literal
// FirstOrCreateByName has ever been called with (employee.SeedAdmin,
// superadmin.Service.CreateBusiness) — there is no other empty-named branch this
// backfill could be guessing wrong.
func backfillEmptyBranchNames(db *gorm.DB) error {
	res := db.Exec(`UPDATE branches SET name = 'Head Office' WHERE name = ''`)
	if res.Error != nil {
		return res.Error
	}
	if res.RowsAffected > 0 {
		log.Printf("tenancy: repaired %d branch(es) with an empty name (see branch.Repository.FirstOrCreateByName's fix)", res.RowsAffected)
	}
	return nil
}

// backfillEmployeeRoleID keeps employees.role_id in sync with the free-text
// employees.role column on every boot — RoleID is the authorization key
// (see internal/authz), Role stays the field employee.Service actually
// reads/writes, so this is the one place the two are reconciled rather than
// threading a role lookup through employee.Service itself. Idempotent: only
// rows whose role_id doesn't already match their role name are touched.
// backfillEmployeeRoleID keeps employees.role_id in sync with the free-text
// Role name every create/update actually writes (employee.Service.Update
// never touches RoleID itself — see its doc comment) — this backfill is the
// only thing that makes RoleID, the field RequirePermission actually checks
// permissions against, agree with it.
//
// FIXED 2026-08-29 — this used to be a SEVERE, silently-corrupting
// cross-tenant bug, found while investigating Step 8's token invalidation,
// not by any test: for each role NAME, it resolved role.ID with a SINGLE
// unscoped lookup (authzRepo.RoleIDByName under AllowCrossTenant, which
// returns whichever tenant's row Postgres happens to return first — in
// practice tenant 1's) and then applied THAT ONE ID in a raw, equally
// unscoped UPDATE against every employee in the ENTIRE employees table whose
// Role name matched, regardless of which business they belonged to.
//
// Confirmed by direct inspection, not merely reasoned about: after two
// businesses' Administrator roles were seeded with real per-tenant ids (10
// and 19), a single re-run of this function silently rewrote BOTH
// employees' role_id back down to 1 — tenant 1's Administrator role.
// Because RequirePermission resolves permissions by (the caller's own
// tenant, this roleId), the corrupted id belongs to a role_permissions set
// scoped to a DIFFERENT tenant, so the join finds nothing and every
// permission check for that employee starts returning "Permission not
// found" — for EVERY employee of EVERY tenant but one, on the very next
// login after ANY server restart or `cmd/migrate` run (this function runs
// on every migrate.Run call). It was undetected by the isolation harness
// only because the harness mints its test tokens with the correct roleId
// baked in directly, bypassing this column entirely, and by the one real
// end-to-end login test in this session only because no restart happened
// between creating that business and testing it.
//
// The fix is one set-based, per-tenant-correct statement: join employees to
// roles ON tenant_id, so a row can only ever be matched to a role belonging
// to its OWN business — there is no longer a step where one tenant's id is
// resolved and then applied elsewhere.
func backfillEmployeeRoleID(db *gorm.DB) error {
	ctx := platform.AllowCrossTenant(context.Background())
	res := db.WithContext(ctx).Exec(`
		UPDATE employees e
		SET role_id = r.id
		FROM roles r
		WHERE r.tenant_id = e.tenant_id
		  AND r.name = e.role
		  AND (e.role_id IS NULL OR e.role_id <> r.id)`)
	if res.Error != nil {
		return res.Error
	}
	if res.RowsAffected > 0 {
		log.Printf("backfilled employees: %d row(s) role_id corrected to match their own tenant's role", res.RowsAffected)
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
	ctx := platform.AllowCrossTenant(context.Background())
	bankRepo := bank.NewRepository(db)
	bankSvc := bank.NewService(bankRepo)

	var names []string
	if err := db.Table("bank_pledge_records").
		Where("bank_name IS NOT NULL AND bank_name <> '' AND (bank_id IS NULL OR bank_id = 0)").
		Distinct("bank_name").Pluck("bank_name", &names).Error; err != nil {
		return err
	}

	for _, name := range names {
		b, _, err := bankSvc.FindOrCreate(ctx, bank.CreateInput{Name: name})
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

// backfillCashMovementBankID is cash_movements' counterpart to
// backfillBankPledgeBankID above — same "one bank.Bank row per distinct
// existing free-text value, case-sensitive first pass" approach, expected to
// create near-duplicates ("HDFC", "HDFC Bank", "HDFC BANK LTD" as three
// separate rows) — that's expected, not a bug this step tries to solve with
// fuzzy matching; the Bank Management page's "merge duplicate bank" action
// is where staff clean this up manually over time. Must run AFTER
// AutoMigrate, since it needs cash_movements.bank_id (a plain nullable
// column AutoMigrate adds itself, unlike the NOT NULL split columns above).
func backfillCashMovementBankID(db *gorm.DB) error {
	ctx := platform.AllowCrossTenant(context.Background())
	bankRepo := bank.NewRepository(db)
	bankSvc := bank.NewService(bankRepo)

	var names []string
	if err := db.Table("cash_movements").
		Where("bank IS NOT NULL AND bank <> '' AND bank_id IS NULL").
		Distinct("bank").Pluck("bank", &names).Error; err != nil {
		return err
	}

	for _, name := range names {
		b, _, err := bankSvc.FindOrCreate(ctx, bank.CreateInput{Name: name})
		if err != nil {
			return err
		}
		res := db.Table("cash_movements").
			Where("bank = ? AND bank_id IS NULL", name).
			Update("bank_id", b.ID)
		if res.Error != nil {
			return res.Error
		}
		log.Printf("backfilled cash_movements: %d row(s) -> bank %q (id=%d)", res.RowsAffected, name, b.ID)
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

// tenantScopedTables lists every table carrying a tenant_id, i.e. every
// model embedding platform.TenantScoped.
//
// This used to be a second, hand-maintained copy of the set in
// platform/tenant_gorm.go, and the two drifted: gold_sales, investments,
// investment_plans, investment_payouts and audit_log_entries were added to
// the runtime filter but never here, so those tables were scoped on every
// query while the database never made tenant_id mandatory on them. That is
// how a gold_sales row with tenant_id = 0 came to exist. There is now one
// definition, and this reads from it.
//
// The deliberate omissions live with that definition — `permissions` (the
// global catalogue) and `api_key_settings` (shared credentials, by product
// decision); see platform.TenantScoped's doc comment.
func tenantScopedTables() []string { return platform.TenantScopedTableNames() }

// backfillTenancy seeds the tier catalogue and the single tenant that all
// pre-multi-tenancy data belongs to, points every existing row at it, and
// only THEN makes tenant_id mandatory.
//
// That order is the whole point and must not be rearranged: AutoMigrate adds
// tenant_id as nullable (platform.TenantScoped deliberately carries no
// `not null` tag), because adding a NOT NULL column to a table that already
// has rows fails outright. Same shape as scheme.BackfillBranchID, which
// established this pattern in the codebase.
//
// Idempotent: the UPDATE matches only rows still lacking a tenant, and the
// ALTER is a no-op once applied. Runs on every boot, like everything else in
// this file, so it must stay cheap when there is nothing to do.
func backfillTenancy(db *gorm.DB) error {
	if err := tenant.Seed(db); err != nil {
		return fmt.Errorf("seeding tiers: %w", err)
	}
	def, err := tenant.EnsureDefault(db)
	if err != nil {
		return fmt.Errorf("ensuring default tenant: %w", err)
	}

	for _, table := range tenantScopedTables() {
		res := db.Exec(fmt.Sprintf(
			`UPDATE %s SET tenant_id = ? WHERE tenant_id IS NULL OR tenant_id = 0`, table), def.ID)
		if res.Error != nil {
			return fmt.Errorf("backfilling tenant_id on %s: %w", table, res.Error)
		}
		if res.RowsAffected > 0 {
			log.Printf("tenancy: backfilled %d row(s) in %s -> tenant %d", res.RowsAffected, table, def.ID)
		}
	}

	// Now that no row can be missing one, make it mandatory. A row created
	// without a tenant from here on is a bug we want to hear about as a
	// constraint violation, not discover later as data nobody can see.
	for _, table := range tenantScopedTables() {
		if err := db.Exec(fmt.Sprintf(
			`ALTER TABLE %s ALTER COLUMN tenant_id SET NOT NULL`, table)).Error; err != nil {
			return fmt.Errorf("enforcing tenant_id NOT NULL on %s: %w", table, err)
		}
	}

	return seedTenantSequences(db, def.ID)
}

// seedTenantSequences points each per-tenant code sequence past the codes
// that already exist, so the first loan created after this migration is
// LN-00022 and not a collision with LN-00001.
//
// The highest existing code is read from the code column itself rather than
// from a row count: rows can be deleted, and a count would then re-issue a
// number already printed on a customer's document.
func seedTenantSequences(db *gorm.DB, tenantID uint) error {
	for _, s := range []struct {
		kind   string
		table  string
		column string
		prefix string
	}{
		{platform.SeqLoan, "loans", "loan_number", "LN-"},
		{platform.SeqCustomer, "customers", "code", "CUST-"},
		{platform.SeqEmployee, "employees", "code", "EMP-"},
		{platform.SeqPacket, "packets", "code", "PKT-"},
		{platform.SeqScheme, "schemes", "code", "SCH-"},
	} {
		var highest uint64
		// Strips the prefix and takes the numeric maximum. Codes that don't
		// match the expected shape (hand-entered, or from an older format)
		// are ignored rather than crashing the boot — worst case the
		// sequence starts lower and the unique index catches a collision.
		q := fmt.Sprintf(`
			SELECT COALESCE(MAX(NULLIF(regexp_replace(%s, '^%s', ''), '')::bigint), 0)
			FROM %s
			WHERE tenant_id = ? AND %s ~ ('^%s[0-9]+$')`,
			s.column, s.prefix, s.table, s.column, s.prefix)
		if err := db.Raw(q, tenantID).Scan(&highest).Error; err != nil {
			return fmt.Errorf("reading highest %s code: %w", s.kind, err)
		}
		if err := platform.SeedSequenceFrom(db, tenantID, s.kind, highest); err != nil {
			return fmt.Errorf("seeding %s sequence: %w", s.kind, err)
		}
		if highest > 0 {
			log.Printf("tenancy: %s sequence for tenant %d starts after %d", s.kind, tenantID, highest)
		}
	}
	return nil
}

// tenantUniqueIndex describes one constraint moving from "unique across the
// whole system" to "unique within one business".
type tenantUniqueIndex struct {
	Table     string
	OldIndex  string // the single-column unique GORM created; dropped if still unique
	NewIndex  string
	Columns   string // the columns AFTER tenant_id
	Predicate string // optional WHERE, preserving an existing partial index
}

// tenantUniqueIndexes is the constraint audit from
// documents/multitenancy_step0.md, in executable form.
//
// Every one of these currently means "only ONE of your paying customers may
// ever use this value" — the second business's first loan is LN-00001 and is
// rejected outright. This is the change that actually makes a second tenant
// possible; without it the rest of the tenancy work is inert.
//
// Deliberately NOT here, and each for a reason:
//   - permissions.name, api_key_settings.category, customer_device_tokens
//     .token_hash — genuinely global (catalogue, shared credentials, and a
//     random token whose collision must be rejected whoever owns it).
//   - role_permissions(role_id, permission_id), opening_cash_balances
//     (branch_id, balance_date), ornament_purity_tests.ornament_id, and the
//     partial auction indexes — already scoped by a foreign key whose parent
//     belongs to exactly one tenant, so they need no change.
var tenantUniqueIndexes = []tenantUniqueIndex{
	{"loans", "idx_loans_loan_number", "uq_loans_tenant_loan_number", "loan_number", ""},
	{"customers", "idx_customers_code", "uq_customers_tenant_code", "code", ""},
	{"employees", "idx_employees_code", "uq_employees_tenant_code", "code", ""},
	{"packets", "idx_packets_code", "uq_packets_tenant_code", "code", ""},
	{"schemes", "idx_schemes_code", "uq_schemes_tenant_code", "code", ""},
	// Branch code is optional on every form, so blank codes must stay exempt
	// or a business's second code-less branch collides with its first.
	{"branches", "idx_branches_code", "uq_branches_tenant_code", "code", "code <> ''"},
	{"branches", "idx_branches_name", "uq_branches_tenant_name", "name", ""},
	{"lockers", "idx_lockers_code", "uq_lockers_tenant_code", "code", ""},
	{"banks", "idx_banks_name", "uq_banks_tenant_name", "name", ""},
	{"ornament_types", "idx_ornament_types_name", "uq_ornament_types_tenant_name", "name", ""},
	{"roles", "idx_roles_name", "uq_roles_tenant_name", "name", ""},
	{"approval_limits", "idx_approval_limits_role", "uq_approval_limits_tenant_role", "role", ""},
	{"approval_stage_settings", "idx_approval_stage_settings_flow_stage", "uq_approval_stage_settings_tenant_flow_stage", "flow, stage", ""},
	{"approval_chains", "idx_approval_chains_scope", "uq_approval_chains_tenant_scope", "scope", ""},
	{"approval_category_modes", "idx_approval_category_modes_category", "uq_approval_category_modes_tenant_category", "category", ""},

	// Both of these were missed when this list was first written, and both
	// are generated per business exactly like loans.loan_number above — the
	// first personal loan of EVERY business is PL-00001. Global uniqueness
	// therefore meant the business that created one first permanently owned
	// that number, and every other business hit 23505 on its own first
	// personal loan (which is how this was found: a demo reseed died on
	// "PL-00001" that belonged to a different business entirely).
	{"personal_loans", "idx_personal_loans_loan_number", "uq_personal_loans_tenant_loan_number", "loan_number", ""},
	{"investments", "idx_investments_investment_number", "uq_investments_tenant_investment_number", "investment_number", ""},

	// Login identifiers. Per-business by decision: two businesses may each
	// employ a "ravi", and one person may genuinely work for two of them.
	// The partial predicates are carried over verbatim from the indexes they
	// replace — blank usernames/phones/emails must stay exempt, or every
	// employee without one collides with every other.
	{"employees", "idx_employees_username", "uq_employees_tenant_username", "username", "username <> ''"},
	{"employees", "idx_employees_phone", "uq_employees_tenant_phone", "phone", "phone <> ''"},
	{"employees", "idx_employees_email", "uq_employees_tenant_email", "email", "email <> ''"},

	// A borrower may borrow from two businesses; each issues its own OTP.
	{"customer_otp", "idx_customer_otp_phone", "uq_customer_otp_tenant_phone", "phone", ""},

	// Each business captures its own row per calendar day. The index this
	// replaces was unique on date ALONE, which would let whichever business
	// captured a day first block every other business from capturing it.
	{"dashboard_snapshots", "idx_dashboard_snapshots_date", "uq_dashboard_snapshots_tenant_date", "date", ""},
}

// createTenantCompositeUniques rewrites each audited constraint to include
// the tenant.
//
// Must run AFTER backfillTenancy: the new indexes lead with tenant_id, which
// has to be populated and NOT NULL first.
//
// Idempotent in both directions, which matters because this runs on every
// boot. The old index is dropped only while it is still UNIQUE — once the
// struct tags were relaxed to a plain `index`, AutoMigrate recreates a
// non-unique index under the same name on the next boot, and dropping that
// every time would be pointless index churn on a live database.
func createTenantCompositeUniques(db *gorm.DB) error {
	for _, ix := range tenantUniqueIndexes {
		var isUnique bool
		err := db.Raw(`
			SELECT ix.indisunique FROM pg_index ix
			JOIN pg_class i ON i.oid = ix.indexrelid
			WHERE i.relname = ?`, ix.OldIndex).Scan(&isUnique).Error
		if err != nil {
			return fmt.Errorf("inspecting index %s: %w", ix.OldIndex, err)
		}
		if isUnique {
			if err := db.Exec(fmt.Sprintf(`DROP INDEX IF EXISTS %s`, ix.OldIndex)).Error; err != nil {
				return fmt.Errorf("dropping global unique index %s: %w", ix.OldIndex, err)
			}
			log.Printf("tenancy: dropped global unique index %s — %s.%s is now unique per tenant",
				ix.OldIndex, ix.Table, ix.Columns)
		}

		// CREATE ... IF NOT EXISTS never alters an existing index, so one
		// built before its predicate was added (or changed) is rebuilt here —
		// otherwise the new WHERE never reaches a database that already has
		// the index.
		var existingPred *string
		var exists bool
		if err := db.Raw(`SELECT EXISTS (SELECT 1 FROM pg_class WHERE relname = ?)`, ix.NewIndex).Scan(&exists).Error; err != nil {
			return fmt.Errorf("inspecting index %s: %w", ix.NewIndex, err)
		}
		if exists {
			if err := db.Raw(`
				SELECT pg_get_expr(ix.indpred, ix.indrelid) FROM pg_index ix
				JOIN pg_class i ON i.oid = ix.indexrelid
				WHERE i.relname = ?`, ix.NewIndex).Scan(&existingPred).Error; err != nil {
				return fmt.Errorf("inspecting predicate of %s: %w", ix.NewIndex, err)
			}
			if (existingPred == nil) != (ix.Predicate == "") {
				if err := db.Exec(fmt.Sprintf(`DROP INDEX IF EXISTS %s`, ix.NewIndex)).Error; err != nil {
					return fmt.Errorf("dropping %s to change its predicate: %w", ix.NewIndex, err)
				}
				log.Printf("tenancy: rebuilding %s with predicate %q", ix.NewIndex, ix.Predicate)
			}
		}

		stmt := fmt.Sprintf(`CREATE UNIQUE INDEX IF NOT EXISTS %s ON %s (tenant_id, %s)`,
			ix.NewIndex, ix.Table, ix.Columns)
		if ix.Predicate != "" {
			stmt += " WHERE " + ix.Predicate
		}
		if err := db.Exec(stmt).Error; err != nil {
			return fmt.Errorf("creating %s: %w", ix.NewIndex, err)
		}
	}
	return nil
}

// createCustomerPhoneUnique makes a customer's phone unique within its
// business — phone is the customer's mobile login and OTP identifier (see
// internal/customerauth), and customer.Repository.FindByPhone silently picks
// one row when two share a number.
//
// Kept out of tenantUniqueIndexes because, unlike those, this constraint is
// new to data that never enforced it, and two family members sharing one
// number is a realistic pair of rows. A duplicate must not stop the server
// booting: the index is skipped and the offending customers are logged, the
// service-level check (customer.Service.checkPhoneUnique) still blocks NEW
// duplicates, and the index lands on the first boot after cleanup.
//
// Soft-deleted customers are exempt so a deleted record never holds a number
// hostage — FindByPhone ignores them too.
func createCustomerPhoneUnique(db *gorm.DB) error {
	const name = "uq_customers_tenant_phone"
	var exists bool
	if err := db.Raw(`SELECT EXISTS (SELECT 1 FROM pg_class WHERE relname = ?)`, name).Scan(&exists).Error; err != nil {
		return fmt.Errorf("inspecting index %s: %w", name, err)
	}
	if exists {
		return nil
	}

	var dups []struct {
		TenantID uint
		Phone    string
		Codes    string
	}
	err := db.Raw(`
		SELECT tenant_id, phone, string_agg(code, ', ' ORDER BY id) AS codes
		FROM customers
		WHERE phone <> '' AND deleted_at IS NULL
		GROUP BY tenant_id, phone
		HAVING count(*) > 1`).Scan(&dups).Error
	if err != nil {
		return fmt.Errorf("checking duplicate customer phones: %w", err)
	}
	if len(dups) > 0 {
		log.Printf("WARNING: %s not created — %d phone number(s) are shared by more than one customer. "+
			"New duplicates are still rejected; give each customer a distinct number and restart to enforce it in the database:", name, len(dups))
		for _, d := range dups {
			log.Printf("  tenant %d, phone %s: %s", d.TenantID, d.Phone, d.Codes)
		}
		return nil
	}

	// Under FORCE ROW LEVEL SECURITY with a non-superuser migration role the
	// duplicate check above sees no rows, while the index build sees them all
	// — so a failure here is reported, not fatal, for the same reason.
	if err := db.Exec(`CREATE UNIQUE INDEX IF NOT EXISTS ` + name + `
		ON customers (tenant_id, phone) WHERE phone <> '' AND deleted_at IS NULL`).Error; err != nil {
		log.Printf("WARNING: %s not created: %v", name, err)
		return nil
	}
	log.Printf("tenancy: created %s — customer phone is now unique per tenant", name)
	return nil
}

// createCustomerKYCUnique makes PAN and Aadhaar unique per business, mirroring
// createCustomerPhoneUnique: blank values are exempt (both are optional),
// soft-deleted customers are exempt, and pre-existing duplicates skip the
// index with a logged warning instead of stopping boot — the service-level
// checks still reject new duplicates. Aadhaar is compared by aadhaar_hash,
// which only customers saved after this change carry.
func createCustomerKYCUnique(db *gorm.DB) error {
	for _, ix := range []struct{ name, col string }{
		{"uq_customers_tenant_pan", "pan"},
		{"uq_customers_tenant_aadhaar", "aadhaar_hash"},
	} {
		var exists bool
		if err := db.Raw(`SELECT EXISTS (SELECT 1 FROM pg_class WHERE relname = ?)`, ix.name).Scan(&exists).Error; err != nil {
			return fmt.Errorf("inspecting index %s: %w", ix.name, err)
		}
		if exists {
			continue
		}
		var dups []struct {
			TenantID uint
			Val      string
			Codes    string
		}
		err := db.Raw(`
			SELECT tenant_id, ` + ix.col + ` AS val, string_agg(code, ', ' ORDER BY id) AS codes
			FROM customers
			WHERE ` + ix.col + ` IS NOT NULL AND ` + ix.col + ` <> '' AND deleted_at IS NULL
			GROUP BY tenant_id, ` + ix.col + `
			HAVING count(*) > 1`).Scan(&dups).Error
		if err != nil {
			return fmt.Errorf("checking duplicate customer %s: %w", ix.col, err)
		}
		if len(dups) > 0 {
			log.Printf("WARNING: %s not created — %d %s value(s) are shared by more than one customer. "+
				"New duplicates are still rejected; fix these and restart to enforce it in the database:", ix.name, len(dups), ix.col)
			for _, d := range dups {
				if ix.col == "pan" {
					log.Printf("  tenant %d, PAN %s: %s", d.TenantID, d.Val, d.Codes)
				} else {
					log.Printf("  tenant %d: %s", d.TenantID, d.Codes)
				}
			}
			continue
		}
		if err := db.Exec(`CREATE UNIQUE INDEX IF NOT EXISTS ` + ix.name + `
			ON customers (tenant_id, ` + ix.col + `) WHERE ` + ix.col + ` IS NOT NULL AND ` + ix.col + ` <> '' AND deleted_at IS NULL`).Error; err != nil {
			log.Printf("WARNING: %s not created: %v", ix.name, err)
			continue
		}
		log.Printf("tenancy: created %s — customer %s is now unique per tenant", ix.name, ix.col)
	}
	return nil
}

// uploadRefColumns lists every column holding a "/uploads/<key>" path.
//
// Files predate the uploaded_files table, so their ownership has to be
// recovered from whatever row points at them — that row's tenant is the
// file's tenant. Miss a column here and those files become unreachable
// (no record, so the serve handler 404s them), which is the safe direction
// to fail, but it means this list is worth keeping complete.
var uploadRefColumns = []struct{ Table, Column string }{
	{"customers", "photo_url"},
	{"customers", "kyc_document_url"},
	{"ornament_images", "image_url"},
	{"loan_draft_ornaments", "image_url"},
	{"expenses", "receipt_image"},
	{"loans", "indemnity_bond_signed_url"},
}

// backfillUploadedFiles creates an uploaded_files record for every file
// already referenced by existing data, attributing each to the business that
// owns the referencing row.
//
// Idempotent: records already present are skipped, so re-running adds
// nothing. Files on disk that nothing references are deliberately NOT
// adopted — an unreferenced file has no owner to infer, and guessing one
// would be inventing an authorization answer. Those become unreachable,
// which for orphaned data is the correct outcome.
//
// Content type is left blank for backfilled rows rather than guessed from
// the extension: the serve handler sends what is recorded, and asserting a
// type nobody verified is how a mislabelled file gets served as something
// the browser will execute. A blank type is served as a download instead.
func backfillUploadedFiles(db *gorm.DB) error {
	var inserted int64
	for _, ref := range uploadRefColumns {
		res := db.Exec(fmt.Sprintf(`
			INSERT INTO uploaded_files (tenant_id, storage_key, original_name, content_type, size_bytes, created_at)
			SELECT DISTINCT t.tenant_id,
			       regexp_replace(t.%s, '^/uploads/', ''),
			       regexp_replace(t.%s, '^/uploads/', ''),
			       '', 0, now()
			FROM %s t
			WHERE t.%s LIKE '/uploads/%%'
			  AND NOT EXISTS (
			      SELECT 1 FROM uploaded_files f
			      WHERE f.storage_key = regexp_replace(t.%s, '^/uploads/', '')
			  )`, ref.Column, ref.Column, ref.Table, ref.Column, ref.Column))
		if res.Error != nil {
			return fmt.Errorf("backfilling uploaded_files from %s.%s: %w", ref.Table, ref.Column, res.Error)
		}
		inserted += res.RowsAffected
	}
	if inserted > 0 {
		log.Printf("uploads: recorded %d pre-existing file(s) — /uploads now requires a session and matching business", inserted)
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
	ctx := platform.AllowCrossTenant(context.Background())
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
			b, err := branchRepo.FirstOrCreateByName(ctx, name)
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

// backfillTenantGrantColumns normalises the two grant columns from NULL to
// the empty string.
//
// AutoMigrate adds enabled_modules/document_languages as NULLABLE, so every
// business created before them holds NULL rather than "". Both mean the same
// thing to tenant.Tenant's helpers (no optional modules; English only), but
// NULL and "" are not the same thing to the DRIVER: plucking a NULL into a Go
// string fails outright, which is how a NULL enabled_modules turned into a
// 403 on every module-gated route for every existing business.
//
// tenant.Repository.HasModule now COALESCEs defensively, but the data itself
// should not carry a distinction that has no meaning — otherwise every future
// query against these columns has to remember the same trick.
//
// Idempotent: a second run updates nothing.
func backfillTenantGrantColumns(db *gorm.DB) error {
	for _, col := range []string{"enabled_modules", "document_languages"} {
		res := db.Exec(
			fmt.Sprintf("UPDATE tenants SET %s = '' WHERE %s IS NULL", col, col))
		if res.Error != nil {
			return fmt.Errorf("backfilling tenants.%s: %w", col, res.Error)
		}
		if res.RowsAffected > 0 {
			log.Printf("backfilled tenants.%s: %d row(s) NULL -> ''", col, res.RowsAffected)
		}
	}
	return nil
}

// allModels is every model AutoMigrate creates, extracted from the call so
// it can be inspected as data.
//
// TestEveryTenantScopedModelIsRegistered reflects over this list to assert
// that every model embedding platform.TenantScoped is present in
// platform.TenantScopedTableNames. That guard is the reason this is a
// variable and not an inline argument list: the set of tenant-owned tables
// is the isolation boundary, and it must not be possible to add a model that
// carries a tenant_id without the migration and the runtime filter both
// knowing about it. Five tables had already slipped through when the two
// lists were maintained by hand.
var allModels = []any{
	// Tenancy first: tiers before tenants (tenants reference a tier),
	// and both before every tenant-owned table below.
	&tenant.Tier{},
	&tenant.Tenant{},
	&platform.Sequence{},
	// Per-business daily usage counters (Step 13) — allocation
	// bookkeeping like Sequence above, not business data, so it is
	// exempt from the automatic tenant filter the same way.
	&platform.UsageCounter{},
	&branch.Branch{},
	&scheme.Scheme{},
	&goldrate.GoldRate{},
	&employee.Employee{},
	&cash.CashMovement{},
	&cash.Expense{},
	&cash.OpeningCashBalance{},
	&cash.GoldSale{},
	&cash.CashSource{},
	&cash.ExpenseCategory{},
	&cash.LoanCashSource{},
	&settings.ApiKeySetting{},
	&customer.Customer{},
	&loan.Loan{},
	&loan.Ornament{},
	&loan.OrnamentPurityTest{},
	&loan.OrnamentImage{},
	&loan.LoanApproval{},
	&loan.LoanPayment{},
	&loan.LoanTopUp{},
	&loan.LoanAccrual{},
	&loan.BankPledgeRecord{},
	&loan.BankPledgeEvent{},
	&loan.AuctionRecord{},
	&loan.AuctionNotice{},
	&loan.AuctionEvent{},
	&loan.AuctionDecisionRequest{},
	&loan.LoanRequest{},
	&loan.LoanRequestOrnament{},
	&loan.RequestApproval{},
	&loan.ApprovalLimit{},
	&workflow.ApprovalStageSetting{},
	&workflow.ApprovalAction{},
	&workflow.ApprovalChain{},
	&workflow.ApprovalCategoryMode{},
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
	&personalloan.PersonalLoanHistory{},
	&investment.InvestmentPlan{},
	&investment.Investment{},
	&investment.InvestmentPayout{},
	&investment.InvestmentTransaction{},
	&authz.Role{},
	&authz.Permission{},
	&authz.RolePermission{},
	&commlog.CommunicationLog{},
	&customerauth.OTP{},
	&customerauth.DeviceToken{},
	// Realtime notifications (WebSocket, ack-and-resend) — the durable
	// in-app inbox behind the customer app's bell.
	&notification.Notification{},
	// Nightly KPI-count snapshots powering the mobile dashboard's trend
	// indicators (see dashboard.Snapshot's doc comment).
	&dashboard.Snapshot{},
	// The authorization record behind every uploaded file. Before it,
	// /uploads was served with no login check at all.
	&upload.File{},
	// The superadmin console's own tables (Step 7) — deliberately NOT
	// tenant-scoped (no TenantScoped embed): a superadmin user belongs to
	// no business, and the audit log's TenantID column points AT a
	// business without being scoped BY one, so a superadmin can list every
	// entry across every tenant.
	&superadmin.SuperAdminUser{},
	&superadmin.AuditLog{},
	// Hand-recorded plan payments shown on the superadmin business detail
	// page. Vendor-side, not tenant-scoped — see its doc comment.
	&superadmin.SubscriptionPayment{},
	// This business's own audit log (Step 11) — tenant-scoped, unlike
	// superadmin.AuditLog above.
	&auditlog.Entry{},
	// Nightly KPI-count snapshots powering the mobile dashboard's trend
	// indicators (see dashboard.Snapshot's doc comment).
	&dashboard.Snapshot{},
}

// purgeGlobalDashboardSnapshots deletes the dashboard_snapshots rows written
// before that table was tenant-scoped.
//
// Those rows are not one business's counts that merely lack a label — they
// are every business's counts ADDED TOGETHER, captured by a job that ran
// under platform.AllowCrossTenant against a table with no tenant_id and a
// globally unique date. There is no tenant they can be attributed to, and
// backfillTenancy's ordinary "point orphans at the default business" rule
// would be actively wrong here: it would hand one business a set of trend
// figures computed from everyone's loan books.
//
// Deleting is safe because the data is derived and regenerates: the capture
// job writes the current day's row on its next tick, and the only thing lost
// is trend history that was never correct for anyone.
//
// Scoped to pre-tenancy rows only (tenant_id IS NULL OR 0), so it is
// idempotent and never touches a row captured after the fix.
func purgeGlobalDashboardSnapshots(db *gorm.DB) error {
	var exists bool
	if err := db.Raw(`SELECT EXISTS (
		SELECT 1 FROM information_schema.columns
		WHERE table_name = 'dashboard_snapshots' AND column_name = 'tenant_id')`).Scan(&exists).Error; err != nil {
		return fmt.Errorf("checking dashboard_snapshots.tenant_id: %w", err)
	}
	if !exists {
		return nil // fresh install: AutoMigrate has not created the table yet
	}
	res := db.Exec(`DELETE FROM dashboard_snapshots WHERE tenant_id IS NULL OR tenant_id = 0`)
	if res.Error != nil {
		return fmt.Errorf("purging pre-tenancy dashboard snapshots: %w", res.Error)
	}
	if res.RowsAffected > 0 {
		log.Printf("tenancy: deleted %d pre-tenancy dashboard snapshot(s) — they held every business's counts summed together", res.RowsAffected)
	}
	return nil
}

// tenantFromParent lists tenant-owned tables whose tenant_id cannot be
// trusted on its own and is instead derived from the parent row a real
// foreign key ties it to. Parents come before their children, so a child
// always copies an already-corrected value.
//
// Why: these tables embed platform.TenantScoped but were missing from
// platform's tenantScopedTables, so the create callback never stamped them
// and their rows sit at tenant_id = 0. backfillTenancy's ordinary rule —
// "a row with no tenant belongs to the default business" — would then hand
// every OTHER business's top-ups, history and ledger rows to the default
// business. Ownership is decided by the parent, not by the default.
var tenantFromParent = []struct{ table, fk, parent string }{
	{"investments", "customer_id", "customers"},
	{"investment_plans", "id", ""}, // special-cased below: owned via investments.plan_id
	{"investment_payouts", "investment_id", "investments"},
	{"investment_transactions", "investment_id", "investments"},
	{"loan_top_ups", "loan_id", "loans"},
	{"loan_accruals", "loan_id", "loans"},
	{"loan_request_ornaments", "request_id", "loan_requests"},
	{"personal_loan_history", "personal_loan_id", "personal_loans"},
}

// backfillTenantFromParent repoints each tenantFromParent row at the business
// that owns its parent. Must run BEFORE backfillTenancy so only genuine
// orphans (no parent at all) are left for the default-business rule.
//
// Idempotent: IS DISTINCT FROM matches nothing once every row agrees with its
// parent, so on a healthy database this is a handful of no-op UPDATEs.
func backfillTenantFromParent(db *gorm.DB) error {
	for _, r := range tenantFromParent {
		var q string
		if r.table == "investment_plans" {
			// A plan has no single parent column; it belongs to the business
			// whose investments use it. Only fills plans still lacking a
			// tenant, so a plan shared by mistake is never flipped back and
			// forth between two businesses.
			q = `UPDATE investment_plans p SET tenant_id = i.tenant_id
				FROM investments i
				WHERE i.plan_id = p.id AND i.tenant_id <> 0
				  AND (p.tenant_id IS NULL OR p.tenant_id = 0)`
		} else {
			q = fmt.Sprintf(`UPDATE %[1]s c SET tenant_id = p.tenant_id
				FROM %[3]s p
				WHERE c.%[2]s = p.id AND p.tenant_id IS NOT NULL AND p.tenant_id <> 0
				  AND c.tenant_id IS DISTINCT FROM p.tenant_id`, r.table, r.fk, r.parent)
		}
		res := db.Exec(q)
		if res.Error != nil {
			return fmt.Errorf("deriving tenant_id on %s from its parent: %w", r.table, res.Error)
		}
		if res.RowsAffected > 0 {
			log.Printf("tenancy: corrected tenant_id on %d row(s) in %s from their parent", res.RowsAffected, r.table)
		}
	}
	return nil
}
