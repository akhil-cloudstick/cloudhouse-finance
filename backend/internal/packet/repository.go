package packet

import (
	"context"

	"gorm.io/gorm"

	"cloudhouse/backend/internal/platform"
)

// Repository provides GORM-backed persistence for Packet/PacketMovement
// records.
type Repository struct {
	db platform.DB
}

func NewRepository(db platform.DB) *Repository {
	return &Repository{db: db}
}

func preload(db *gorm.DB) *gorm.DB {
	// Loan.Ornaments is filtered to currently-pledged (released_at IS NULL)
	// — a packet view means "what does this packet/locker slot physically
	// hold right now", so an ornament already handed back on a prior
	// Partial Ornament Release must not still show up in the packet's own
	// ornament list.
	return db.Preload("Loan").Preload("Loan.Customer").Preload("Loan.Branch").
		Preload("Loan.Ornaments", "released_at IS NULL")
}

func (r *Repository) Create(ctx context.Context, p *Packet) error {
	return r.db.WithContext(ctx).Create(p).Error
}

// SumLoanOrnamentWeights totals a loan's CURRENTLY-PLEDGED ornaments'
// gross/net weight (released_at IS NULL) — used to seed a freshly-created
// packet's own TotalGrossWeight/TotalNetWeight. Filtered the same way
// recalculateTotals is on the loan side: at packet-creation time nothing is
// released yet, so the filter is a no-op then, but the same query is safe
// to reuse anywhere else "what does this loan's gold weigh right now" is
// needed.
func (r *Repository) SumLoanOrnamentWeights(ctx context.Context, loanID uint) (grossWeight, netWeight float64, err error) {
	var row struct {
		GrossWeight float64
		NetWeight   float64
	}
	err = r.db.WithContext(ctx).Table("ornaments").
		Select("COALESCE(SUM(gross_weight), 0) AS gross_weight, COALESCE(SUM(net_weight), 0) AS net_weight").
		Where("loan_id = ? AND released_at IS NULL", loanID).
		Scan(&row).Error
	return row.GrossWeight, row.NetWeight, err
}

func (r *Repository) FindByID(ctx context.Context, id uint) (*Packet, error) {
	var p Packet
	if err := preload(r.db.WithContext(ctx)).First(&p, id).Error; err != nil {
		return nil, err
	}
	return &p, nil
}

func (r *Repository) FindByCode(ctx context.Context, code string) (*Packet, error) {
	var p Packet
	if err := preload(r.db.WithContext(ctx)).Where("code = ?", code).First(&p).Error; err != nil {
		return nil, err
	}
	return &p, nil
}

// FindActiveByLoanID returns the most recent non-Released packet for a
// loan — the packet the loan's bank-pledge actions should move.
func (r *Repository) FindActiveByLoanID(ctx context.Context, loanID uint) (*Packet, error) {
	var p Packet
	err := preload(r.db.WithContext(ctx)).
		Where("loan_id = ? AND status <> ?", loanID, StatusReleased).
		Order("id desc").First(&p).Error
	if err != nil {
		return nil, err
	}
	return &p, nil
}

// Filter narrows GET /packets by loanId/branchId (via the joined loan)/
// status/lockerId/q.
type Filter struct {
	LoanID   uint
	BranchID *uint
	Status   string
	LockerID uint
	// StatusIn / FilterBranchIDs / CustomerIDs match any of the listed
	// values — the Packets page's multi-select filters. FilterBranchIDs is
	// ANDed on top of BranchID (the caller's own branch scope).
	StatusIn        []string
	FilterBranchIDs []uint
	CustomerIDs     []uint
	// Q searches the packet's own code, its loan's LoanNumber, the locker it sits in, and its
	// loan's customer's name/code — the same fields the Packets screen's search
	// box promises ("packet code, loan number, or customer name"). Case-
	// insensitive substring match.
	Q string

	// Limit/Offset paginate the result set; Limit <= 0 means "no limit"
	// (matches LoanFilter's convention).
	Limit  int
	Offset int
}

// FindAll returns matching packets plus the TOTAL row count for f's filters
// (Limit/Offset ignored, 0 when f.Limit <= 0).
func (r *Repository) FindAll(ctx context.Context, f Filter) ([]Packet, int64, error) {
	q := preload(r.db.WithContext(ctx)).Model(&Packet{})
	if f.LoanID != 0 {
		q = q.Where("packets.loan_id = ?", f.LoanID)
	}
	if len(f.StatusIn) > 0 {
		q = q.Where("packets.status IN ?", f.StatusIn)
	} else if f.Status != "" {
		q = q.Where("packets.status = ?", f.Status)
	}
	if f.LockerID != 0 {
		q = q.Where("packets.current_locker_id = ?", f.LockerID)
	}
	// Q needs the same loans/customers join branch-scoping uses — joined
	// unconditionally (not only when BranchID is set) since either filter
	// may need it on its own.
	if f.BranchID != nil || f.Q != "" || len(f.FilterBranchIDs) > 0 || len(f.CustomerIDs) > 0 {
		q = q.Joins("JOIN loans ON loans.id = packets.loan_id").
			Joins("JOIN customers ON customers.id = loans.customer_id")
	}
	if f.BranchID != nil {
		q = q.Where("loans.branch_id = ?", *f.BranchID)
	}
	if len(f.FilterBranchIDs) > 0 {
		q = q.Where("loans.branch_id IN ?", f.FilterBranchIDs)
	}
	if len(f.CustomerIDs) > 0 {
		q = q.Where("loans.customer_id IN ?", f.CustomerIDs)
	}
	if f.Q != "" {
		// LEFT JOIN: a packet that isn't checked into a locker (Bank
		// Pledged, Ready For Release, ...) has no current_locker_id and must
		// still match on its own code/loan/customer.
		needle := "%" + f.Q + "%"
		q = q.Joins("LEFT JOIN lockers ON lockers.id = packets.current_locker_id").
			Where("packets.code ILIKE ? OR loans.loan_number ILIKE ? OR customers.name ILIKE ? OR customers.code ILIKE ? OR lockers.code ILIKE ?",
				needle, needle, needle, needle, needle)
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
	var packets []Packet
	err := q.Order("packets.id desc").Find(&packets).Error
	return packets, total, err
}

func (r *Repository) Update(ctx context.Context, p *Packet) error {
	return r.db.WithContext(ctx).Save(p).Error
}

func (r *Repository) CreateMovement(ctx context.Context, m *PacketMovement) error {
	return r.db.WithContext(ctx).Create(m).Error
}

func (r *Repository) FindMovements(ctx context.Context, packetID uint) ([]PacketMovement, error) {
	var ms []PacketMovement
	err := r.db.WithContext(ctx).Where("packet_id = ?", packetID).Order("created_at asc, id asc").Find(&ms).Error
	return ms, err
}

func (r *Repository) CountAll(ctx context.Context) (int64, error) {
	var count int64
	err := r.db.WithContext(ctx).Model(&Packet{}).Count(&count).Error
	return count, err
}

func (r *Repository) MaxCodeSuffix(ctx context.Context) (int, error) {
	var maxSuffix int
	err := r.db.WithContext(ctx).Model(&Packet{}).Unscoped().
		Select("COALESCE(MAX(CAST(SUBSTRING(code FROM 'PKT-(\\d+)') AS INTEGER)), 0)").
		Scan(&maxSuffix).Error
	return maxSuffix, err
}

// CountActivePackets implements locker.PacketCounter: how many packets are
// currently checked into the given locker.
func (r *Repository) CountActivePackets(ctx context.Context, lockerID uint) (int, error) {
	var count int64
	err := r.db.WithContext(ctx).Model(&Packet{}).
		Where("current_locker_id = ? AND status = ?", lockerID, StatusLockerStored).
		Count(&count).Error
	return int(count), err
}
