package loan

import (
	"time"

	"gorm.io/gorm"
)

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

// FindByLoanNumber looks up a loan by its exact (unique) LoanNumber — a
// single atomic query, unlike the frontend's previous approach of listing
// with a partial `q` filter and finding the exact match client-side, which
// needed two round trips and could race against other in-flight list
// requests. Used by GET /loans/by-number/:loanNumber, mirroring
// packet.Repository.FindByCode's pattern.
func (r *Repository) FindByLoanNumber(loanNumber string) (*Loan, error) {
	var l Loan
	if err := preloadAll(r.db).Where("loan_number = ?", loanNumber).First(&l).Error; err != nil {
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

// FindOpenForCalendar returns every not-yet-closed loan (Active/Due
// Soon/Overdue), preloading only Customer's id/name — used by
// internal/reminder's calendar aggregation to derive Loan Due/Overdue/
// interest-anniversary events without paying for the full preloadAll graph
// (ornaments, images, payments, etc.) that a real loan detail view needs.
func (r *Repository) FindOpenForCalendar() ([]Loan, error) {
	var loans []Loan
	err := r.db.
		Select("id", "loan_number", "customer_id", "branch_id", "opened_date", "due_date", "status").
		Preload("Customer", func(db *gorm.DB) *gorm.DB {
			return db.Select("id", "name", "code")
		}).
		Where("status IN ?", []string{StatusActive, StatusDueSoon, StatusOverdue}).
		Find(&loans).Error
	return loans, err
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

// SumInterestCollected totals the interest + penal-interest portions of
// every payment recorded with PaidOn within [from, to] (inclusive) —
// backs the Dashboard's "Interest Collected" KPI (see
// Service.GetInterestCollected).
func (r *PaymentRepository) SumInterestCollected(from, to time.Time) (float64, error) {
	var total float64
	err := r.db.Model(&LoanPayment{}).
		Where("paid_on >= ? AND paid_on <= ?", from, to).
		Select("COALESCE(SUM(interest_applied + penal_interest_applied), 0)").
		Row().Scan(&total)
	return total, err
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

// LoanRequestRepository provides GORM-backed persistence for LoanRequest rows.
type LoanRequestRepository struct {
	db *gorm.DB
}

func NewLoanRequestRepository(db *gorm.DB) *LoanRequestRepository {
	return &LoanRequestRepository{db: db}
}

func (r *LoanRequestRepository) Create(req *LoanRequest) error {
	return r.db.Create(req).Error
}

func (r *LoanRequestRepository) Update(req *LoanRequest) error {
	return r.db.Save(req).Error
}

func (r *LoanRequestRepository) FindByID(id uint) (*LoanRequest, error) {
	var req LoanRequest
	if err := r.db.Preload("Loan.Customer").First(&req, id).Error; err != nil {
		return nil, err
	}
	return &req, nil
}

// LoanRequestFilter narrows FindAll's results; zero-value fields are ignored.
type LoanRequestFilter struct {
	Status string
	LoanID uint
}

func (r *LoanRequestRepository) FindAll(f LoanRequestFilter) ([]LoanRequest, error) {
	q := r.db.Preload("Loan.Customer").Model(&LoanRequest{}).Order("id desc")
	if f.Status != "" {
		q = q.Where("status = ?", f.Status)
	}
	if f.LoanID != 0 {
		q = q.Where("loan_id = ?", f.LoanID)
	}
	var reqs []LoanRequest
	err := q.Find(&reqs).Error
	return reqs, err
}

// FindApprovedReleaseByLoanID finds the (most recent) Approved Release
// request for a loan — CompleteRelease uses this to confirm a release was
// actually approved before letting the gold go out.
func (r *LoanRequestRepository) FindApprovedReleaseByLoanID(loanID uint) (*LoanRequest, error) {
	var req LoanRequest
	err := r.db.Preload("Loan.Customer").
		Where("loan_id = ? AND type = ? AND status = ?", loanID, RequestTypeRelease, RequestStatusApproved).
		Order("id desc").First(&req).Error
	if err != nil {
		return nil, err
	}
	return &req, nil
}

// RequestApprovalRepository provides GORM-backed persistence for
// RequestApproval audit rows — mirrors ApprovalRepository.
type RequestApprovalRepository struct {
	db *gorm.DB
}

func NewRequestApprovalRepository(db *gorm.DB) *RequestApprovalRepository {
	return &RequestApprovalRepository{db: db}
}

func (r *RequestApprovalRepository) Create(a *RequestApproval) error {
	return r.db.Create(a).Error
}

func (r *RequestApprovalRepository) FindByRequestID(requestID uint) ([]RequestApproval, error) {
	var approvals []RequestApproval
	err := r.db.Where("request_id = ?", requestID).Order("id asc").Find(&approvals).Error
	return approvals, err
}

// AuctionRepository provides GORM-backed persistence for AuctionRecord rows
// (plus their nested Notices).
type AuctionRepository struct {
	db *gorm.DB
}

func NewAuctionRepository(db *gorm.DB) *AuctionRepository {
	return &AuctionRepository{db: db}
}

func (r *AuctionRepository) Create(a *AuctionRecord) error {
	return r.db.Create(a).Error
}

func (r *AuctionRepository) Update(a *AuctionRecord) error {
	return r.db.Save(a).Error
}

func (r *AuctionRepository) FindByLoanID(loanID uint) (*AuctionRecord, error) {
	var a AuctionRecord
	if err := r.db.Preload("Notices", func(db *gorm.DB) *gorm.DB { return db.Order("issued_at asc") }).
		Where("loan_id = ?", loanID).First(&a).Error; err != nil {
		return nil, err
	}
	return &a, nil
}

func (r *AuctionRepository) CreateNotice(n *AuctionNotice) error {
	return r.db.Create(n).Error
}
