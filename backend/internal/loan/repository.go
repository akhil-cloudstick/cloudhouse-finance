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
func (r *BankPledgeRepository) FindAllHistory(branchID *uint) ([]BankPledgeRecord, error) {
	var pledges []BankPledgeRecord
	q := r.db.Model(&BankPledgeRecord{}).
		Preload("Events", func(d *gorm.DB) *gorm.DB { return d.Order("created_at asc, id asc") })
	if branchID != nil {
		q = q.Joins("JOIN loans ON loans.id = bank_pledge_records.loan_id").
			Where("loans.branch_id = ?", *branchID)
	}
	err := q.Order("bank_pledge_records.id desc").Find(&pledges).Error
	return pledges, err
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
}

func (r *LoanRequestRepository) FindAll(f LoanRequestFilter) ([]LoanRequest, error) {
	q := r.db.Preload("Loan.Customer").Model(&LoanRequest{}).Order("id desc")
	if f.BranchID != nil {
		q = q.Joins("JOIN loans ON loans.id = loan_requests.loan_id").Where("loans.branch_id = ?", *f.BranchID)
	}
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
func (r *AuctionRepository) FindAllConcluded(branchID *uint) ([]AuctionRecord, error) {
	var records []AuctionRecord
	q := preloadAuctionDetail(r.db).Model(&AuctionRecord{}).
		Where("auction_records.stage IN (?, ?)", AuctionStageSettled, AuctionStageWithdrawn)
	if branchID != nil {
		q = q.Joins("JOIN loans ON loans.id = auction_records.loan_id").
			Where("loans.branch_id = ?", *branchID)
	}
	err := q.Order("auction_records.updated_at desc, auction_records.id desc").Find(&records).Error
	return records, err
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
