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
// status/lockerId.
type Filter struct {
	LoanID   uint
	BranchID uint
	Status   string
	LockerID uint
}

func (r *Repository) FindAll(f Filter) ([]Packet, error) {
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
	if f.BranchID != 0 {
		q = q.Joins("JOIN loans ON loans.id = packets.loan_id").Where("loans.branch_id = ?", f.BranchID)
	}
	var packets []Packet
	err := q.Order("packets.id desc").Find(&packets).Error
	return packets, err
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

// CountActivePackets implements locker.PacketCounter: how many packets are
// currently checked into the given locker.
func (r *Repository) CountActivePackets(lockerID uint) (int, error) {
	var count int64
	err := r.db.Model(&Packet{}).
		Where("current_locker_id = ? AND status = ?", lockerID, StatusLockerStored).
		Count(&count).Error
	return int(count), err
}
