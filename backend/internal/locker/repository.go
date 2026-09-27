package locker

import (
	"context"
	"errors"

	"gorm.io/gorm"

	"cloudhouse/backend/internal/platform"
)

// Repository provides GORM-backed persistence for Locker records.
type Repository struct {
	db platform.DB
}

func NewRepository(db platform.DB) *Repository {
	return &Repository{db: db}
}

func (r *Repository) Create(ctx context.Context, l *Locker) error {
	return r.db.WithContext(ctx).Create(l).Error
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
	// Status narrows to one occupancy bucket (StatusActive/StatusFull/
	// StatusInactive below); empty means every locker. The buckets are
	// mutually exclusive — see statusOccupiedSQL.
	Status string
	Limit  int
	Offset int
}

// Locker occupancy buckets accepted by LockerFilter.Status (GET /lockers
// ?status=). Inactive is IsActive=false regardless of contents; among
// active lockers, full means the Locker Stored packet count has reached
// Capacity and active means there is still room.
const (
	StatusActive   = "active"
	StatusFull     = "full"
	StatusInactive = "inactive"
)

// occupiedSQL counts the packets physically stored in a locker — the same
// predicate as packet.Repository.CountActivePackets (current_locker_id +
// status "Locker Stored"), written as a correlated subquery so the
// active/full buckets can be filtered and paginated in SQL. The literal is
// kept here rather than importing internal/packet, which would create an
// import cycle (see PacketCounter's doc comment).
const occupiedSQL = "(SELECT COUNT(*) FROM packets WHERE packets.current_locker_id = lockers.id AND packets.status = 'Locker Stored')"

// FindAll returns lockers, optionally scoped to a single branch — pass nil
// for an Administrator's unfiltered "all branches" view, or a non-nil
// pointer to confine results to that branch (see platform.GetBranchScope).
func (r *Repository) FindAll(ctx context.Context, branchID *uint) ([]Locker, error) {
	lockers, _, err := r.Find(ctx, LockerFilter{BranchID: branchID})
	return lockers, err
}

// Find is FindAll's filtered/paginated superset — kept as a separate method
// (rather than changing FindAll's signature) so every existing unfiltered
// caller stays untouched. Returns the TOTAL row count for f's filters
// (Limit/Offset ignored, 0 when f.Limit <= 0).
func (r *Repository) Find(ctx context.Context, f LockerFilter) ([]Locker, int64, error) {
	var lockers []Locker
	q := r.db.WithContext(ctx).Preload("Branch").Model(&Locker{}).Order("lockers.code asc")
	if f.BranchID != nil {
		q = q.Where("lockers.branch_id = ?", *f.BranchID)
	}
	if f.FilterBranchID != nil {
		q = q.Where("lockers.branch_id = ?", *f.FilterBranchID)
	}
	if f.Q != "" {
		q = q.Where("lockers.code ILIKE ?", "%"+f.Q+"%")
	}
	if f.ActiveOnly {
		q = q.Where("lockers.is_active = ?", true)
	}
	switch f.Status {
	case StatusInactive:
		q = q.Where("lockers.is_active = ?", false)
	case StatusFull:
		q = q.Where("lockers.is_active = ? AND "+occupiedSQL+" >= lockers.capacity", true)
	case StatusActive:
		q = q.Where("lockers.is_active = ? AND "+occupiedSQL+" < lockers.capacity", true)
	}
	var total int64
	if f.Limit > 0 {
		if err := q.Session(&gorm.Session{}).Count(&total).Error; err != nil {
			return nil, 0, err
		}
		q = q.Limit(f.Limit)
	}
	if f.Offset > 0 {
		q = q.Offset(f.Offset)
	}
	err := q.Find(&lockers).Error
	return lockers, total, err
}

func (r *Repository) FindByID(ctx context.Context, id uint) (*Locker, error) {
	var l Locker
	if err := r.db.WithContext(ctx).Preload("Branch").First(&l, id).Error; err != nil {
		return nil, err
	}
	return &l, nil
}

func (r *Repository) FindByCode(ctx context.Context, code string) (*Locker, error) {
	var l Locker
	if err := r.db.WithContext(ctx).Where("code = ?", code).First(&l).Error; err != nil {
		return nil, err
	}
	return &l, nil
}

func (r *Repository) Update(ctx context.Context, l *Locker) error {
	return r.db.WithContext(ctx).Save(l).Error
}

func (r *Repository) Delete(ctx context.Context, id uint) error {
	return r.db.WithContext(ctx).Delete(&Locker{}, id).Error
}

// Capacity satisfies packet.LockerCapacityProvider — kept as a narrow
// interface method (rather than handing packet.Service a *Repository
// directly) so the locker<->packet wiring stays symmetric with
// locker.Service's own PacketCounter dependency.
func (r *Repository) Capacity(ctx context.Context, lockerID uint) (capacity int, isActive bool, ok bool, err error) {
	l, err := r.FindByID(ctx, lockerID)
	if err != nil {
		if errors.Is(err, gorm.ErrRecordNotFound) {
			return 0, false, false, nil
		}
		return 0, false, false, err
	}
	return l.Capacity, l.IsActive, true, nil
}
