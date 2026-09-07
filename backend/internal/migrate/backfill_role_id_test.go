package migrate

import (
	"context"
	"fmt"
	"os"
	"testing"
	"time"

	"ambikagold/backend/internal/platform"
)

// TestBackfillEmployeeRoleIDIsPerTenant is the regression test for a
// SEVERE cross-tenant bug found while investigating multi-tenancy Step 8's
// token invalidation, not by any prior test.
//
// backfillEmployeeRoleID used to resolve one role NAME's id with a single
// unscoped lookup and apply that one id to every employee across every
// tenant whose Role name matched — so on every server restart (this
// function runs on every migrate.Run call), every business but one had its
// employees' role_id silently overwritten to point at a DIFFERENT tenant's
// role. Since RequirePermission resolves permissions by (the caller's own
// tenant, this roleId), the result was "Permission not found" on every
// permission check, for every employee of every tenant but one, starting
// with their very next login after any restart.
//
// This test seeds two tenants with an Administrator role each (deliberately
// different ids), corrupts both employees' role_id to a THIRD, wrong value,
// runs the real backfill, and asserts each employee's role_id ends up
// matching THEIR OWN tenant's role — never the other tenant's, and never
// whichever role Postgres happened to look up first.
func TestBackfillEmployeeRoleIDIsPerTenant(t *testing.T) {
	name := os.Getenv("MT_TEST_DB")
	if name == "" {
		t.Skip("set MT_TEST_DB to a scratch database to run this test")
	}
	t.Setenv("DB_NAME", name)
	db, err := platform.NewDatabase(platform.LoadConfig())
	if err != nil {
		t.Skipf("cannot reach test database %q: %v", name, err)
	}
	if err := platform.RegisterTenantScope(db); err != nil {
		t.Fatalf("registering tenant scope: %v", err)
	}

	ctx := platform.AllowCrossTenant(context.Background())

	// Unique per run, not just per fixture — this test's own scratch rows
	// must not collide with a previous run's against the same long-lived
	// scratch database (the same pattern the isolation harness uses).
	run := time.Now().UnixNano() % 100000000 // short enough to fit tenants.code's varchar(32)

	type tenantFixture struct {
		tenantID, roleID, branchID, employeeID uint
	}
	seed := func(suffix string) tenantFixture {
		var f tenantFixture
		code := fmt.Sprintf("backfilltest-%d-%s", run, suffix)
		if err := db.WithContext(ctx).Raw(`
			INSERT INTO tenants (name, code, tier_id, status, created_at, updated_at)
			VALUES (?, ?, (SELECT id FROM tiers ORDER BY id LIMIT 1), 'active', now(), now())
			RETURNING id`, "Backfill Test "+suffix, code).
			Scan(&f.tenantID).Error; err != nil {
			t.Fatalf("seed tenant: %v", err)
		}
		if err := db.WithContext(ctx).Raw(`
			INSERT INTO roles (tenant_id, name, is_active, is_system, created_at, updated_at)
			VALUES (?, 'Administrator', true, true, now(), now()) RETURNING id`,
			f.tenantID).Scan(&f.roleID).Error; err != nil {
			t.Fatalf("seed role: %v", err)
		}
		if err := db.WithContext(ctx).Raw(`
			INSERT INTO branches (tenant_id, name, code, address, is_active, created_at, updated_at)
			VALUES (?, ?, 'BR-01', 'x', true, now(), now()) RETURNING id`,
			f.tenantID, "HO "+suffix).Scan(&f.branchID).Error; err != nil {
			t.Fatalf("seed branch: %v", err)
		}
		if err := db.WithContext(ctx).Raw(`
			INSERT INTO employees (tenant_id, code, name, role, role_id, branch_id, username, password_hash, created_at, updated_at)
			VALUES (?, ?, 'Admin', 'Administrator', ?, ?, ?, 'x', now(), now()) RETURNING id`,
			f.tenantID, "EMP-"+suffix, f.roleID, f.branchID, "backfill-"+suffix).
			Scan(&f.employeeID).Error; err != nil {
			t.Fatalf("seed employee: %v", err)
		}
		return f
	}

	a := seed("a")
	b := seed("b")
	if a.roleID == b.roleID {
		t.Fatalf("fixture bug: both tenants got the same role id (%d) — the test proves nothing", a.roleID)
	}

	// Corrupt both employees to a role id that belongs to NEITHER of them —
	// exactly the failure mode a global, unscoped resolution produces.
	wrongID := a.roleID + b.roleID + 1000
	if err := db.WithContext(ctx).Exec(
		`UPDATE employees SET role_id = ? WHERE id IN (?, ?)`, wrongID, a.employeeID, b.employeeID).Error; err != nil {
		t.Fatalf("corrupting fixture role_id: %v", err)
	}

	if err := backfillEmployeeRoleID(db); err != nil {
		t.Fatalf("backfillEmployeeRoleID: %v", err)
	}

	var gotA, gotB uint
	if err := db.WithContext(ctx).Raw(`SELECT role_id FROM employees WHERE id = ?`, a.employeeID).Scan(&gotA).Error; err != nil {
		t.Fatalf("reading back a: %v", err)
	}
	if err := db.WithContext(ctx).Raw(`SELECT role_id FROM employees WHERE id = ?`, b.employeeID).Scan(&gotB).Error; err != nil {
		t.Fatalf("reading back b: %v", err)
	}

	if gotA != a.roleID {
		t.Errorf("CROSS-TENANT CORRUPTION: tenant A's employee got role_id %d, want its OWN tenant's role %d (tenant B's is %d)",
			gotA, a.roleID, b.roleID)
	}
	if gotB != b.roleID {
		t.Errorf("CROSS-TENANT CORRUPTION: tenant B's employee got role_id %d, want its OWN tenant's role %d (tenant A's is %d)",
			gotB, b.roleID, a.roleID)
	}
}
