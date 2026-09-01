package locker

import (
	"errors"

	"gorm.io/gorm"
)

// Repository provides GORM-backed persistence for Locker records.
type Repository struct {
	db *gorm.DB
}

func NewRepository(db *gorm.DB) *Repository {
	return &Repository{db: db}
}

func (r *Repository) Create(l *Locker) error {
	return r.db.Create(l).Error
}

// LockerFilter narrows FindAll — see each field's own comment. Limit <= 0
// means "no limit" (matches LoanFilter's convention).
type LockerFilter struct {
	BranchID *uint
	// FilterBranchID additionally confines results to one specific branch —
	// distinct from BranchID (the caller's own branch-scope restriction):
	// an Administrator has no BranchID scope but may still need to pick a
	// locker for one particular packet's branch (see the packet Check-In
	// picker), so this is ANDed on top of BranchID rather than replacing it.
	FilterBranchID *uint
	// Q searches the locker's own code, case-insensitive substring match.
	Q string
	// ActiveOnly excludes inactive lockers — the packet Check-In picker
	// never offers one you can't actually check gold into.
	ActiveOnly bool
	Limit      int
	Offset     int
}

// FindAll returns lockers, optionally scoped to a single branch — pass nil
// for an Administrator's unfiltered "all branches" view, or a non-nil
// pointer to confine results to that branch (see platform.GetBranchScope).
func (r *Repository) FindAll(branchID *uint) ([]Locker, error) {
	return r.Find(LockerFilter{BranchID: branchID})
}

// Find is FindAll's filtered/paginated superset — kept as a separate method
// (rather than changing FindAll's signature) so every existing unfiltered
// caller stays untouched.
func (r *Repository) Find(f LockerFilter) ([]Locker, error) {
	var lockers []Locker
	q := r.db.Preload("Branch").Model(&Locker{}).Order("code asc")
	if f.BranchID != nil {
		q = q.Where("branch_id = ?", *f.BranchID)
	}
	if f.FilterBranchID != nil {
		q = q.Where("branch_id = ?", *f.FilterBranchID)
	}
	if f.Q != "" {
		q = q.Where("code ILIKE ?", "%"+f.Q+"%")
	}
	if f.ActiveOnly {
		q = q.Where("is_active = ?", true)
	}
	if f.Limit > 0 {
		q = q.Limit(f.Limit)
	}
	if f.Offset > 0 {
		q = q.Offset(f.Offset)
	}
	err := q.Find(&lockers).Error
	return lockers, err
}

func (r *Repository) FindByID(id uint) (*Locker, error) {
	var l Locker
	if err := r.db.Preload("Branch").First(&l, id).Error; err != nil {
		return nil, err
	}
	return &l, nil
}

func (r *Repository) FindByCode(code string) (*Locker, error) {
	var l Locker
	if err := r.db.Where("code = ?", code).First(&l).Error; err != nil {
		return nil, err
	}
	return &l, nil
}

func (r *Repository) Update(l *Locker) error {
	return r.db.Save(l).Error
}

func (r *Repository) Delete(id uint) error {
	return r.db.Delete(&Locker{}, id).Error
}

// Capacity satisfies packet.LockerCapacityProvider — kept as a narrow
// interface method (rather than handing packet.Service a *Repository
// directly) so the locker<->packet wiring stays symmetric with
// locker.Service's own PacketCounter dependency.
func (r *Repository) Capacity(lockerID uint) (capacity int, isActive bool, ok bool, err error) {
	l, err := r.FindByID(lockerID)
	if err != nil {
		if errors.Is(err, gorm.ErrRecordNotFound) {
			return 0, false, false, nil
		}
		return 0, false, false, err
	}
	return l.Capacity, l.IsActive, true, nil
}
