package demoseed

import (
	"context"
	"fmt"
	"os"
	"path/filepath"
	"strings"

	"cloudhouse/backend/internal/employee"
	"cloudhouse/backend/internal/platform"

	"gorm.io/gorm"
)

// preserved identifies the rows the wipe must leave alone so the operator can
// still sign in afterwards.
type preserved struct {
	adminID       uint
	adminBranchID uint
	uploadKeys    []string
	// logoKey is the business's branding logo, kept out of the wipe entirely.
	// tenants.logo_storage_key survives (the tenants table is not wiped), so
	// deleting the uploaded_files row it points at leaves
	// branding.Service.Public unable to resolve the file — the console and
	// the login page then render the platform mark instead of the business's
	// own logo, which reads as the reset having broken branding. Empty when
	// the business has no logo of its own.
	logoKey string
}

// wipeOrder is every table the wipe empties, children before parents.
//
// # WHY THIS LIST IS WRITTEN OUT BY HAND
//
// Two authoritative table lists already exist — platform.tenantScopedTables
// and migrate.tenantScopedTables — and neither can be reused here. They
// disagree with each other (only the platform one knows about
// audit_log_entries) and NEITHER contains investments, investment_plans or
// investment_payouts, which are tenant-scoped models missing from both. A
// wipe driven off either list would silently leave rows behind. So the order
// is explicit, and adding a table to the schema means adding it here too.
//
// FK constraints are real (GORM created them from the foreignKey tags), so
// order is not cosmetic: deleting loans before ornaments fails.
var wipeOrder = []string{
	// Grandchildren.
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
	// customer a cash entry was paid to/by) and to banks (bank_id), so it must
	// go before customers and before banks too — see childOf below, and
	// internal/superadmin/harddelete.go's identical fix for the same table.
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
	// approval_stage_settings is NOT wiped: which approval stages a business
	// uses is configuration, kept across a reset like its roles and grants.
	"approval_actions",
	"communication_logs",
	"audit_log_entries",
	// uploaded_files is NOT here: it is emptied in wipeIdentityTables, which
	// is the only place that knows which row is the branding logo and has to
	// be kept.
	//
	// purity_standards is deleted and re-seeded by seed_masters.go. Re-seeded rather than kept
	// because puritystandard.SeedStandards runs cross-tenant and would either
	// skip on another business's row or create ours at tenant_id 0.
	"purity_standards",
	// role_permissions is NOT wiped, and neither are roles. A business's
	// roles and the permissions granted to them are CONFIGURATION — set up
	// once for the business, the same class of thing as its logo, colours and
	// fonts — not demo data. Wiping them logged the operator into a console
	// with every page gone, which is not what "clear the demo data" means to
	// anyone who asks for it. seed_grants.go only fills in grants for a
	// business that has none.
}

// untenantedTables are tenant-scoped models that the GORM tenant callbacks do
// not actually cover, so their rows were written with tenant_id = 0 and a
// plain `WHERE tenant_id = ?` would miss them.
//
// This is a pre-existing bug, not something this package introduced:
// investment.Investment, InvestmentPlan and InvestmentPayout all embed
// platform.TenantScoped and are AutoMigrated, but appear in neither
// platform.tenantScopedTables nor migrate.tenantScopedTables. The stamp
// callback therefore never fires on them and the scope callback never filters
// them. Fixing the root cause needs a backfill, a NOT NULL step and its own
// schema-version bump; until then the wipe has to sweep both values.
var untenantedTables = map[string]bool{
	"investments":        true,
	"investment_plans":   true,
	"investment_payouts": true,
	// role_permissions is deliberately NOT listed here. tenant_id is the
	// wrong key for that table altogether, and it is no longer wiped at all —
	// see wipeOrder.
}

// childOf maps a table to the foreign key and parent table that ANCHOR it to
// a business, for every child row that a foreign key protects.
//
// # WHY A ROW'S OWN tenant_id IS NOT TRUSTED HERE
//
// A child row's tenant_id can be wrong, and in this database some of them
// are. Anything written outside a request — a boot-time backfill on a plain
// *gorm.DB, or a slice Create where GORM's stamp callback does not fire —
// lands at tenant_id = 0, and the next boot's migrate.backfillTenancy sweeps
// every zero to the DEFAULT tenant rather than the owning one. The row is
// then filed under a business that has nothing to do with it.
//
// `DELETE FROM packet_movements WHERE tenant_id = 2` therefore misses two
// movements belonging to tenant 2's own packets, and the packets delete that
// follows dies on fk_packets_movements (23503) — which is exactly the failure
// this map fixes. Deleting by parent instead makes the wipe depend on the
// relationship, which is enforced by a real foreign key, rather than on a
// column that is only as correct as whatever last wrote it.
//
// The list mirrors the schema's actual foreign keys; a new FK into a
// tenant-scoped parent belongs here as well as in wipeOrder.
var childOf = map[string]struct{ fk, parent string }{
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
	// untenanted models above have — resolving party_customer_id up to its
	// customer catches a cash entry whose own tenant_id is wrong, the same way
	// childOf does everywhere else. Mirrors
	// internal/superadmin/harddelete.go's hardDeleteChildOf entry.
	"cash_movements": {"party_customer_id", "customers"},
}

// tenantPredicate is the WHERE clause that selects one business's rows in a
// table: the row's own tenant_id, OR — for a child — its parent's, resolved
// recursively up the chain so a mis-stamped row at any level is still caught.
//
// tenantID is interpolated rather than bound because the clause nests to an
// arbitrary depth and counting placeholders across that recursion is a bug
// waiting to happen. It is a uint from the session, never a string from a
// request, so there is nothing here to inject.
func tenantPredicate(table string, tenantID uint) string {
	clause := fmt.Sprintf("%s.tenant_id = %d", table, tenantID)
	if untenantedTables[table] {
		clause = fmt.Sprintf("(%s OR %s.tenant_id = 0 OR %s.tenant_id IS NULL)",
			clause, table, table)
	}
	c, ok := childOf[table]
	if !ok {
		return clause
	}
	return fmt.Sprintf("(%s OR %s.%s IN (SELECT %s.id FROM %s WHERE %s))",
		clause, table, c.fk, c.parent, c.parent, tenantPredicate(c.parent, tenantID))
}

// wipe empties the business and returns what it preserved.
func wipe(ctx context.Context, d *Deps, tenantID uint, rep *Report) (*preserved, error) {
	// Pre-flight reads run outside the transaction and cross-tenant, because
	// they must succeed before anything is destroyed.
	crossCtx := platform.AllowCrossTenant(ctx)

	keep, err := findPreserved(crossCtx, d.db, tenantID)
	if err != nil {
		return nil, err
	}

	// One transaction for every delete. A half-wiped business is worse than
	// either a wiped one or an untouched one: the operator would be looking at
	// a demo with loans whose customers no longer exist.
	err = d.db.WithContext(crossCtx).Transaction(func(tx *gorm.DB) error {
		for _, table := range wipeOrder {
			n, err := deleteFrom(tx, table, tenantID)
			if err != nil {
				return fmt.Errorf("wipe %s: %w", table, err)
			}
			if n > 0 {
				rep.Deleted[table] = n
			}
		}
		return wipeIdentityTables(tx, tenantID, keep, rep)
	})
	if err != nil {
		return nil, err
	}

	return keep, nil
}

// findPreserved locates the admin login and lists this business's upload keys.
//
// The admin is found and then excluded by id, rather than deleted and
// re-created by employee.SeedAdmin. A re-created admin gets a NEW row id,
// and platform.AuthMiddleware re-reads the employee by id on every request —
// so every outstanding token, including the one belonging to the operator
// running the reset, would be dead in a way that looks like a bug rather than
// a sign-out. Excluding by id keeps the row byte-identical.
func findPreserved(ctx context.Context, db *gorm.DB, tenantID uint) (*preserved, error) {
	var row struct {
		ID       uint
		BranchID uint
	}
	err := db.WithContext(ctx).
		Table("employees").
		Select("id, branch_id").
		Where("tenant_id = ? AND (username = ? OR email = ?)",
			tenantID, employee.AdminUsername, employee.AdminEmail).
		Order("id").
		Limit(1).
		Scan(&row).Error
	if err != nil {
		return nil, fmt.Errorf("locate admin login: %w", err)
	}
	if row.ID == 0 {
		// Refusing is the whole point. Wiping a business whose admin cannot
		// be found would leave a demo nobody can log into, and the fix at
		// that point is a database restore.
		return nil, fmt.Errorf(
			"refusing to reset: no %q login found for business %d — run `go run ./cmd/seedadmin` first",
			employee.AdminUsername, tenantID)
	}

	// The branding logo is read first so it can be excluded from everything
	// below. A missing tenants row is not fatal here — the wipe would simply
	// have no logo to protect.
	// Plucked into a slice, not a string: GORM's Pluck requires one, and an
	// empty result then means "no tenants row" rather than an error.
	var logoKeys []string
	if err := db.WithContext(ctx).
		Table("tenants").
		Where("id = ?", tenantID).
		Limit(1).
		Pluck("logo_storage_key", &logoKeys).Error; err != nil {
		return nil, fmt.Errorf("read branding logo key: %w", err)
	}
	var logoKey string
	if len(logoKeys) > 0 {
		logoKey = logoKeys[0]
	}

	// Read the upload keys BEFORE the rows are deleted; afterwards there is
	// no record of which files on disk belonged to this business. The logo is
	// left out so removeUploadFiles never deletes it from disk.
	var keys []string
	q := db.WithContext(ctx).Table("uploaded_files").Where("tenant_id = ?", tenantID)
	if logoKey != "" {
		q = q.Where("storage_key <> ?", logoKey)
	}
	if err := q.Pluck("storage_key", &keys).Error; err != nil {
		return nil, fmt.Errorf("list upload keys: %w", err)
	}

	return &preserved{
		adminID:       row.ID,
		adminBranchID: row.BranchID,
		uploadKeys:    keys,
		logoKey:       logoKey,
	}, nil
}

// deleteFrom empties one table for one business.
//
// Raw DELETE, never GORM's .Delete(): most models embed gorm.DeletedAt, so
// .Delete() only sets deleted_at. Two things would then break. The rows would
// still be there, and — less obviously — every entity code in this codebase
// is derived from an Unscoped() CountAll()+1, so soft-deleted rows would push
// LN-, CUST- and PKT- numbers upward on every reset, defeating "identical
// every time" and eventually colliding with the composite unique indexes.
func deleteFrom(tx *gorm.DB, table string, tenantID uint) (int64, error) {
	// The predicate covers the row's own tenant_id, the untenanted zero/NULL
	// cases, and — for a child table — its parent's business. See
	// tenantPredicate and childOf for why the parent matters.
	res := tx.Exec("DELETE FROM " + table + " WHERE " + tenantPredicate(table, tenantID))
	return res.RowsAffected, res.Error
}

// wipeIdentityTables clears the tables that carry the login, keeping the rows
// the admin depends on.
func wipeIdentityTables(tx *gorm.DB, tenantID uint, keep *preserved, rep *Report) error {
	// Uploads: everything except the branding logo. Kept here rather than in
	// wipeOrder because this is the only place that knows which row that is —
	// branding.Service resolves the logo through uploaded_files, so deleting
	// the row un-brands a business whose tenants.logo_storage_key still
	// points at a file that is very much still on disk.
	var res *gorm.DB
	if keep.logoKey != "" {
		res = tx.Exec("DELETE FROM uploaded_files WHERE tenant_id = ? AND storage_key <> ?",
			tenantID, keep.logoKey)
	} else {
		res = tx.Exec("DELETE FROM uploaded_files WHERE tenant_id = ?", tenantID)
	}
	if res.Error != nil {
		return fmt.Errorf("wipe uploaded_files: %w", res.Error)
	}
	if res.RowsAffected > 0 {
		rep.Deleted["uploaded_files"] = res.RowsAffected
	}

	// Employees: everyone except the admin.
	res = tx.Exec("DELETE FROM employees WHERE tenant_id = ? AND id <> ?", tenantID, keep.adminID)
	if res.Error != nil {
		return fmt.Errorf("wipe employees: %w", res.Error)
	}
	rep.Deleted["employees"] = res.RowsAffected

	// Roles are NOT touched — not even the custom ones a demo created. They
	// are the business's own access configuration, and an operator who spent
	// the morning setting up a "Front Desk" role should not lose it to a data
	// reset. seed_grants.go creates its fixture roles only when they are
	// missing, so re-running the seed does not duplicate them.

	// Branches: everything except the one the admin belongs to. employees
	// .branch_id is NOT NULL, so removing it would orphan the login.
	res = tx.Exec("DELETE FROM branches WHERE tenant_id = ? AND id <> ?", tenantID, keep.adminBranchID)
	if res.Error != nil {
		return fmt.Errorf("wipe branches: %w", res.Error)
	}
	rep.Deleted["branches"] = res.RowsAffected

	// Code sequences, so LN-/CUST-/PKT- restart at 1 and two resets produce
	// the same numbers. Nothing reads this table today (every code is
	// CountAll()+1) but seed_sequences.go re-seeds it for the day they switch.
	if res = tx.Exec("DELETE FROM sequences WHERE tenant_id = ?", tenantID); res.Error != nil {
		return fmt.Errorf("wipe sequences: %w", res.Error)
	}

	// Daily WhatsApp/Setu caps, so a demo that burned quota starts fresh.
	if res = tx.Exec("DELETE FROM usage_counters WHERE tenant_id = ?", tenantID); res.Error != nil {
		return fmt.Errorf("wipe usage_counters: %w", res.Error)
	}

	// dashboard_snapshots has NO tenant column at all (dashboard.Snapshot
	// embeds no TenantScoped and is uniquely indexed on date alone), so this
	// truncates a table shared by every business. Acceptable only because
	// this whole deployment is one demo; it would be a data-loss bug in a
	// real multi-tenant install.
	res = tx.Exec("DELETE FROM dashboard_snapshots")
	if res.Error != nil {
		return fmt.Errorf("wipe dashboard_snapshots: %w", res.Error)
	}
	if res.RowsAffected > 0 {
		rep.Deleted["dashboard_snapshots"] = res.RowsAffected
	}

	return nil
}

// removeUploadFiles deletes this business's files from disk.
//
// Called AFTER the delete transaction commits, never inside it. A rolled-back
// wipe whose files were already gone is unrecoverable; files left behind
// after a successful wipe are merely untidy, and the orphan sweep below
// collects them next time.
func removeUploadFiles(ctx context.Context, d *Deps, keys []string) (int, error) {
	dir, err := filepath.Abs(d.cfg.UploadsDir)
	if err != nil {
		return 0, fmt.Errorf("resolve uploads dir: %w", err)
	}
	// Refuse to sweep a root or empty path. os.Remove over a filesystem root
	// is not a mistake worth risking on a string from config.
	if dir == "" || dir == filepath.VolumeName(dir)+string(filepath.Separator) {
		return 0, fmt.Errorf("refusing to sweep uploads dir %q", dir)
	}

	removed := 0
	for _, key := range keys {
		// The column is data, so treat it as untrusted: a key containing
		// "../" must not escape the uploads directory.
		if key == "" || key != filepath.Base(key) {
			continue
		}
		p := filepath.Join(dir, key)
		if !strings.HasPrefix(p, dir+string(filepath.Separator)) {
			continue
		}
		if err := os.Remove(p); err == nil {
			removed++
		}
		// A missing file is not an error — the row outliving the file is
		// exactly the state a previous partial reset would leave.
	}

	n, err := sweepOrphanUploads(ctx, d, dir)
	if err != nil {
		return removed, err
	}
	return removed + n, nil
}

// sweepOrphanUploads removes files on disk that no surviving uploaded_files
// row claims.
//
// Needed because upload.SaveBytes writes a file WITHOUT a database row, so
// deleting by storage key alone leaves debris that accumulates across every
// reset. Driving the sweep off the surviving rows of ALL businesses makes it
// safe by construction: a file another tenant still references is never a
// candidate.
func sweepOrphanUploads(ctx context.Context, d *Deps, dir string) (int, error) {
	var keys []string
	if err := d.db.WithContext(platform.AllowCrossTenant(ctx)).
		Table("uploaded_files").
		Pluck("storage_key", &keys).Error; err != nil {
		return 0, fmt.Errorf("list surviving upload keys: %w", err)
	}
	claimed := make(map[string]bool, len(keys))
	for _, k := range keys {
		claimed[k] = true
	}

	entries, err := os.ReadDir(dir)
	if err != nil {
		// No uploads directory yet is normal on a fresh checkout.
		if os.IsNotExist(err) {
			return 0, nil
		}
		return 0, fmt.Errorf("read uploads dir: %w", err)
	}

	removed := 0
	for _, e := range entries {
		if e.IsDir() || claimed[e.Name()] {
			continue
		}
		// Never touch dotfiles. The uploads directory is tracked in git by a
		// .gitkeep, which no uploaded_files row will ever claim — the first
		// version of this sweep deleted it on every run and the deletion
		// showed up as a repository change nobody had made.
		if strings.HasPrefix(e.Name(), ".") {
			continue
		}
		if err := os.Remove(filepath.Join(dir, e.Name())); err == nil {
			removed++
		}
	}
	return removed, nil
}
