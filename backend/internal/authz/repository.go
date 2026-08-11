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
