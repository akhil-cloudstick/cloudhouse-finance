package packet

import "gorm.io/gorm"

// Repository provides GORM-backed persistence for Packet/PacketMovement
// records.
type Repository struct {
	db *gorm.DB
}

func NewRepository(db *gorm.DB) *Repository {
	return &Repository{db: db}
}

func preload(db *gorm.DB) *gorm.DB {
	return db.Preload("Loan").Preload("Loan.Customer").Preload("Loan.Branch").Preload("Loan.Ornaments")
}

func (r *Repository) Create(p *Packet) error {
	return r.db.Create(p).Error
}

func (r *Repository) FindByID(id uint) (*Packet, error) {
	var p Packet
	if err := preload(r.db).First(&p, id).Error; err != nil {
		return nil, err
	}
	return &p, nil
}

func (r *Repository) FindByCode(code string) (*Packet, error) {
	var p Packet
	if err := preload(r.db).Where("code = ?", code).First(&p).Error; err != nil {
		return nil, err
	}
	return &p, nil
}

// FindActiveByLoanID returns the most recent non-Released packet for a
// loan — the packet the loan's bank-pledge actions should move.
func (r *Repository) FindActiveByLoanID(loanID uint) (*Packet, error) {
	var p Packet
	err := preload(r.db).
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
	// Q searches the packet's own code, its loan's LoanNumber, and its
	// loan's customer's name — the same fields the Packets screen's search
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
func (r *Repository) FindAll(f Filter) ([]Packet, int64, error) {
	q := preload(r.db).Model(&Packet{})
	if f.LoanID != 0 {
		q = q.Where("packets.loan_id = ?", f.LoanID)
	}
	if f.Status != "" {
		q = q.Where("packets.status = ?", f.Status)
	}
	if f.LockerID != 0 {
		q = q.Where("packets.current_locker_id = ?", f.LockerID)
	}
	// Q needs the same loans/customers join branch-scoping uses — joined
	// unconditionally (not only when BranchID is set) since either filter
	// may need it on its own.
	if f.BranchID != nil || f.Q != "" {
		q = q.Joins("JOIN loans ON loans.id = packets.loan_id").
			Joins("JOIN customers ON customers.id = loans.customer_id")
	}
	if f.BranchID != nil {
		q = q.Where("loans.branch_id = ?", *f.BranchID)
	}
	if f.Q != "" {
		needle := "%" + f.Q + "%"
		q = q.Where("packets.code ILIKE ? OR loans.loan_number ILIKE ? OR customers.name ILIKE ?", needle, needle, needle)
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

func (r *Repository) Update(p *Packet) error {
	return r.db.Save(p).Error
}

func (r *Repository) CreateMovement(m *PacketMovement) error {
	return r.db.Create(m).Error
}

func (r *Repository) FindMovements(packetID uint) ([]PacketMovement, error) {
	var ms []PacketMovement
	err := r.db.Where("packet_id = ?", packetID).Order("created_at asc, id asc").Find(&ms).Error
	return ms, err
}

func (r *Repository) CountAll() (int64, error) {
	var count int64
	err := r.db.Model(&Packet{}).Count(&count).Error
	return count, err
}

func (r *Repository) MaxCodeSuffix() (int, error) {
	var maxSuffix int
	err := r.db.Model(&Packet{}).Unscoped().
		Select("COALESCE(MAX(CAST(SUBSTRING(code FROM 'PKT-(\\d+)') AS INTEGER)), 0)").
		Scan(&maxSuffix).Error
	return maxSuffix, err
}

// CountActivePackets implements locker.PacketCounter: how many packets are
// currently checked into the given locker.
func (r *Repository) CountActivePackets(lockerID uint) (int, error) {
	var count int64
	err := r.db.Model(&Packet{}).
		Where("current_locker_id = ? AND status = ?", lockerID, StatusLockerStored).
		Count(&count).Error
	return int(count), err
}
