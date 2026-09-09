package demoseed

import (
	"context"
	"fmt"

	"cloudhouse/backend/internal/authz"
	"cloudhouse/backend/internal/employee"
	"cloudhouse/backend/internal/loan"
	"cloudhouse/backend/internal/platform"
)

// adminUsername is echoed back in the Report so the operator can see which
// login survived. Aliased rather than used inline so there is one place to
// look if the bootstrap admin is ever renamed.
const adminUsername = employee.AdminUsername

// seedGrants rebuilds role_permissions from the catalogue and re-applies the
// role restrictions, reproducing exactly what migrate.Run would produce.
//
// The wipe deleted every grant, so this is not optional — without it the
// admin holds no permissions and the entire console 403s. Rebuilding rather
// than preserving is the point: a permission an operator toggled off while
// demonstrating Roles & Permissions comes back on for the next client.
//
// # WHY NOT authz.Repository.BackfillGrants
//
// BackfillGrants issues a slice Create of roughly 810 RolePermission rows.
// role_permissions IS tenant-scoped, and GORM's stamp callback does not
// reliably fire on a slice insert — the same pitfall documented at
// personalloan/service.go and investment/service.go, where both services
// stamp TenantID by hand for exactly this reason. migrate.Run gets away with
// calling it because it runs cross-tenant and backfills the zeros afterwards;
// here most rows would persist at tenant_id = 0, be invisible to every
// permission lookup, and every check would 403. So the grid is built and
// stamped explicitly.
func seedGrants(ctx context.Context, d *Deps, st *state, rep *Report) error {
	// Two roles beyond the nine canonical ones, so the Roles & Permissions
	// screen has custom rows to open and edit. Created BEFORE the grid below
	// so they receive grants like any other role. The wipe removes exactly
	// these (it keeps only authz.StaffRoles by name), so they come back
	// unmodified on every reset even if an operator edited them mid-demo.
	for _, r := range customRoleFixtures {
		if _, err := d.authzRepo.CreateRole(ctx, r.Name, r.Description); err != nil {
			return fmt.Errorf("create role %q: %w", r.Name, err)
		}
	}
	rep.created("custom roles", len(customRoleFixtures))

	roles, err := d.authzRepo.ListRoles(ctx)
	if err != nil {
		return fmt.Errorf("list roles: %w", err)
	}
	if len(roles) == 0 {
		return fmt.Errorf("no roles found for this business — run `go run ./cmd/migrate` first")
	}

	// permissions is the one deliberately GLOBAL authz table, so it is read
	// cross-tenant and was never touched by the wipe.
	var perms []authz.Permission
	if err := d.db.WithContext(platform.AllowCrossTenant(ctx)).Find(&perms).Error; err != nil {
		return fmt.Errorf("list permissions: %w", err)
	}
	if len(perms) == 0 {
		return fmt.Errorf("permission catalogue is empty — run `go run ./cmd/migrate` first")
	}

	// authz.Repository.CreateRole seeds its own grant rows for the role it
	// creates, so the custom roles above already have some. They are cleared
	// here so the grid below is the single source of truth rather than
	// colliding with them on idx_role_permission, which is unique on
	// (role_id, permission_id) and NOT scoped by tenant.
	//
	// The `OR tenant_id = 0` is load-bearing and is the batch-insert bug
	// again: CreateRole writes its grants with a slice Create, so the stamp
	// callback does not fire and those rows land at tenant_id = 0. A delete
	// scoped to this business alone leaves them behind, and the grid then
	// fails on the unique index — which is exactly what happened while this
	// was being written.
	if err := d.db.WithContext(platform.AllowCrossTenant(ctx)).
		Exec("DELETE FROM role_permissions WHERE tenant_id = ? OR tenant_id = 0 OR tenant_id IS NULL",
			st.tenantID).Error; err != nil {
		return fmt.Errorf("clear grants before rebuild: %w", err)
	}

	rows := make([]authz.RolePermission, 0, len(roles)*len(perms))
	for _, r := range roles {
		if r.Name == authz.SystemRoleName {
			st.adminRoleID = r.ID
		}
		for _, p := range perms {
			rp := authz.RolePermission{RoleID: r.ID, PermissionID: p.ID, Permission: true}
			rp.TenantID = st.tenantID // the manual stamp this function exists for
			rows = append(rows, rp)
		}
	}
	if st.adminRoleID == 0 {
		return fmt.Errorf("no %q role found for this business", authz.SystemRoleName)
	}

	if err := d.db.WithContext(ctx).CreateInBatches(rows, 200).Error; err != nil {
		return fmt.Errorf("insert grants: %w", err)
	}

	// ApplyRestrictions is safe to reuse verbatim: it loops single-struct
	// upserts, so the stamp callback does fire. This is what narrows the
	// allow-all default back to the separation-of-duties the approval chains
	// depend on.
	if err := d.authzRepo.ApplyRestrictions(ctx, authz.Restrictions); err != nil {
		return fmt.Errorf("apply restrictions: %w", err)
	}
	rep.created("permission grants", len(rows))

	// The sanction chain compares a loan's principal against this per-role
	// ceiling. Seeded directly because loan.SeedLoanOperatorLimit is a
	// boot-time cross-tenant seeder and would write at tenant_id = 0.
	limit := loan.ApprovalLimit{Role: "Loan Operator", MaxAmount: 50000}
	limit.TenantID = st.tenantID
	if err := d.db.WithContext(ctx).Create(&limit).Error; err != nil {
		return fmt.Errorf("seed approval limit: %w", err)
	}
	rep.created("approval limits", 1)

	return nil
}
