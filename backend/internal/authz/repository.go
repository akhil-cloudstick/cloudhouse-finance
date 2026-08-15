package authz

import (
	"errors"
	"log"

	"gorm.io/gorm"
	"gorm.io/gorm/logger"
)

// CRUDActions is the fixed set of CRUD-grain actions permissions are seeded
// for.
var CRUDActions = []string{"create", "read", "update", "delete"}

// Repository provides GORM-backed persistence for Permission records.
type Repository struct {
	db *gorm.DB
}

func NewRepository(db *gorm.DB) *Repository {
	return &Repository{db: db}
}

func (r *Repository) Create(p *Permission) error {
	return r.db.Create(p).Error
}

func (r *Repository) FindAll() ([]Permission, error) {
	var perms []Permission
	err := r.db.Order("role asc, resource asc, action asc").Find(&perms).Error
	return perms, err
}

func (r *Repository) FindByID(id uint) (*Permission, error) {
	var p Permission
	if err := r.db.First(&p, id).Error; err != nil {
		return nil, err
	}
	return &p, nil
}

func (r *Repository) Update(p *Permission) error {
	return r.db.Save(p).Error
}

func (r *Repository) Delete(id uint) error {
	return r.db.Delete(&Permission{}, id).Error
}

// IsAllowed reports whether role may perform action on resource. If no
// matching row exists, it returns false (fail-closed) — SeedDefaults is
// expected to have already inserted an allow-all row for every known
// (role, resource, action) combination, so a missing row generally means an
// unrecognized/unseeded resource or role rather than an intentional deny.
func (r *Repository) IsAllowed(role, resource, action string) (bool, error) {
	var p Permission
	err := r.db.Where("role = ? AND resource = ? AND action = ?", role, resource, action).First(&p).Error
	if err != nil {
		if errors.Is(err, gorm.ErrRecordNotFound) {
			return false, nil
		}
		return false, err
	}
	return p.Allowed, nil
}

// SeedDefaults idempotently inserts one row per (role x resource x action)
// combination with Allowed=true wherever a row doesn't already exist. It
// never overwrites an existing row (so custom edits made via a future admin
// screen survive repeated migrate runs). Returns counts of rows inserted
// and already-present (skipped), and logs a summary.
func (r *Repository) SeedDefaults(roles []string, resources []string) (inserted int, skipped int, err error) {
	// Silence the "record not found" log line GORM emits for the (expected,
	// frequent) not-found lookups below — they're not errors here, just the
	// idempotency check.
	quietDB := r.db.Session(&gorm.Session{Logger: r.db.Logger.LogMode(logger.Silent)})

	for _, role := range roles {
		for _, resource := range resources {
			for _, action := range CRUDActions {
				var existing Permission
				lookupErr := quietDB.Where("role = ? AND resource = ? AND action = ?", role, resource, action).First(&existing).Error
				if lookupErr == nil {
					skipped++
					continue
				}
				if !errors.Is(lookupErr, gorm.ErrRecordNotFound) {
					return inserted, skipped, lookupErr
				}
				p := Permission{Role: role, Resource: resource, Action: action, Allowed: true}
				if createErr := r.db.Create(&p).Error; createErr != nil {
					return inserted, skipped, createErr
				}
				inserted++
			}
		}
	}
	log.Printf("authz: permissions seed complete — %d inserted, %d already present", inserted, skipped)
	return inserted, skipped, nil
}

// RestrictResourceToRole locks a resource's write actions (create/update/
// delete) down to allowedRole only — every other role in otherRoles is set
// (or left) Allowed=false for those three actions. "read" is deliberately
// left alone (kept allowed for every role, admin included): every branch
// selector across the app (Employee/Customer/Loan/Scheme create modals,
// etc.) needs to read the Branches list to show branch names, even for
// non-admins who can't manage branches themselves — only Branches
// management (create/update/delete) is admin-only. Unlike SeedDefaults
// (insert-if-missing, never overwrite), this DOES overwrite existing rows
// for the affected roles/resource, so it can retroactively correct a
// resource that was previously seeded allow-all for everyone (e.g. Branch
// management, originally in authResources' allow-all loop). Idempotent and
// safe to run on every startup.
func (r *Repository) RestrictResourceToRole(resource, allowedRole string, otherRoles []string) error {
	writeActions := []string{"create", "update", "delete"}

	if err := r.upsertAllowed(allowedRole, resource, "read", true); err != nil {
		return err
	}
	for _, action := range writeActions {
		if err := r.upsertAllowed(allowedRole, resource, action, true); err != nil {
			return err
		}
	}
	for _, role := range otherRoles {
		if err := r.upsertAllowed(role, resource, "read", true); err != nil {
			return err
		}
		for _, action := range writeActions {
			if err := r.upsertAllowed(role, resource, action, false); err != nil {
				return err
			}
		}
	}
	log.Printf("authz: restricted resource %q writes to role %q (locked out: %v; read stays open to all)", resource, allowedRole, otherRoles)
	return nil
}

// RestrictResourceToRoles is RestrictResourceToRole generalized to a set of
// allowed roles rather than exactly one — used for resources like "reports"
// that several management-tier roles may access, but rank-and-file staff
// roles may not. Every action (including "read", unlike
// RestrictResourceToRole) is locked down for otherRoles: a report resource
// has no "read is fine for everyone" carve-out the way Branches does.
// Idempotent and safe to run on every startup.
func (r *Repository) RestrictResourceToRoles(resource string, allowedRoles []string, otherRoles []string) error {
	for _, role := range allowedRoles {
		for _, action := range CRUDActions {
			if err := r.upsertAllowed(role, resource, action, true); err != nil {
				return err
			}
		}
	}
	for _, role := range otherRoles {
		for _, action := range CRUDActions {
			if err := r.upsertAllowed(role, resource, action, false); err != nil {
				return err
			}
		}
	}
	log.Printf("authz: restricted resource %q to roles %v (locked out: %v)", resource, allowedRoles, otherRoles)
	return nil
}

// SetPermission overwrites a single (role, resource, action) row to
// Allowed=allowed — for one-off, narrower restrictions than
// RestrictResourceToRole's whole-resource lockout (e.g. "Cashier may read
// loans but not create them," leaving every other role/action on that
// resource untouched). Idempotent and safe to run on every startup.
func (r *Repository) SetPermission(role, resource, action string, allowed bool) error {
	return r.upsertAllowed(role, resource, action, allowed)
}

// upsertAllowed sets Allowed=allowed for (role, resource, action), creating
// the row if it doesn't exist yet or updating it in place if it does.
func (r *Repository) upsertAllowed(role, resource, action string, allowed bool) error {
	var existing Permission
	err := r.db.Where("role = ? AND resource = ? AND action = ?", role, resource, action).First(&existing).Error
	if err == nil {
		if existing.Allowed == allowed {
			return nil
		}
		existing.Allowed = allowed
		return r.db.Save(&existing).Error
	}
	if !errors.Is(err, gorm.ErrRecordNotFound) {
		return err
	}
	return r.db.Create(&Permission{Role: role, Resource: resource, Action: action, Allowed: allowed}).Error
}
