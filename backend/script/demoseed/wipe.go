package demoseed

import (
	"context"
	"fmt"
	"os"
	"path/filepath"
	"strings"

	"cloudhouse/backend/internal/authz"
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

	// Parents and flat tables.
	"customer_otp",
	"customer_device_tokens",
	"customers",
	"investment_plans",
	"schemes",
	"lockers",
	"banks",
	"ornament_types",
	"gold_rates",
	"cash_movements",
	"expenses",
	"opening_cash_balances",
	"approval_limits",
	"communication_logs",
	"audit_log_entries",
	"uploaded_files",
	// Deleted and re-seeded by seed_masters.go. Re-seeded rather than kept
	// because puritystandard.SeedStandards runs cross-tenant and would either
	// skip on another business's row or create ours at tenant_id 0.
	"purity_standards",
	// Grants are rebuilt from the catalogue, so a permission an operator
	// toggled during a demo reverts. Role ROWS survive (see wipeRoles), which
	// is what keeps the admin's role_id valid.
	"role_permissions",
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
	// role_permissions is correctly scoped for ordinary writes, but
	// authz.Repository.CreateRole inserts a role's initial grants with a
	// slice Create — the batch-insert pitfall — so those particular rows land
	// at tenant_id = 0. Without sweeping them the unique index on
	// (role_id, permission_id) blocks the next reseed.
	"role_permissions": true,
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

	// Read the upload keys BEFORE the rows are deleted; afterwards there is
	// no record of which files on disk belonged to this business.
	var keys []string
	if err := db.WithContext(ctx).
		Table("uploaded_files").
		Where("tenant_id = ?", tenantID).
		Pluck("storage_key", &keys).Error; err != nil {
		return nil, fmt.Errorf("list upload keys: %w", err)
	}

	return &preserved{adminID: row.ID, adminBranchID: row.BranchID, uploadKeys: keys}, nil
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
	if untenantedTables[table] {
		res := tx.Exec(
			"DELETE FROM "+table+" WHERE tenant_id = ? OR tenant_id = 0 OR tenant_id IS NULL",
			tenantID)
		return res.RowsAffected, res.Error
	}
	res := tx.Exec("DELETE FROM "+table+" WHERE tenant_id = ?", tenantID)
	return res.RowsAffected, res.Error
}

// wipeIdentityTables clears the tables that carry the login, keeping the rows
// the admin depends on.
func wipeIdentityTables(tx *gorm.DB, tenantID uint, keep *preserved, rep *Report) error {
	// Employees: everyone except the admin.
	res := tx.Exec("DELETE FROM employees WHERE tenant_id = ? AND id <> ?", tenantID, keep.adminID)
	if res.Error != nil {
		return fmt.Errorf("wipe employees: %w", res.Error)
	}
	rep.Deleted["employees"] = res.RowsAffected

	// Roles: only ones an operator invented during a demo. The nine canonical
	// roles stay, which is what keeps the admin's role_id — and therefore
	// every permission check — valid. The name list is built from
	// authz.StaffRoles rather than typed out, so it cannot drift from the
	// roles migrate actually seeds.
	res = tx.Exec("DELETE FROM roles WHERE tenant_id = ? AND name NOT IN ?", tenantID, authz.StaffRoles)
	if res.Error != nil {
		return fmt.Errorf("wipe roles: %w", res.Error)
	}
	if res.RowsAffected > 0 {
		rep.Deleted["roles"] = res.RowsAffected
	}

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
