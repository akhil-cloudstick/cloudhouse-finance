package authz

import (
	"context"
	"errors"
	"log"
	"strings"

	"gorm.io/gorm"
	"gorm.io/gorm/logger"

	"cloudhouse/backend/internal/platform"
)

// Repository provides GORM-backed persistence for roles, the permission
// catalogue, and role_permissions grants.
type Repository struct {
	db platform.DB
}

func NewRepository(db platform.DB) *Repository {
	return &Repository{db: db}
}

// --- seeding (internal/migrate calls these on every boot) ---------------

// SeedRoles idempotently inserts every role in StaffRoles that doesn't
// already exist by name, marking SystemRoleName IsSystem=true. Never
// overwrites an existing row (so an administrator's edits to description/
// isActive survive repeated migrate runs).
func (r *Repository) SeedRoles(ctx context.Context, names []string) error {
	// Silence the "record not found" log line GORM emits for the (expected,
	// frequent) not-found lookups below — they're not errors here, just the
	// idempotency check.
	quietDB := r.db.WithContext(ctx).Session(&gorm.Session{Logger: r.db.WithContext(ctx).Logger.LogMode(logger.Silent)})
	for _, name := range names {
		var existing Role
		err := quietDB.Where("name = ?", name).First(&existing).Error
		if err == nil {
			continue
		}
		if !errors.Is(err, gorm.ErrRecordNotFound) {
			return err
		}
		role := Role{Name: name, IsActive: true, IsSystem: name == SystemRoleName}
		if err := r.db.WithContext(ctx).Create(&role).Error; err != nil {
			return err
		}
		log.Printf("authz: seeded role %q (isSystem=%v)", name, role.IsSystem)
	}
	return nil
}

// SeedCatalogue idempotently inserts every permission in Catalogue that
// doesn't already exist by name. Never overwrites an existing row's
// description/module, only the description text may change in a later
// catalogue edit — see the standard's renaming rules (a name is never
// reused for a different permission).
func (r *Repository) SeedCatalogue(ctx context.Context, defs []PermissionDef) error {
	quietDB := r.db.WithContext(ctx).Session(&gorm.Session{Logger: r.db.WithContext(ctx).Logger.LogMode(logger.Silent)})
	for _, def := range defs {
		var existing Permission
		err := quietDB.Where("name = ?", def.Name).First(&existing).Error
		if err == nil {
			continue
		}
		if !errors.Is(err, gorm.ErrRecordNotFound) {
			return err
		}
		p := Permission{Name: def.Name, Description: def.Description, ModuleName: def.ModuleName, IsActive: true}
		if err := r.db.WithContext(ctx).Create(&p).Error; err != nil {
			return err
		}
	}
	return nil
}

// RegroupModules resyncs an EXPLICIT, narrow list of permission names'
// ModuleName/Description columns to whatever internal/authz.Catalogue
// currently says for them, bypassing SeedCatalogue's normal "never touch an
// existing row" rule above. That rule protects an admin's own catalogue
// edits from being silently reverted on the next boot — it deliberately
// does NOT apply here, because this only ever targets permissions this
// codebase itself just introduced and regrouped in the same change (e.g.
// splitting one lumped "Approval Workflow" module into "Loan Sanction" /
// "Loan Extension Approval" / "Release Approval" / "Auction Workflow" —
// permissions no admin had a chance to reconfigure yet, since they didn't
// exist under their old grouping for more than one deploy). Existing
// role_permissions grants for these permissions are untouched — only which
// module they're grouped under on the Roles & Permissions screen changes;
// who holds them is unaffected. No-op (0 rows) once already resynced.
func (r *Repository) RegroupModules(defs []PermissionDef) (updated int, err error) {
	for _, def := range defs {
		// Background context on purpose: RegroupModules runs at migration time,
		// outside any request, and permissions is the global catalogue — not one
		// business's data. It therefore wants the shared pool, not a pinned
		// per-request connection.
		res := r.db.WithContext(context.Background()).Model(&Permission{}).
			Where("name = ? AND (module_name <> ? OR description <> ?)", def.Name, def.ModuleName, def.Description).
			Updates(map[string]any{"module_name": def.ModuleName, "description": def.Description})
		if res.Error != nil {
			return updated, res.Error
		}
		updated += int(res.RowsAffected)
	}
	return updated, nil
}

// BackfillGrants inserts a role_permissions row (Permission=true) for every
// (role, permission) pair that doesn't already have one — every existing
// role, every existing permission. New permissions/roles are granted by
// default; an administrator curates by revoking, not by hunting for what to
// grant (see the standard's §3.3/§4.1). Never touches a row that already
// exists, so explicit revocations from a prior run/ApplyRestrictions survive.
func (r *Repository) BackfillGrants(ctx context.Context) (inserted int, err error) {
	var roles []Role
	if err := r.db.WithContext(ctx).Find(&roles).Error; err != nil {
		return 0, err
	}
	var perms []Permission
	if err := r.db.WithContext(ctx).Find(&perms).Error; err != nil {
		return 0, err
	}

	var existing []RolePermission
	if err := r.db.WithContext(ctx).Find(&existing).Error; err != nil {
		return 0, err
	}
	have := make(map[[2]uint]bool, len(existing))
	for _, rp := range existing {
		have[[2]uint{rp.RoleID, rp.PermissionID}] = true
	}

	var toCreate []RolePermission
	for _, role := range roles {
		for _, perm := range perms {
			key := [2]uint{role.ID, perm.ID}
			if have[key] {
				continue
			}
			// TenantID copied off the role BY HAND: this runs under
			// AllowCrossTenant at boot, where the stamp callback does not
			// fire, so a row left to it lands at tenant_id = 0 and is later
			// swept to the default tenant — out of sight of the business
			// that owns the role. See CreateRole's same comment.
			rp := RolePermission{RoleID: role.ID, PermissionID: perm.ID, Permission: true}
			rp.TenantID = role.TenantID
			toCreate = append(toCreate, rp)
		}
	}
	if len(toCreate) == 0 {
		return 0, nil
	}
	if err := r.db.WithContext(ctx).Create(&toCreate).Error; err != nil {
		return 0, err
	}
	log.Printf("authz: back-filled %d role_permissions row(s)", len(toCreate))
	return len(toCreate), nil
}

// BackfillCRUDSplitGrants inserts role_permissions rows for the "can
// create/update/delete <noun>" permissions introduced by the create/view/
// update/delete split (see Catalogue's doc comment and CRUDSplitNouns), one
// noun at a time, in a single transaction. For each noun and each existing
// role, the three new permissions are granted TRUE only if that role
// currently holds "can change <noun>" = TRUE, otherwise FALSE — copying the
// existing grant forward rather than defaulting to TRUE, since these are
// finer-grained authorities than the blanket "change" permission they
// replace going forward. Idempotent: skips any (role, permission) pair that
// already has a role_permissions row, so re-running (or the generic
// BackfillGrants that runs after this) never overwrites a later manual
// edit. Must run AFTER SeedCatalogue (the new permissions must already
// exist) and BEFORE BackfillGrants (which would otherwise default-grant
// TRUE to any pair still missing a row).
func (r *Repository) BackfillCRUDSplitGrants(ctx context.Context, nouns []string) (inserted int, err error) {
	var roles []Role
	if err := r.db.WithContext(ctx).Find(&roles).Error; err != nil {
		return 0, err
	}
	var allPerms []Permission
	if err := r.db.WithContext(ctx).Find(&allPerms).Error; err != nil {
		return 0, err
	}
	permByName := make(map[string]Permission, len(allPerms))
	for _, p := range allPerms {
		permByName[p.Name] = p
	}

	var existing []RolePermission
	if err := r.db.WithContext(ctx).Find(&existing).Error; err != nil {
		return 0, err
	}
	have := make(map[[2]uint]bool, len(existing))
	grant := make(map[[2]uint]bool, len(existing))
	for _, rp := range existing {
		key := [2]uint{rp.RoleID, rp.PermissionID}
		have[key] = true
		grant[key] = rp.Permission
	}

	return inserted, r.db.WithContext(ctx).Transaction(func(tx *gorm.DB) error {
		var toCreate []RolePermission
		for _, noun := range nouns {
			changePerm, ok := permByName["can change "+noun]
			if !ok {
				continue // no "can change <noun>" to copy from — shouldn't happen for a seeded catalogue
			}
			for _, verb := range []string{"create", "update", "delete"} {
				newPerm, ok := permByName["can "+verb+" "+noun]
				if !ok {
					continue // permission not seeded yet (shouldn't happen after SeedCatalogue)
				}
				for _, role := range roles {
					key := [2]uint{role.ID, newPerm.ID}
					if have[key] {
						continue
					}
					copied := grant[[2]uint{role.ID, changePerm.ID}]
					rp := RolePermission{RoleID: role.ID, PermissionID: newPerm.ID, Permission: copied}
					rp.TenantID = role.TenantID // see BackfillGrants
					toCreate = append(toCreate, rp)
				}
			}
		}
		if len(toCreate) == 0 {
			return nil
		}
		if err := tx.Create(&toCreate).Error; err != nil {
			return err
		}
		inserted = len(toCreate)
		return nil
	})
}

// PurgeLegacyChangePermissions deletes every "can change ..." permission and
// its role_permissions rows. The blanket change permission was replaced by
// the create/update/delete trio (see Catalogue's doc comment); leaving the
// old rows in place only made the admin matrix show a column nothing
// enforces. Two grants are copied forward first so no access is silently
// lost on the boot that runs this:
//
//   - "can change <noun>" -> create/update/delete <noun>, done by
//     BackfillCRUDSplitGrants, which MUST have run before this.
//   - "can change role permission" -> "can update role", done here, since
//     that permission had no create/update/delete trio to split into and
//     grant editing now rides on "can update role" (see routes.go).
//
// Idempotent: a database that has already been purged has nothing matching
// left to delete.
func (r *Repository) PurgeLegacyChangePermissions(ctx context.Context) (deleted int, err error) {
	return deleted, r.db.WithContext(ctx).Transaction(func(tx *gorm.DB) error {
		var legacy []Permission
		if err := tx.Where("name LIKE ?", "can change %").Find(&legacy).Error; err != nil {
			return err
		}
		if len(legacy) == 0 {
			return nil
		}

		// Copy the old grant-editing permission onto "can update role" before
		// it disappears — only where the role actually held it.
		for _, perm := range legacy {
			if perm.Name != "can change role permission" {
				continue
			}
			var updateRole Permission
			if err := tx.Where("name = ?", "can update role").First(&updateRole).Error; err != nil {
				if errors.Is(err, gorm.ErrRecordNotFound) {
					break
				}
				return err
			}
			var held []RolePermission
			if err := tx.Where("permission_id = ? AND permission = ?", perm.ID, true).Find(&held).Error; err != nil {
				return err
			}
			for _, rp := range held {
				if err := tx.Model(&RolePermission{}).
					Where("role_id = ? AND permission_id = ?", rp.RoleID, updateRole.ID).
					Update("permission", true).Error; err != nil {
					return err
				}
			}
		}

		ids := make([]uint, 0, len(legacy))
		for _, perm := range legacy {
			ids = append(ids, perm.ID)
		}
		if err := tx.Where("permission_id IN ?", ids).Delete(&RolePermission{}).Error; err != nil {
			return err
		}
		if err := tx.Where("id IN ?", ids).Delete(&Permission{}).Error; err != nil {
			return err
		}
		deleted = len(ids)
		log.Printf("authz: purged %d legacy \"can change ...\" permission(s)", deleted)
		return nil
	})
}

// ApplyRestrictions re-applies every RoleRestriction: AllowedRoles get
// Permission=true, every other seeded role gets Permission=false. Runs after
// BackfillGrants on every boot, so it always reflects the current
// Restrictions list even if an administrator's manual edit had drifted from
// it (this is the one place authz still enforces a hardcoded default — every
// other role change goes through UpdateRolePermissions and is never
// re-applied at startup).
func (r *Repository) ApplyRestrictions(ctx context.Context, restrictions []RoleRestriction) error {
	var roles []Role
	if err := r.db.WithContext(ctx).Find(&roles).Error; err != nil {
		return err
	}
	for _, restriction := range restrictions {
		var perm Permission
		if err := r.db.WithContext(ctx).Where("name = ?", restriction.PermissionName).First(&perm).Error; err != nil {
			return err
		}
		allowed := make(map[string]bool, len(restriction.AllowedRoles))
		for _, name := range restriction.AllowedRoles {
			allowed[name] = true
		}
		for _, role := range roles {
			if err := r.upsertGrant(ctx, role, perm.ID, allowed[role.Name]); err != nil {
				return err
			}
		}
	}
	return nil
}

func (r *Repository) upsertGrant(ctx context.Context, role Role, permissionID uint, allowed bool) error {
	var existing RolePermission
	err := r.db.WithContext(ctx).Where("role_id = ? AND permission_id = ?", role.ID, permissionID).First(&existing).Error
	if err == nil {
		if existing.Permission == allowed {
			return nil
		}
		existing.Permission = allowed
		return r.db.WithContext(ctx).Save(&existing).Error
	}
	if !errors.Is(err, gorm.ErrRecordNotFound) {
		return err
	}
	return createGrant(r.db.WithContext(ctx), role, permissionID, allowed)
}

// createGrant inserts one role_permissions row, stamped with the role's own
// tenant (see BackfillGrants for why by hand).
//
// A deny needs a second statement: Permission carries `default:true`, and
// GORM leaves a zero-valued field with a default out of the INSERT, so a
// plain Create of Permission=false silently stores TRUE — a revocation that
// grants.
func createGrant(db *gorm.DB, role Role, permissionID uint, allowed bool) error {
	rp := RolePermission{RoleID: role.ID, PermissionID: permissionID, Permission: allowed}
	rp.TenantID = role.TenantID
	if err := db.Create(&rp).Error; err != nil {
		return err
	}
	if allowed {
		return nil
	}
	return db.Model(&RolePermission{}).Where("id = ?", rp.ID).Update("permission", false).Error
}

// --- runtime checks (RequirePermission calls this) -----------------------

// IsAllowed reports whether roleID holds permissionName, joining
// role_permissions to permissions in one query (see platform.RequirePermission).
// Returns platform.ErrPermissionNotFound if no row exists at all — almost
// always a typo in a route's permission string, or a missing seed — distinct
// from an explicit deny (a real row with Permission=false).
func (r *Repository) IsAllowed(ctx context.Context, roleID uint, permissionName string) (bool, error) {
	var row struct {
		Permission bool
	}
	err := r.db.WithContext(ctx).Table("role_permissions AS rp").
		Select("rp.permission").
		Joins("JOIN permissions p ON p.id = rp.permission_id").
		Where("rp.role_id = ? AND p.name = ?", roleID, permissionName).
		Take(&row).Error
	if err != nil {
		if errors.Is(err, gorm.ErrRecordNotFound) {
			return false, platform.ErrPermissionNotFound
		}
		return false, err
	}
	return row.Permission, nil
}

// RoleIDByName looks up a role's id by its exact name — used by
// internal/migrate to backfill employee.RoleID from the legacy free-text
// Role column.
func (r *Repository) RoleIDByName(ctx context.Context, name string) (uint, error) {
	var role Role
	if err := r.db.WithContext(ctx).Where("name = ?", name).First(&role).Error; err != nil {
		return 0, err
	}
	return role.ID, nil
}

// --- bootstrap (GET .../permissions/by-employee) --------------------------

// BootstrapPermissions returns roleID's grants as the standard's derived
// Module_Name -> can_x boolean map (see the standard's §2.2/§7.1).
func (r *Repository) BootstrapPermissions(ctx context.Context, roleID uint) (map[string]map[string]bool, error) {
	var rows []struct {
		ModuleName     string
		PermissionName string
		Permission     bool
	}
	if err := r.db.WithContext(ctx).Table("role_permissions AS rp").
		Select("p.module_name, p.name AS permission_name, rp.permission").
		Joins("JOIN permissions p ON p.id = rp.permission_id").
		Where("rp.role_id = ? AND p.is_active = true", roleID).
		Scan(&rows).Error; err != nil {
		return nil, err
	}

	out := make(map[string]map[string]bool)
	for _, row := range rows {
		moduleKey := underscored(row.ModuleName)
		permKey := underscored(row.PermissionName)
		if out[moduleKey] == nil {
			out[moduleKey] = make(map[string]bool)
		}
		out[moduleKey][permKey] = row.Permission
	}
	return out, nil
}

// underscored derives the frontend key from a display name: replace every
// space with an underscore, nothing else (see the standard's §2.2).
func underscored(s string) string {
	return strings.ReplaceAll(s, " ", "_")
}

// --- admin matrix (GET/PATCH .../permissions) ------------------------------

// RolePermissionRow is one row of the admin matrix response (§7.2).
type RolePermissionRow struct {
	ID           uint       `json:"id"`
	RoleID       uint       `json:"role_id"`
	PermissionID uint       `json:"permission_id"`
	Permission   bool       `json:"permission"`
	Permissions  Permission `json:"permissions"`
}

// AdminMatrix returns every permission grouped by module for roleID, in the
// display shape the standard's §7.2 specifies, optionally filtered by a
// case-insensitive substring match against the permission name.
func (r *Repository) AdminMatrix(ctx context.Context, roleID uint, search string) (map[string][]RolePermissionRow, error) {
	q := r.db.WithContext(ctx).Table("role_permissions AS rp").
		Select("rp.id, rp.role_id, rp.permission_id, rp.permission, p.id AS p_id, p.name AS p_name, p.description AS p_description, p.module_name AS p_module_name, p.is_active AS p_is_active").
		Joins("JOIN permissions p ON p.id = rp.permission_id").
		Where("rp.role_id = ?", roleID)
	if strings.TrimSpace(search) != "" {
		q = q.Where("p.name ILIKE ?", "%"+strings.TrimSpace(search)+"%")
	}

	var rows []struct {
		ID           uint
		RoleID       uint
		PermissionID uint
		Permission   bool
		PID          uint   `gorm:"column:p_id"`
		PName        string `gorm:"column:p_name"`
		PDescription string `gorm:"column:p_description"`
		PModuleName  string `gorm:"column:p_module_name"`
		PIsActive    bool   `gorm:"column:p_is_active"`
	}
	if err := q.Order("p.id asc").Scan(&rows).Error; err != nil {
		return nil, err
	}

	out := make(map[string][]RolePermissionRow)
	for _, row := range rows {
		out[row.PModuleName] = append(out[row.PModuleName], RolePermissionRow{
			ID: row.ID, RoleID: row.RoleID, PermissionID: row.PermissionID, Permission: row.Permission,
			Permissions: Permission{ID: row.PID, Name: row.PName, Description: row.PDescription, ModuleName: row.PModuleName, IsActive: row.PIsActive},
		})
	}
	return out, nil
}

// RolePermissionUpdate is one entry of the bare array PATCH
// .../permissions/:role_id accepts (§7.3).
type RolePermissionUpdate struct {
	PermissionID uint `json:"permission_id"`
	Permission   bool `json:"permission"`
}

// UpdateRolePermissions applies every update in one transaction — either all
// apply or none do (§7.3). Creates the role_permissions row on demand if a
// role predates a permission and has no row for it yet (§4.2).
func (r *Repository) UpdateRolePermissions(ctx context.Context, roleID uint, updates []RolePermissionUpdate) error {
	return r.db.WithContext(ctx).Transaction(func(tx *gorm.DB) error {
		var role Role
		if err := tx.First(&role, roleID).Error; err != nil {
			return err
		}
		for _, u := range updates {
			var perm Permission
			if err := tx.First(&perm, u.PermissionID).Error; err != nil {
				if errors.Is(err, gorm.ErrRecordNotFound) {
					return errPermissionNotFoundInCatalogue
				}
				return err
			}
			var existing RolePermission
			err := tx.Where("role_id = ? AND permission_id = ?", roleID, u.PermissionID).First(&existing).Error
			if err == nil {
				existing.Permission = u.Permission
				if err := tx.Save(&existing).Error; err != nil {
					return err
				}
				continue
			}
			if !errors.Is(err, gorm.ErrRecordNotFound) {
				return err
			}
			if err := createGrant(tx, role, u.PermissionID, u.Permission); err != nil {
				return err
			}
		}
		return nil
	})
}

var errPermissionNotFoundInCatalogue = errors.New("permission not found")

// IsPermissionNotFoundInCatalogue reports whether err came from
// UpdateRolePermissions referencing a permission id that doesn't exist.
func IsPermissionNotFoundInCatalogue(err error) bool {
	return errors.Is(err, errPermissionNotFoundInCatalogue)
}

// SetAllForRole sets every permission for roleID to allowed, in one
// transaction (§7.3's set-all endpoint). Creates any row the role is
// missing first — an UPDATE alone does nothing for a role that has none.
func (r *Repository) SetAllForRole(ctx context.Context, roleID uint, allowed bool) error {
	return r.db.WithContext(ctx).Transaction(func(tx *gorm.DB) error {
		if _, err := NewRepository(tx).SetEveryGrant(ctx, roleID, allowed); err != nil {
			return err
		}
		return nil
	})
}

// --- role lifecycle --------------------------------------------------------

// ErrSystemRole is returned whenever a caller tries to rename, deactivate,
// delete, or change the grants of an IsSystem role (§4.3).
var ErrSystemRole = errors.New("system roles cannot be modified")

// ErrRoleInUse is returned by DeleteRole when employees still hold the role.
var ErrRoleInUse = errors.New("role is still assigned to one or more employees")

func (r *Repository) ListRoles(ctx context.Context) ([]Role, error) {
	var roles []Role
	err := r.db.WithContext(ctx).Order("name asc").Find(&roles).Error
	return roles, err
}

func (r *Repository) GetRole(ctx context.Context, id uint) (*Role, error) {
	var role Role
	if err := r.db.WithContext(ctx).First(&role, id).Error; err != nil {
		return nil, err
	}
	return &role, nil
}

// CreateRole inserts the role and, in the same transaction, grants it every
// permission in the catalogue (Permission=true) — the standard's §4.1: a new
// role starts with everything, the administrator curates by revoking.
func (r *Repository) CreateRole(ctx context.Context, name, description string) (*Role, error) {
	role := &Role{Name: name, Description: description, IsActive: true}
	err := r.db.WithContext(ctx).Transaction(func(tx *gorm.DB) error {
		if err := tx.Create(role).Error; err != nil {
			return err
		}
		var perms []Permission
		if err := tx.Find(&perms).Error; err != nil {
			return err
		}
		// TenantID is stamped BY HAND, copied off the role that was just
		// created rather than left to the create callback. A slice Create is
		// the documented batch-insert pitfall: the stamp callback does not
		// fire, so these rows would land at tenant_id = 0 — and since
		// idx_role_permission is (role_id, permission_id) with no tenant
		// column, nothing ever complains. The damage shows up later, when the
		// next boot's migrate.backfillTenancy sweeps every zero to the
		// DEFAULT tenant, filing a business's own grants under tenant 1 where
		// its permission lookups cannot see them.
		rows := make([]RolePermission, 0, len(perms))
		for _, p := range perms {
			rp := RolePermission{RoleID: role.ID, PermissionID: p.ID, Permission: true}
			rp.TenantID = role.TenantID
			rows = append(rows, rp)
		}
		if len(rows) > 0 {
			if err := tx.Create(&rows).Error; err != nil {
				return err
			}
		}
		return nil
	})
	if err != nil {
		return nil, err
	}
	return role, nil
}

// UpdateRole renames/redescribes/(de)activates a role. Refuses on
// IsSystem (§4.3).
func (r *Repository) UpdateRole(ctx context.Context, id uint, name, description string, isActive bool) (*Role, error) {
	role, err := r.GetRole(ctx, id)
	if err != nil {
		return nil, err
	}
	if role.IsSystem {
		return nil, ErrSystemRole
	}
	role.Name = name
	role.Description = description
	role.IsActive = isActive
	if err := r.db.WithContext(ctx).Save(role).Error; err != nil {
		return nil, err
	}
	return role, nil
}

// DeleteRole refuses on IsSystem (§4.3) or if any employee still holds the
// role (§4.4) — role_permissions rows cascade via the DB foreign key once
// the role itself is allowed to be deleted.
func (r *Repository) DeleteRole(ctx context.Context, id uint) error {
	role, err := r.GetRole(ctx, id)
	if err != nil {
		return err
	}
	if role.IsSystem {
		return ErrSystemRole
	}
	count, err := r.CountEmployeesWithRole(ctx, id)
	if err != nil {
		return err
	}
	if count > 0 {
		return ErrRoleInUse
	}
	return r.db.WithContext(ctx).Transaction(func(tx *gorm.DB) error {
		if err := tx.Where("role_id = ?", id).Delete(&RolePermission{}).Error; err != nil {
			return err
		}
		return tx.Delete(&Role{}, id).Error
	})
}

// CountEmployeesWithRole queries the employees table directly (not via
// internal/employee, to avoid this low-level package depending on a
// higher-level domain package) for how many employees currently hold roleID.
func (r *Repository) CountEmployeesWithRole(ctx context.Context, roleID uint) (int64, error) {
	var count int64
	err := r.db.WithContext(ctx).Table("employees").Where("role_id = ? AND deleted_at IS NULL", roleID).Count(&count).Error
	return count, err
}

// GrantAllToRole grants every permission in the catalogue to roleID,
// Permission=true, skipping any that already have a row.
//
// Used to seed a BRAND NEW tenant's Administrator role with full access on
// day one (see internal/superadmin.Service.CreateBusiness). Deliberately a loop
// of single-row upserts rather than a batch insert: this runs under an
// explicit per-tenant context (platform.WithTenant, not AllowCrossTenant),
// which means the tenant-stamp callback (platform.stampCallback) must fire
// once per row created. GORM's callback stamps a batch/slice create's tenant
// column onto exactly one element of the slice, not all of them — a single-
// struct Create, which upsertGrant already uses, is unambiguously correct
// instead. Not the fast path, but this runs once per business created, never
// in a request hot path.
func (r *Repository) GrantAllToRole(ctx context.Context, roleID uint) (int, error) {
	return r.SetEveryGrant(ctx, roleID, true)
}

// SetEveryGrant gives roleID a row for every permission in the catalogue,
// all set to allowed — creating any that are missing, not just flipping the
// ones that exist. CreateBusiness calls it with false for the non-
// Administrator roles: a locked-down role still needs its rows, or the
// Roles & Permissions screen has nothing to list for it and the next boot's
// BackfillGrants would default-grant them all TRUE.
func (r *Repository) SetEveryGrant(ctx context.Context, roleID uint, allowed bool) (int, error) {
	role, err := r.GetRole(ctx, roleID)
	if err != nil {
		return 0, err
	}
	var perms []Permission
	if err := r.db.WithContext(ctx).Find(&perms).Error; err != nil {
		return 0, err
	}
	n := 0
	for _, p := range perms {
		if err := r.upsertGrant(ctx, *role, p.ID, allowed); err != nil {
			return n, err
		}
		n++
	}
	return n, nil
}
