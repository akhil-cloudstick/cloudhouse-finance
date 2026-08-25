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

// FindAll returns lockers, optionally scoped to a single branch — pass nil
// for an Administrator's unfiltered "all branches" view, or a non-nil
// pointer to confine results to that branch (see platform.GetBranchScope).
func (r *Repository) FindAll(branchID *uint) ([]Locker, error) {
	var lockers []Locker
	q := r.db.Preload("Branch").Order("code asc")
	if branchID != nil {
		q = q.Where("branch_id = ?", *branchID)
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
