package migrate

import (
	"fmt"
	"log"

	"gorm.io/gorm"
)

// headOfficeSQL resolves every business's Head Office — the active branch
// named "Head Office", or its oldest active branch (branch.Repository.
// FindHeadOffice's rule) — as rows of (tenant_id, id). Every "no branch"
// backfill below points rows at their OWN business's Head Office: a fixed id
// such as 1 belongs to one business only.
const headOfficeSQL = `SELECT DISTINCT ON (tenant_id) tenant_id, id FROM branches
	WHERE is_active AND deleted_at IS NULL AND name <> ''
	ORDER BY tenant_id, (name = 'Head Office') DESC, id`

// ensureHeadOffices creates a Head Office for any business that has no
// active branch at all. Branch is mandatory on every branch-owned row, so a
// business must always have one to point them at — superadmin.CreateBusiness
// makes it on creation, this covers businesses that predate that. Idempotent.
func ensureHeadOffices(db *gorm.DB) error {
	if !db.Migrator().HasTable("branches") || !db.Migrator().HasTable("tenants") {
		return nil
	}
	res := db.Exec(`INSERT INTO branches (tenant_id, name, code, address, is_active, created_at, updated_at)
		SELECT t.id, 'Head Office', 'HO', 'Unknown', true, now(), now() FROM tenants t
		WHERE t.deleted_at IS NULL AND NOT EXISTS (
			SELECT 1 FROM branches b WHERE b.tenant_id = t.id AND b.is_active AND b.deleted_at IS NULL AND b.name <> '')`)
	if res.Error != nil {
		return fmt.Errorf("creating missing Head Office branches: %w", res.Error)
	}
	if res.RowsAffected > 0 {
		log.Printf("created Head Office for %d business(es) with no active branch", res.RowsAffected)
	}
	return nil
}

// pointAtHeadOffice sets table.column to the row's own business's Head
// Office wherever it is NULL (or 0). Idempotent.
func pointAtHeadOffice(db *gorm.DB, table, column string) error {
	if !db.Migrator().HasTable(table) || !db.Migrator().HasColumn(table, column) {
		return nil
	}
	res := db.Exec(fmt.Sprintf(`UPDATE %[1]s x SET %[2]s = ho.id FROM (%[3]s) ho
		WHERE ho.tenant_id = x.tenant_id AND (x.%[2]s IS NULL OR x.%[2]s = 0)`, table, column, headOfficeSQL))
	if res.Error != nil {
		return fmt.Errorf("pointing %s.%s at Head Office: %w", table, column, res.Error)
	}
	if res.RowsAffected > 0 {
		log.Printf("backfilled %s: %d row(s) -> their business's Head Office", table, res.RowsAffected)
	}
	return nil
}

// PrepareBranchRequired runs BEFORE AutoMigrate. banks.branch_id and
// cash_movements.branch_id are NOT NULL in the models, and AutoMigrate cannot
// add or tighten a NOT NULL column on a table that already holds NULLs — so
// every business gets a Head Office first, banks get the column (nullable)
// and every row is pointed at its business's Head Office, leaving
// AutoMigrate only the constraint to apply.
func PrepareBranchRequired(db *gorm.DB) error {
	if err := ensureHeadOffices(db); err != nil {
		return err
	}
	if db.Migrator().HasTable("banks") && !db.Migrator().HasColumn("banks", "branch_id") {
		if err := db.Exec(`ALTER TABLE banks ADD COLUMN branch_id bigint`).Error; err != nil {
			return fmt.Errorf("adding banks.branch_id: %w", err)
		}
	}
	for _, t := range []string{"banks", "cash_movements", "employees"} {
		if err := pointAtHeadOffice(db, t, "branch_id"); err != nil {
			return err
		}
	}
	return nil
}

// syncSingleBranchFlag turns single_branch on for every business on a
// 1-branch plan — that plan IS single-branch (superadmin.singleBranchFor) —
// repairing businesses whose flag drifted from it. It never turns the flag
// off: a larger plan may still be set single-branch by hand (SetBranchMode).
// Idempotent.
func syncSingleBranchFlag(db *gorm.DB) error {
	res := db.Exec(`UPDATE tenants t SET single_branch = true
		FROM tiers tr WHERE tr.id = t.tier_id AND tr.branch_quota = 1 AND NOT t.single_branch`)
	if res.Error != nil {
		return fmt.Errorf("syncing tenants.single_branch with their plan: %w", res.Error)
	}
	if res.RowsAffected > 0 {
		log.Printf("synced single_branch with the plan for %d business(es)", res.RowsAffected)
	}
	return nil
}

// RequireBranchColumns runs AFTER AutoMigrate and the bank backfills (which
// may file banks without a branch): it points any remaining NULL at the
// business's Head Office, then makes banks.branch_id and
// cash_movements.branch_id NOT NULL — AutoMigrate never tightens an existing
// column's nullability on its own. Idempotent.
func RequireBranchColumns(db *gorm.DB) error {
	for _, t := range []string{"banks", "cash_movements"} {
		if err := pointAtHeadOffice(db, t, "branch_id"); err != nil {
			return err
		}
		if err := db.Exec(fmt.Sprintf(`ALTER TABLE %s ALTER COLUMN branch_id SET NOT NULL`, t)).Error; err != nil {
			return fmt.Errorf("making %s.branch_id NOT NULL: %w", t, err)
		}
	}
	return nil
}
