package loan

import (
	"time"

	"gorm.io/gorm"
	"gorm.io/gorm/clause"
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
	StatusIn   []string // matches any of these statuses; takes priority over Status when non-empty
	BranchID   uint
	CustomerID uint
	Query      string // matches LoanNumber (case-insensitive, partial)

	// BranchScope is the caller's branch-scoping restriction (see
	// platform.GetBranchScope) — nil for Administrator (no restriction),
	// else limits results to that one branch regardless of BranchID above.
	BranchScope *uint

	// OpenedFrom/OpenedTo bound OpenedDate (the date the loan was
	// disbursed), both optional and inclusive. OpenedTo is compared against
	// the end of that calendar day so a from==to filter still matches loans
	// opened during it.
	OpenedFrom *time.Time
	OpenedTo   *time.Time

	// ExcludeBankPledged drops loans whose gold is currently sitting with a
	// bank (BankPledgeStatusPledged) — those cannot be re-pledged again, so
	// the bank re-pledge loan picker asks for the eligible set server-side
	// rather than fetching every loan and filtering in the browser.
	ExcludeBankPledged bool

	// BankPledgeStatus, when set, matches Loan.BankPledgeStatus exactly —
	// backs the Bank Re-Pledge page's "Active" tab (BankPledgeStatusPledged)
	// so it can paginate server-side instead of filtering LoansProvider's
	// full list in the browser.
	BankPledgeStatus string

	// Limit/Offset paginate the result set; Limit <= 0 means "no limit"
	// (the full listing every existing caller relies on). Ordering is by
	// id desc, so paging is stable for a fixed filter.
	Limit  int
	Offset int
}

// startOfDay drops the clock time so date-only filters compare whole days
// regardless of whether the caller sent YYYY-MM-DD or a full timestamp.
func startOfDay(t time.Time) time.Time {
	return time.Date(t.Year(), t.Month(), t.Day(), 0, 0, 0, 0, t.Location())
}

func (r *Repository) FindAll(f LoanFilter) ([]Loan, error) {
	q := preloadAll(r.db).Model(&Loan{}).Order("id desc")
	if len(f.StatusIn) > 0 {
		q = q.Where("status IN ?", f.StatusIn)
	} else if f.Status != "" {
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
	if f.BranchScope != nil {
		q = q.Where("branch_id = ?", *f.BranchScope)
	}
	if f.OpenedFrom != nil {
		q = q.Where("opened_date >= ?", startOfDay(*f.OpenedFrom))
	}
	if f.OpenedTo != nil {
		q = q.Where("opened_date < ?", startOfDay(*f.OpenedTo).AddDate(0, 0, 1))
	}
	if f.ExcludeBankPledged {
		q = q.Where("bank_pledge_status <> ?", BankPledgeStatusPledged)
	}
	if f.BankPledgeStatus != "" {
		q = q.Where("bank_pledge_status = ?", f.BankPledgeStatus)
	}
	if f.Limit > 0 {
		q = q.Limit(f.Limit)
	}
	if f.Offset > 0 {
		q = q.Offset(f.Offset)
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

// CustomerOrnamentRow is one pledged ornament plus its parent loan's
// LoanNumber — the customer 360 view's Pledged Ornaments sub-table spans
// every loan a customer has, so each row needs to carry enough of its
// parent loan's identity to link back to it without a second lookup.
type CustomerOrnamentRow struct {
	Ornament
	LoanNumber string `json:"loanNumber"`
}

// FindByCustomerID lists every ornament pledged across every loan belonging
// to customerID, newest-loan-first — backs the customer 360 view's Pledged
// Ornaments sub-table (GET /customers/:id/ornaments). from/to bound the
// PARENT LOAN's OpenedDate (not any date of the ornament's own, which has
// none) so the result stays consistent with what GetCustomer360 would show
// for the same window — same semantics as LoanFilter.OpenedFrom/OpenedTo.
func (r *OrnamentRepository) FindByCustomerID(customerID uint, from, to *time.Time, limit, offset int) ([]CustomerOrnamentRow, error) {
	var rows []CustomerOrnamentRow
	q := r.db.Model(&Ornament{}).
		Select("ornaments.*, loans.loan_number AS loan_number").
		Joins("JOIN loans ON loans.id = ornaments.loan_id").
		Where("loans.customer_id = ?", customerID)
	if from != nil {
		q = q.Where("loans.opened_date >= ?", startOfDay(*from))
	}
	if to != nil {
		q = q.Where("loans.opened_date < ?", startOfDay(*to).AddDate(0, 0, 1))
	}
	q = q.Order("loans.id desc, ornaments.id asc")
	if limit > 0 {
		q = q.Limit(limit).Offset(offset)
	}
	err := q.Find(&rows).Error
	return rows, err
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

// FindByID looks up a single payment by its primary key — used by the
// customer-app payment-receipt endpoint, which then checks the payment's
// parent loan belongs to the requesting customer before generating anything.
func (r *PaymentRepository) FindByID(id uint) (*LoanPayment, error) {
	var p LoanPayment
	if err := r.db.First(&p, id).Error; err != nil {
		return nil, err
	}
	return &p, nil
}

// FindByCustomerID returns every payment across every loan belonging to
// customerID, newest first, joining loan_payments to loans to scope by
// loans.customer_id — backs GET /customer/payments (the Payments tab's
// global history), paginated the same way FindAll's list endpoints are
// (limit/offset, caller decides "hasMore" from an oversized limit).
func (r *PaymentRepository) FindByCustomerID(customerID uint, limit, offset int) ([]LoanPayment, error) {
	var payments []LoanPayment
	q := r.db.Model(&LoanPayment{}).
		Select("loan_payments.*").
		Joins("JOIN loans ON loans.id = loan_payments.loan_id").
		Where("loans.customer_id = ?", customerID).
		Order("loan_payments.paid_on desc, loan_payments.id desc")
	if limit > 0 {
		q = q.Limit(limit).Offset(offset)
	}
	err := q.Find(&payments).Error
	return payments, err
}

// CustomerPaymentRow is one LoanPayment plus its parent loan's LoanNumber —
// same rationale as CustomerOrnamentRow.
type CustomerPaymentRow struct {
	LoanPayment
	LoanNumber string `json:"loanNumber"`
}

// FindByCustomerIDForProfile lists every payment across every loan belonging
// to customerID, newest first — backs the customer 360 view's Payment
// History sub-table (GET /customers/:id/payments). from/to bound the
// PARENT LOAN's OpenedDate, matching GetCustomer360's window semantics —
// deliberately distinct from FindByCustomerID above, which the customer
// mobile app uses with no date filter at all.
func (r *PaymentRepository) FindByCustomerIDForProfile(customerID uint, from, to *time.Time, limit, offset int) ([]CustomerPaymentRow, error) {
	var rows []CustomerPaymentRow
	q := r.db.Model(&LoanPayment{}).
		Select("loan_payments.*, loans.loan_number AS loan_number").
		Joins("JOIN loans ON loans.id = loan_payments.loan_id").
		Where("loans.customer_id = ?", customerID)
	if from != nil {
		q = q.Where("loans.opened_date >= ?", startOfDay(*from))
	}
	if to != nil {
		q = q.Where("loans.opened_date < ?", startOfDay(*to).AddDate(0, 0, 1))
	}
	q = q.Order("loan_payments.paid_on desc, loan_payments.id desc")
	if limit > 0 {
		q = q.Limit(limit).Offset(offset)
	}
	err := q.Find(&rows).Error
	return rows, err
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

// FindHistoryByLoanID returns every re-pledge ever recorded against a loan —
// including released and voided ones — with each record's audit trail
// attached. The plain FindByLoanID above is kept for the existing callers that
// only want the raw rows.
func (r *BankPledgeRepository) FindHistoryByLoanID(loanID uint) ([]BankPledgeRecord, error) {
	var pledges []BankPledgeRecord
	err := r.db.
		Preload("Events", func(d *gorm.DB) *gorm.DB { return d.Order("created_at asc, id asc") }).
		Where("loan_id = ?", loanID).
		Order("id desc").
		Find(&pledges).Error
	return pledges, err
}

// FindAllHistory lists re-pledge records across all loans, newest first —
// backs the Bank Re-Pledge screen's History tab, which previously had no way
// to see anything but currently-pledged gold. branchID scopes to the caller's
// branch (nil for Administrator), applied via a JOIN on loans the same way
// LoanRequestRepository.FindAll does it.
func (r *BankPledgeRepository) FindAllHistory(branchID *uint, limit, offset int) ([]BankPledgeRecord, error) {
	var pledges []BankPledgeRecord
	q := r.db.Model(&BankPledgeRecord{}).
		Preload("Events", func(d *gorm.DB) *gorm.DB { return d.Order("created_at asc, id asc") })
	if branchID != nil {
		q = q.Joins("JOIN loans ON loans.id = bank_pledge_records.loan_id").
			Where("loans.branch_id = ?", *branchID)
	}
	q = q.Order("bank_pledge_records.id desc")
	if limit > 0 {
		q = q.Limit(limit).Offset(offset)
	}
	err := q.Find(&pledges).Error
	return pledges, err
}

// CustomerBankPledgeRow is one BankPledgeRecord plus its parent loan's
// LoanNumber — same rationale as CustomerOrnamentRow.
type CustomerBankPledgeRow struct {
	BankPledgeRecord
	LoanNumber string `json:"loanNumber"`
}

// FindAllByCustomerID lists every re-pledge record across every loan
// belonging to customerID, newest first — backs the customer 360 view's
// Bank Pledges sub-table (GET /customers/:id/bank-pledges). from/to bound
// the PARENT LOAN's OpenedDate, matching GetCustomer360's window semantics.
func (r *BankPledgeRepository) FindAllByCustomerID(customerID uint, from, to *time.Time, limit, offset int) ([]CustomerBankPledgeRow, error) {
	var rows []CustomerBankPledgeRow
	q := r.db.Model(&BankPledgeRecord{}).
		Select("bank_pledge_records.*, loans.loan_number AS loan_number").
		Joins("JOIN loans ON loans.id = bank_pledge_records.loan_id").
		Where("loans.customer_id = ?", customerID)
	if from != nil {
		q = q.Where("loans.opened_date >= ?", startOfDay(*from))
	}
	if to != nil {
		q = q.Where("loans.opened_date < ?", startOfDay(*to).AddDate(0, 0, 1))
	}
	q = q.Order("bank_pledge_records.id desc")
	if limit > 0 {
		q = q.Limit(limit).Offset(offset)
	}
	err := q.Find(&rows).Error
	return rows, err
}

// CreateEvent appends one entry to a re-pledge record's audit trail.
func (r *BankPledgeRepository) CreateEvent(e *BankPledgeEvent) error {
	return r.db.Create(e).Error
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

	// BranchID is the caller's branch-scoping restriction (see
	// platform.GetBranchScope) — nil for Administrator (no restriction),
	// else limits results to requests whose underlying loan belongs to that
	// branch, applied via a JOIN against loans.
	BranchID *uint

	// Limit/Offset paginate the result set; Limit <= 0 means "no limit"
	// (matches LoanFilter's convention).
	Limit  int
	Offset int
}

func (r *LoanRequestRepository) FindAll(f LoanRequestFilter) ([]LoanRequest, error) {
	q := r.db.Preload("Loan.Customer").Model(&LoanRequest{}).Order("id desc")
	if f.BranchID != nil {
		q = q.Joins("JOIN loans ON loans.id = loan_requests.loan_id").Where("loans.branch_id = ?", *f.BranchID)
	}
	if f.Status != "" {
		q = q.Where("loan_requests.status = ?", f.Status)
	}
	if f.LoanID != 0 {
		q = q.Where("loan_requests.loan_id = ?", f.LoanID)
	}
	if f.Limit > 0 {
		q = q.Limit(f.Limit)
	}
	if f.Offset > 0 {
		q = q.Offset(f.Offset)
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

// preloadAuctionDetail attaches the child collections an auction case's
// detail view needs, each ordered oldest-first so the UI renders them as a
// chronological timeline.
func preloadAuctionDetail(db *gorm.DB) *gorm.DB {
	return db.
		Preload("Notices", func(d *gorm.DB) *gorm.DB { return d.Order("issued_at asc") }).
		Preload("Events", func(d *gorm.DB) *gorm.DB { return d.Order("created_at asc, id asc") }).
		Preload("DecisionRequests", func(d *gorm.DB) *gorm.DB { return d.Order("created_at asc, id asc") })
}

// FindActiveByLoanID returns the loan's auction case that is still live —
// i.e. not Settled/Withdrawn. A loan may carry several concluded cases from
// earlier attempts, so "the" auction for a loan is always the active one;
// concluded ones are reached through FindHistoryByLoanID instead.
//
// Returns gorm.ErrRecordNotFound when the loan has no live case, which
// callers translate to ErrAuctionNotFound (or, for MarkAuctionEligible, treat
// as "clear to start a new one").
func (r *AuctionRepository) FindActiveByLoanID(loanID uint) (*AuctionRecord, error) {
	var a AuctionRecord
	if err := preloadAuctionDetail(r.db).
		Where("loan_id = ? AND stage NOT IN (?, ?)", loanID, AuctionStageSettled, AuctionStageWithdrawn).
		Order("created_at desc, id desc").
		First(&a).Error; err != nil {
		return nil, err
	}
	return &a, nil
}

// FindActiveByLoanIDForUpdate is FindActiveByLoanID with a row lock, for use
// inside a transaction that will write the record back. Without the lock, a
// payment arriving concurrently with an auction action can read the same
// starting state and clobber the other's write — the dangerous case being a
// payment's "freeze this auction" update getting lost while a sale is recorded
// against gold that was just paid for.
//
// Child collections are deliberately NOT preloaded: FOR UPDATE must apply to
// a single-table query, and callers in a transaction only need the record's
// own columns.
func (r *AuctionRepository) FindActiveByLoanIDForUpdate(tx *gorm.DB, loanID uint) (*AuctionRecord, error) {
	var a AuctionRecord
	if err := tx.Clauses(clause.Locking{Strength: "UPDATE"}).
		Where("loan_id = ? AND stage NOT IN (?, ?)", loanID, AuctionStageSettled, AuctionStageWithdrawn).
		Order("created_at desc, id desc").
		First(&a).Error; err != nil {
		return nil, err
	}
	return &a, nil
}

// FindHistoryByLoanID returns every auction case ever opened against a loan,
// newest first — the per-loan auction history.
func (r *AuctionRepository) FindHistoryByLoanID(loanID uint) ([]AuctionRecord, error) {
	var records []AuctionRecord
	err := preloadAuctionDetail(r.db).
		Where("loan_id = ?", loanID).
		Order("created_at desc, id desc").
		Find(&records).Error
	return records, err
}

// FindAllConcluded lists concluded auction cases (Settled or Withdrawn)
// across all loans — backs the Auctions screen's History tab. branchID is the
// caller's branch-scoping restriction (nil for Administrator), applied via a
// JOIN on loans the same way LoanRequestRepository.FindAll does it.
//
// hasSale narrows to cases that did (true) or did not (false) actually sell
// gold — the History tab's "Auctions Conducted" vs "Closed Without Auction"
// split, done here so each sub-table's own limit/offset paginates only its
// own rows instead of counting against a mixed set. nil means no filter.
// limit/offset apply only when limit > 0, matching LoanFilter's convention.
func (r *AuctionRepository) FindAllConcluded(branchID *uint, hasSale *bool, limit, offset int) ([]AuctionRecord, error) {
	var records []AuctionRecord
	q := preloadAuctionDetail(r.db).Model(&AuctionRecord{}).
		Where("auction_records.stage IN (?, ?)", AuctionStageSettled, AuctionStageWithdrawn)
	if branchID != nil {
		q = q.Joins("JOIN loans ON loans.id = auction_records.loan_id").
			Where("loans.branch_id = ?", *branchID)
	}
	if hasSale != nil {
		if *hasSale {
			q = q.Where("auction_records.sale_amount > 0")
		} else {
			q = q.Where("auction_records.sale_amount <= 0")
		}
	}
	q = q.Order("auction_records.updated_at desc, auction_records.id desc")
	if limit > 0 {
		q = q.Limit(limit).Offset(offset)
	}
	err := q.Find(&records).Error
	return records, err
}

// CustomerAuctionRow is one AuctionRecord plus its parent loan's LoanNumber
// — same rationale as CustomerOrnamentRow.
type CustomerAuctionRow struct {
	AuctionRecord
	LoanNumber string `json:"loanNumber"`
}

// FindAllByCustomerID lists every auction case ever opened across every loan
// belonging to customerID, newest first — backs the customer 360 view's
// Auction History sub-table (GET /customers/:id/auction-history). Unlike
// FindAllConcluded this includes cases still in progress, matching
// GetCustomer360's AuctionHistory (which appends every case from
// FindHistoryByLoanID, concluded or not). from/to bound the PARENT LOAN's
// OpenedDate, matching GetCustomer360's window semantics.
func (r *AuctionRepository) FindAllByCustomerID(customerID uint, from, to *time.Time, limit, offset int) ([]CustomerAuctionRow, error) {
	var rows []CustomerAuctionRow
	q := r.db.Model(&AuctionRecord{}).
		Select("auction_records.*, loans.loan_number AS loan_number").
		Joins("JOIN loans ON loans.id = auction_records.loan_id").
		Where("loans.customer_id = ?", customerID)
	if from != nil {
		q = q.Where("loans.opened_date >= ?", startOfDay(*from))
	}
	if to != nil {
		q = q.Where("loans.opened_date < ?", startOfDay(*to).AddDate(0, 0, 1))
	}
	q = q.Order("auction_records.id desc")
	if limit > 0 {
		q = q.Limit(limit).Offset(offset)
	}
	err := q.Find(&rows).Error
	return rows, err
}

func (r *AuctionRepository) CreateNotice(n *AuctionNotice) error {
	return r.db.Create(n).Error
}

// CreateEvent appends one entry to a case's staff-action audit trail. tx may
// be nil to write outside a transaction.
func (r *AuctionRepository) CreateEvent(tx *gorm.DB, e *AuctionEvent) error {
	return r.dbOr(tx).Create(e).Error
}

// dbOr returns tx when the caller is inside a transaction, else the
// repository's own handle — lets every write below participate in a
// transaction without duplicating each method.
func (r *AuctionRepository) dbOr(tx *gorm.DB) *gorm.DB {
	if tx != nil {
		return tx
	}
	return r.db
}

func (r *AuctionRepository) UpdateTx(tx *gorm.DB, a *AuctionRecord) error {
	return r.dbOr(tx).Save(a).Error
}

// FindPendingDecision returns the open escalation of the given kind against a
// case, if any. At most one can exist per (record, kind) — enforced by a
// partial unique index (see cmd/migrate).
func (r *AuctionRepository) FindPendingDecision(tx *gorm.DB, auctionRecordID uint, kind string) (*AuctionDecisionRequest, error) {
	var req AuctionDecisionRequest
	err := r.dbOr(tx).
		Where("auction_record_id = ? AND kind = ? AND status = ?", auctionRecordID, kind, AuctionDecisionPending).
		First(&req).Error
	if err != nil {
		return nil, err
	}
	return &req, nil
}

// HasAnyPendingDecision reports whether a case has ANY open escalation. Used
// by the pre-sale guard: while a repayment decision is outstanding the gold
// must not move any further through the pipeline.
func (r *AuctionRepository) HasAnyPendingDecision(auctionRecordID uint) (bool, error) {
	var count int64
	err := r.db.Model(&AuctionDecisionRequest{}).
		Where("auction_record_id = ? AND status = ?", auctionRecordID, AuctionDecisionPending).
		Count(&count).Error
	return count > 0, err
}

func (r *AuctionRepository) CreateDecision(tx *gorm.DB, req *AuctionDecisionRequest) error {
	return r.dbOr(tx).Create(req).Error
}

func (r *AuctionRepository) UpdateDecision(tx *gorm.DB, req *AuctionDecisionRequest) error {
	return r.dbOr(tx).Save(req).Error
}

func (r *AuctionRepository) FindDecisionByID(tx *gorm.DB, id uint) (*AuctionDecisionRequest, error) {
	var req AuctionDecisionRequest
	if err := r.dbOr(tx).First(&req, id).Error; err != nil {
		return nil, err
	}
	return &req, nil
}

// FindPendingDecisions lists every open escalation across all loans — backs
// the pending-decisions queue. branchID scopes to the caller's branch (nil
// for Administrator).
func (r *AuctionRepository) FindPendingDecisions(branchID *uint) ([]AuctionDecisionRequest, error) {
	var reqs []AuctionDecisionRequest
	q := r.db.Model(&AuctionDecisionRequest{}).
		Where("auction_decision_requests.status = ?", AuctionDecisionPending)
	if branchID != nil {
		q = q.Joins("JOIN loans ON loans.id = auction_decision_requests.loan_id").
			Where("loans.branch_id = ?", *branchID)
	}
	err := q.Order("auction_decision_requests.created_at asc").Find(&reqs).Error
	return reqs, err
}

// --- Loan drafts ------------------------------------------------------------

// DraftRepository persists unsubmitted New Gold Loan forms (see LoanDraft).
type DraftRepository struct {
	db *gorm.DB
}

func NewDraftRepository(db *gorm.DB) *DraftRepository {
	return &DraftRepository{db: db}
}

// preloadDraft attaches the relations the New Loan form needs to repopulate
// its pickers — the ornament rows in their saved on-screen order, plus the
// customer/scheme/branch so their display labels don't need extra lookups.
func preloadDraft(db *gorm.DB) *gorm.DB {
	return db.
		Preload("Branch").
		Preload("Customer").
		Preload("Scheme").
		Preload("Ornaments", func(db *gorm.DB) *gorm.DB {
			return db.Order("position asc, id asc")
		})
}

// Create writes a draft and its ornament rows together — GORM cascades the
// Ornaments slice because of the DraftID foreign key.
func (r *DraftRepository) Create(d *LoanDraft) error {
	return r.db.Create(d).Error
}

// Replace overwrites an existing draft in place: the header fields are saved
// and the ornament rows are deleted and re-inserted rather than diffed. Rows
// have no identity worth preserving (no history hangs off them, and the
// frontend sends the whole table on every save), so a wholesale replace is
// both simpler and immune to the stale-row bugs a partial update invites.
// Wrapped in a transaction so a failed re-insert can't leave a draft with
// its ornaments deleted.
func (r *DraftRepository) Replace(d *LoanDraft) error {
	return r.db.Transaction(func(tx *gorm.DB) error {
		if err := tx.Where("draft_id = ?", d.ID).Delete(&LoanDraftOrnament{}).Error; err != nil {
			return err
		}
		// Omit the association on Save, or GORM would try to upsert the rows
		// just deleted; they're re-created explicitly below.
		if err := tx.Omit("Ornaments", "Branch", "Customer", "Scheme").Save(d).Error; err != nil {
			return err
		}
		for i := range d.Ornaments {
			d.Ornaments[i].ID = 0
			d.Ornaments[i].DraftID = d.ID
			if err := tx.Create(&d.Ornaments[i]).Error; err != nil {
				return err
			}
		}
		return nil
	})
}

func (r *DraftRepository) FindByID(id uint) (*LoanDraft, error) {
	var d LoanDraft
	if err := preloadDraft(r.db).First(&d, id).Error; err != nil {
		return nil, err
	}
	return &d, nil
}

// FindAllByEmployee lists one employee's own drafts, newest-saved first —
// drafts are private to whoever saved them (see LoanDraft's doc comment).
// branchScope additionally restricts to the caller's branch when set.
func (r *DraftRepository) FindAllByEmployee(employeeID uint, branchScope *uint) ([]LoanDraft, error) {
	q := preloadDraft(r.db).Model(&LoanDraft{}).
		Where("created_by_employee_id = ?", employeeID).
		Order("updated_at desc")
	if branchScope != nil {
		q = q.Where("branch_id = ?", *branchScope)
	}
	var drafts []LoanDraft
	err := q.Find(&drafts).Error
	return drafts, err
}

// Delete hard deletes a draft and its rows — drafts are scratch paper, not
// an audit trail (see LoanDraft's doc comment).
func (r *DraftRepository) Delete(id uint) error {
	return r.db.Transaction(func(tx *gorm.DB) error {
		if err := tx.Where("draft_id = ?", id).Delete(&LoanDraftOrnament{}).Error; err != nil {
			return err
		}
		return tx.Delete(&LoanDraft{}, id).Error
	})
}
