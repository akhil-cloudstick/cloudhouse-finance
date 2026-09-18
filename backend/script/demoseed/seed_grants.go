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

// seedGrants makes sure this business has a usable set of roles and grants,
// WITHOUT resetting the ones it already has.
//
// Roles and their permissions are configuration, not demo data — the wipe
// leaves both alone, the same way it leaves the business's logo, colours and
// fonts alone. So this is a fill-the-gaps step, not a rebuild:
//
//   - fixture roles are created only when a role of that name is missing;
//   - the full grant grid is written only for a business that has NO grants
//     at all, which is either a brand-new business or one left broken by the
//     older reset that did wipe them. A business with grants keeps every
//     permission exactly as its administrator left it.
//
// # WHY NOT authz.Repository.BackfillGrants FOR THE REBUILD
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
	roles, err := d.authzRepo.ListRoles(ctx)
	if err != nil {
		return fmt.Errorf("list roles: %w", err)
	}

	// Two roles beyond the nine canonical ones, so the Roles & Permissions
	// screen has custom rows to open and edit. Created by NAME-CHECK rather
	// than unconditionally: roles now survive the wipe, so a second reset
	// would otherwise add a second "Front Desk" every time.
	existing := make(map[string]bool, len(roles))
	for _, r := range roles {
		existing[r.Name] = true
	}
	created := 0
	for _, r := range customRoleFixtures {
		if existing[r.Name] {
			continue
		}
		if _, err := d.authzRepo.CreateRole(ctx, r.Name, r.Description); err != nil {
			return fmt.Errorf("create role %q: %w", r.Name, err)
		}
		created++
	}
	if created > 0 {
		rep.created("custom roles", created)
		// Re-read so the roles just created are included below.
		if roles, err = d.authzRepo.ListRoles(ctx); err != nil {
			return fmt.Errorf("list roles: %w", err)
		}
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

	// The Administrator role id is needed by the loan flows further down
	// whatever happens to the grants below.
	for _, r := range roles {
		if r.Name == authz.SystemRoleName {
			st.adminRoleID = r.ID
		}
	}
	if st.adminRoleID == 0 {
		return fmt.Errorf("no %q role found for this business", authz.SystemRoleName)
	}

	// Which of this business's roles already hold grants. Counted BY ROLE and
	// not by tenant_id, because idx_role_permission is (role_id,
	// permission_id) with no tenant column: a row is a collision for this
	// business's role whatever tenant_id it carries, and it routinely carries
	// the wrong one (CreateRole's slice insert lands rows at tenant_id = 0,
	// and the next boot's migrate.backfillTenancy sweeps those to the DEFAULT
	// tenant rather than the owning one). Counting by tenant_id is what made
	// the reset insert duplicates and die on 23505.
	var granted []uint
	if err := d.db.WithContext(platform.AllowCrossTenant(ctx)).
		Raw(`SELECT DISTINCT role_id FROM role_permissions
		     WHERE role_id IN (SELECT id FROM roles WHERE tenant_id = ?)`, st.tenantID).
		Scan(&granted).Error; err != nil {
		return fmt.Errorf("read existing grants: %w", err)
	}
	hasGrants := make(map[uint]bool, len(granted))
	for _, id := range granted {
		hasGrants[id] = true
	}

	// Only roles with NO grants at all are filled in — a brand-new business,
	// or one left empty by the older reset that used to wipe this table. A
	// role whose permissions an administrator has curated is left exactly as
	// they set it, which is the whole point of not treating permissions as
	// demo data.
	rows := make([]authz.RolePermission, 0, len(roles)*len(perms))
	for _, r := range roles {
		if hasGrants[r.ID] {
			continue
		}
		for _, p := range perms {
			rp := authz.RolePermission{RoleID: r.ID, PermissionID: p.ID, Permission: true}
			rp.TenantID = st.tenantID // the manual stamp this function exists for
			rows = append(rows, rp)
		}
	}

	if len(rows) > 0 {
		if err := d.db.WithContext(ctx).CreateInBatches(rows, 200).Error; err != nil {
			return fmt.Errorf("insert grants: %w", err)
		}
		// ApplyRestrictions is safe to reuse verbatim: it loops single-struct
		// upserts, so the stamp callback does fire. This is what narrows the
		// allow-all default back to the separation-of-duties the approval
		// chains depend on. Run only when grants were actually created, so it
		// cannot silently re-revoke something an administrator granted.
		if err := d.authzRepo.ApplyRestrictions(ctx, authz.Restrictions); err != nil {
			return fmt.Errorf("apply restrictions: %w", err)
		}
		rep.created("permission grants", len(rows))
	}

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
