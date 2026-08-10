package loan

import "gorm.io/gorm"

// Repository provides GORM-backed persistence for Loan records (plus the
// small child-resource repositories below — Ornament, LoanApproval,
// LoanPayment, BankPledgeRecord — grouped in this one file the way
// internal/cash groups CashMovement/Expense repositories).
type Repository struct {
	db *gorm.DB
}

func NewRepository(db *gorm.DB) *Repository {
	return &Repository{db: db}
}

// preloadAll attaches every relation a full loan detail view needs.
func preloadAll(db *gorm.DB) *gorm.DB {
	return db.
		Preload("Branch").
		Preload("Customer").
		Preload("Scheme").
		Preload("Ornaments.PurityTest").
		Preload("Ornaments.Images").
		Preload("Approvals").
		Preload("Payments").
		Preload("Pledges")
}

func (r *Repository) Create(l *Loan) error {
	return r.db.Create(l).Error
}

func (r *Repository) Update(l *Loan) error {
	return r.db.Save(l).Error
}

func (r *Repository) FindByID(id uint) (*Loan, error) {
	var l Loan
	if err := preloadAll(r.db).First(&l, id).Error; err != nil {
		return nil, err
	}
	return &l, nil
}

// LoanFilter narrows FindAll's results; zero-value fields are ignored.
type LoanFilter struct {
	Status     string
	BranchID   uint
	CustomerID uint
	Query      string // matches LoanNumber (case-insensitive, partial)
}

func (r *Repository) FindAll(f LoanFilter) ([]Loan, error) {
	q := preloadAll(r.db).Model(&Loan{}).Order("id desc")
	if f.Status != "" {
		q = q.Where("status = ?", f.Status)
	}
	if f.BranchID != 0 {
		q = q.Where("branch_id = ?", f.BranchID)
	}
	if f.CustomerID != 0 {
		q = q.Where("customer_id = ?", f.CustomerID)
	}
	if f.Query != "" {
		q = q.Where("loan_number ILIKE ?", "%"+f.Query+"%")
	}
	var loans []Loan
	err := q.Find(&loans).Error
	return loans, err
}

// CountAll returns the total number of loans ever created, used to
// generate sequential LoanNumber values.
func (r *Repository) CountAll() (int64, error) {
	var count int64
	err := r.db.Model(&Loan{}).Count(&count).Error
	return count, err
}

// OrnamentRepository provides GORM-backed persistence for Ornament records.
type OrnamentRepository struct {
	db *gorm.DB
}

func NewOrnamentRepository(db *gorm.DB) *OrnamentRepository {
	return &OrnamentRepository{db: db}
}

func (r *OrnamentRepository) Create(o *Ornament) error {
	return r.db.Create(o).Error
}

func (r *OrnamentRepository) Update(o *Ornament) error {
	return r.db.Save(o).Error
}

func (r *OrnamentRepository) FindByID(id uint) (*Ornament, error) {
	var o Ornament
	if err := r.db.Preload("PurityTest").Preload("Images").First(&o, id).Error; err != nil {
		return nil, err
	}
	return &o, nil
}

func (r *OrnamentRepository) FindByLoanID(loanID uint) ([]Ornament, error) {
	var ornaments []Ornament
	err := r.db.Preload("PurityTest").Preload("Images").Where("loan_id = ?", loanID).Order("id asc").Find(&ornaments).Error
	return ornaments, err
}

func (r *OrnamentRepository) SavePurityTest(t *OrnamentPurityTest) error {
	return r.db.Save(t).Error
}

func (r *OrnamentRepository) AddImage(img *OrnamentImage) error {
	return r.db.Create(img).Error
}

// ApprovalRepository provides GORM-backed persistence for LoanApproval audit rows.
type ApprovalRepository struct {
	db *gorm.DB
}

func NewApprovalRepository(db *gorm.DB) *ApprovalRepository {
	return &ApprovalRepository{db: db}
}

func (r *ApprovalRepository) Create(a *LoanApproval) error {
	return r.db.Create(a).Error
}

func (r *ApprovalRepository) FindByLoanID(loanID uint) ([]LoanApproval, error) {
	var approvals []LoanApproval
	err := r.db.Where("loan_id = ?", loanID).Order("id asc").Find(&approvals).Error
	return approvals, err
}

// PaymentRepository provides GORM-backed persistence for LoanPayment audit rows.
type PaymentRepository struct {
	db *gorm.DB
}

func NewPaymentRepository(db *gorm.DB) *PaymentRepository {
	return &PaymentRepository{db: db}
}

func (r *PaymentRepository) Create(p *LoanPayment) error {
	return r.db.Create(p).Error
}

func (r *PaymentRepository) FindByLoanID(loanID uint) ([]LoanPayment, error) {
	var payments []LoanPayment
	err := r.db.Where("loan_id = ?", loanID).Order("paid_on desc, id desc").Find(&payments).Error
	return payments, err
}

// BankPledgeRepository provides GORM-backed persistence for BankPledgeRecord rows.
type BankPledgeRepository struct {
	db *gorm.DB
}

func NewBankPledgeRepository(db *gorm.DB) *BankPledgeRepository {
	return &BankPledgeRepository{db: db}
}

func (r *BankPledgeRepository) Create(p *BankPledgeRecord) error {
	return r.db.Create(p).Error
}

func (r *BankPledgeRepository) Update(p *BankPledgeRecord) error {
	return r.db.Save(p).Error
}

func (r *BankPledgeRepository) FindByID(id uint) (*BankPledgeRecord, error) {
	var p BankPledgeRecord
	if err := r.db.First(&p, id).Error; err != nil {
		return nil, err
	}
	return &p, nil
}

func (r *BankPledgeRepository) FindByLoanID(loanID uint) ([]BankPledgeRecord, error) {
	var pledges []BankPledgeRecord
	err := r.db.Where("loan_id = ?", loanID).Order("id desc").Find(&pledges).Error
	return pledges, err
}
