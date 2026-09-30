package superadmin

import (
	"context"
	"fmt"
	"os"
	"path/filepath"

	"gorm.io/gorm"

	"cloudhouse/backend/internal/platform"
	"cloudhouse/backend/internal/upload"
)

// hardDeleteOrder is every tenant-owned table the hard delete empties,
// children before parents. It starts from demoseed's wipeOrder
// (backend/script/demoseed/wipe.go) — see that file's doc comment for why the
// list is hand-written rather than driven off platform.tenantScopedTables —
// and then adds the tables a demo *reset* deliberately preserves (an
// operator's login, roles, branches, uploads) because a hard delete has
// nothing left to preserve: the whole business is going away.
var hardDeleteOrder = []string{
	// Grandchildren.
	"loan_request_ornaments",
	"loan_top_ups",
	"personal_loan_history",
	"investment_transactions",
	"ornament_purity_tests",
	"ornament_images",
	"packet_movements",
	"auction_events",
	"auction_notices",
	"auction_decision_requests",
	"request_approvals",
	"bank_pledge_events",
	"personal_loan_payments",
	"personal_loan_installments",
	"investment_payouts",
	"loan_draft_ornaments",
	"loan_approvals",
	"loan_payments",

	// Children of loans and customers. bank_pledge_records before expenses:
	// it carries expense_id / release_expense_id.
	"auction_records",
	"loan_requests",
	"bank_pledge_records",
	"packets",
	"ornaments",
	"reminders",
	"notifications",
	"investments",
	"personal_loans",
	"loan_drafts",

	"loans",

	// Parents and flat tables. gold_sales carries FKs to both branches and
	// cash_movements, so it has to go before either of them. cash_movements
	// carries an optional FK to customers (party_customer_id, recording which
	// customer a cash entry was paid to/by) and must therefore go before
	// customers too — unlike demoseed's wipe, which never hits this because
	// demo seed data leaves party_customer_id unset.
	"gold_sales",
	"cash_movements",
	"customer_otp",
	"customer_device_tokens",
	"customers",
	"investment_plans",
	"schemes",
	"lockers",
	"banks",
	"ornament_types",
	"gold_rates",
	"expenses",
	"opening_cash_balances",
	"approval_limits",
	"communication_logs",
	"audit_log_entries",
	"purity_standards",

	// Uploaded files, then the employees/roles/branches that a demo reset
	// keeps for the operator's login but a hard delete has no reason to.
	// uploaded_files first: nothing left in this list references it by FK
	// once ornament_images etc. above are already gone.
	"uploaded_files",
	"employees",
	"role_permissions",
	"roles",
	"branches",
	"sequences",
	"usage_counters",
}

// hardDeleteUntenanted mirrors demoseed's untenantedTables: tenant-scoped
// models whose GORM tenant callbacks never fired, so rows may sit at
// tenant_id = 0 rather than the owning business.
var hardDeleteUntenanted = map[string]bool{
	"investments":        true,
	"investment_plans":   true,
	"investment_payouts": true,
}

// hardDeleteChildOf mirrors demoseed's childOf: tables whose own tenant_id is
// not trusted, deleted instead by walking up to the parent a real foreign key
// anchors them to. See wipe.go's doc comment for the failure this fixes.
var hardDeleteChildOf = map[string]struct{ fk, parent string }{
	"loan_request_ornaments":     {"request_id", "loan_requests"},
	"loan_top_ups":               {"loan_id", "loans"},
	"personal_loan_history":      {"personal_loan_id", "personal_loans"},
	"investment_transactions":    {"investment_id", "investments"},
	"ornament_purity_tests":      {"ornament_id", "ornaments"},
	"ornament_images":            {"ornament_id", "ornaments"},
	"packet_movements":           {"packet_id", "packets"},
	"auction_events":             {"auction_record_id", "auction_records"},
	"auction_notices":            {"auction_record_id", "auction_records"},
	"auction_decision_requests":  {"auction_record_id", "auction_records"},
	"bank_pledge_events":         {"bank_pledge_record_id", "bank_pledge_records"},
	"personal_loan_payments":     {"personal_loan_id", "personal_loans"},
	"personal_loan_installments": {"personal_loan_id", "personal_loans"},
	"investment_payouts":         {"investment_id", "investments"},
	"loan_draft_ornaments":       {"draft_id", "loan_drafts"},
	"loan_approvals":             {"loan_id", "loans"},
	"loan_payments":              {"loan_id", "loans"},
	"loan_requests":              {"loan_id", "loans"},
	"bank_pledge_records":        {"loan_id", "loans"},
	"packets":                    {"loan_id", "loans"},
	"ornaments":                  {"loan_id", "loans"},
	"reminders":                  {"customer_id", "customers"},
	"personal_loans":             {"customer_id", "customers"},
	"loan_drafts":                {"customer_id", "customers"},
	"investments":                {"customer_id", "customers"},
	"loans":                      {"customer_id", "customers"},
	// cash_movements.tenant_id has the same kind of mis-stamping risk the
	// untenanted models above have (see hardDeleteUntenanted's doc comment) —
	// resolving party_customer_id up to its customer catches a cash entry
	// whose own tenant_id is wrong, the same way childOf does everywhere else.
	"cash_movements": {"party_customer_id", "customers"},
}

// hardDeletePredicate is the WHERE clause selecting one business's rows in a
// table — see demoseed's tenantPredicate, which this copies.
func hardDeletePredicate(table string, tenantID uint) string {
	clause := fmt.Sprintf("%s.tenant_id = %d", table, tenantID)
	if hardDeleteUntenanted[table] {
		clause = fmt.Sprintf("(%s OR %s.tenant_id = 0 OR %s.tenant_id IS NULL)",
			clause, table, table)
	}
	c, ok := hardDeleteChildOf[table]
	if !ok {
		return clause
	}
	return fmt.Sprintf("(%s OR %s.%s IN (SELECT %s.id FROM %s WHERE %s))",
		clause, table, c.fk, c.parent, c.parent, hardDeletePredicate(c.parent, tenantID))
}

// hardDeleteFromTable empties one table for one business with a raw DELETE —
// never GORM's .Delete(), which would only set deleted_at on the
// soft-deletable models here.
func hardDeleteFromTable(tx *gorm.DB, table string, tenantID uint) error {
	return tx.Exec("DELETE FROM " + table + " WHERE " + hardDeletePredicate(table, tenantID)).Error
}

// HardDeleteBusiness permanently removes a business: every row it owns across
// every tenant-scoped table, its uploaded files (including the logo) from
// disk, and finally the tenants row itself. There is no undo — this is the
// "instead of suspend, actually delete it" lever the business list offers,
// and it is gated on the same mandatory-reason audit trail as every other
// superadmin action.
func (s *Service) HardDeleteBusiness(ctx context.Context, actor *SuperAdminUser, id uint, reason string) error {
	if err := validateReason(reason); err != nil {
		return err
	}

	crossCtx := platform.AllowCrossTenant(ctx)
	t, err := s.tenantRepo.FindByID(crossCtx, id)
	if err != nil {
		return ErrBusinessNotFound
	}
	name, code := t.Name, t.Code

	// One transaction for every delete. A half-deleted business — some
	// customers gone, their loans still sitting there pointing nowhere — is
	// worse than either a fully deleted one or an untouched one.
	err = s.db.WithContext(crossCtx).Transaction(func(tx *gorm.DB) error {
		for _, table := range hardDeleteOrder {
			if err := hardDeleteFromTable(tx, table, id); err != nil {
				return fmt.Errorf("delete %s: %w", table, err)
			}
		}
		// Unscoped: tenants has a deleted_at column, and a plain Delete would
		// only soft-delete it, leaving the row (and its unique code) behind.
		return tx.Unscoped().Exec("DELETE FROM tenants WHERE id = ?", id).Error
	})
	if err != nil {
		return fmt.Errorf("hard delete business %d: %w", id, err)
	}

	// Files are removed AFTER the transaction commits: a rolled-back delete
	// whose files were already gone is unrecoverable, while files left behind
	// after a committed delete are merely disk space to reclaim later.
	removeBusinessUploads(s.uploadsDir, id)

	s.audit(ctx, actor, ActionDeleteBusiness, nil, name,
		fmt.Sprintf("business %q (code %s) permanently deleted — all data and files removed", name, code), reason)
	return nil
}

// removeBusinessUploads deletes a business's entire upload directory
// (branding logo included) from disk. Failures are logged, not returned: the
// database delete already committed, so the business is gone from every list
// and login either way — a stray directory left on disk is untidy, not a
// correctness problem, and the operator should not see "delete failed" for
// something that actually succeeded.
func removeBusinessUploads(uploadsDir string, tenantID uint) {
	if uploadsDir == "" {
		return
	}
	dir := upload.TenantDir(uploadsDir, tenantID)
	abs, err := filepath.Abs(dir)
	if err != nil {
		fmt.Printf("superadmin: hard delete business %d: resolve uploads dir: %v\n", tenantID, err)
		return
	}
	// Refuse to sweep a root or empty path — an id of 0 must never turn into
	// os.RemoveAll(uploadsRoot).
	root, err := filepath.Abs(uploadsDir)
	if err != nil || abs == root || abs == filepath.VolumeName(abs)+string(filepath.Separator) {
		fmt.Printf("superadmin: hard delete business %d: refusing to sweep uploads dir %q\n", tenantID, abs)
		return
	}
	if err := os.RemoveAll(abs); err != nil {
		fmt.Printf("superadmin: hard delete business %d: remove uploads dir %q: %v\n", tenantID, abs, err)
	}
}
