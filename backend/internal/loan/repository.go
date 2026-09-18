package loan

import (
	"context"
	"errors"
	"time"

	"gorm.io/gorm"

	"cloudhouse/backend/internal/platform"
	"gorm.io/gorm/clause"
)

// Repository provides GORM-backed persistence for Loan records (plus the
// small child-resource repositories below — Ornament, LoanApproval,
// LoanPayment, BankPledgeRecord — grouped in this one file the way
// internal/cash groups CashMovement/Expense repositories).
type Repository struct {
	db platform.DB
}

func NewRepository(db platform.DB) *Repository {
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

func (r *Repository) Create(ctx context.Context, l *Loan) error {
	return r.db.WithContext(ctx).Create(l).Error
}

func (r *Repository) Update(ctx context.Context, l *Loan) error {
	return r.db.WithContext(ctx).Save(l).Error
}

// LockByID is FindByID's row-locking counterpart, for use inside a
// db.Transaction by writers that must serialize against concurrent changes
// to the same loan (e.g. Service.TopUpLoan) before reading a balance they're
// about to mutate — mirrors personalloan.Repository.LockByID /
// investment.Repository.LockByID. Child collections are deliberately not
// preloaded, matching AuctionRepository.FindActiveByLoanIDForUpdate's own
// note: FOR UPDATE applies to a single-table query.
func (r *Repository) LockByID(ctx context.Context, tx *gorm.DB, id uint) (*Loan, error) {
	var l Loan
	if err := tx.WithContext(ctx).Clauses(clause.Locking{Strength: "UPDATE"}).First(&l, id).Error; err != nil {
		return nil, err
	}
	return &l, nil
}

// UpdateTx is Update's transactional counterpart, for use after LockByID
// within the same db.Transaction — mirrors AuctionRepository.UpdateTx. tx
// may be nil to write outside a transaction, same as AuctionRepository's.
func (r *Repository) UpdateTx(ctx context.Context, tx *gorm.DB, l *Loan) error {
	return r.dbOr(ctx, tx).Save(l).Error
}

// dbOr returns tx when the caller is inside a transaction, else the
// repository's own handle — mirrors AuctionRepository.dbOr.
func (r *Repository) dbOr(ctx context.Context, tx *gorm.DB) *gorm.DB {
	if tx != nil {
		return tx
	}
	return r.db.WithContext(ctx)
}

func (r *Repository) FindByID(ctx context.Context, id uint) (*Loan, error) {
	var l Loan
	if err := preloadAll(r.db.WithContext(ctx)).First(&l, id).Error; err != nil {
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
func (r *Repository) FindByLoanNumber(ctx context.Context, loanNumber string) (*Loan, error) {
	var l Loan
	if err := preloadAll(r.db.WithContext(ctx)).Where("loan_number = ?", loanNumber).First(&l).Error; err != nil {
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
	SchemeID   uint
	LoanIDs    []uint // when non-empty, narrows to exactly these loans (e.g. a scheme statement's loan picker)
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

	// ExcludeBankPledged keeps only loans that may still be pledged to a
	// bank: BankPledgeStatus must not be Pledged (one is already open with a
	// bank), and the loan's own status must not be in
	// bankPledgeIneligibleStatuses, whose gold is not in the branch's custody
	// to hand over (closed/released to the customer, release in flight,
	// auctioned, or not disbursed yet). Released is deliberately ELIGIBLE —
	// it means the gold came back from the bank, so the loan may be pledged
	// again (see bankPledgeRefusal for why the older once-per-lifetime rule
	// was dropped).
	//
	// This is the bank re-pledge loan picker's eligible set, computed
	// server-side rather than fetched in full and filtered in the browser,
	// and deliberately the same rule Service.RecordBankPledge enforces so the
	// picker never offers a loan the save would reject.
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

// applyFilters narrows q by every set field on f — the shared filter-building
// logic behind FindAll and CountFiltered so the two can never drift out of
// sync on what counts as a match.
func applyFilters(q *gorm.DB, f LoanFilter) *gorm.DB {
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
	if f.SchemeID != 0 {
		q = q.Where("scheme_id = ?", f.SchemeID)
	}
	if len(f.LoanIDs) > 0 {
		q = q.Where("id IN ?", f.LoanIDs)
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
		q = q.Where("status NOT IN ?", bankPledgeIneligibleStatuses)
	}
	if f.BankPledgeStatus != "" {
		q = q.Where("bank_pledge_status = ?", f.BankPledgeStatus)
	}
	return q
}

// FindAll returns the matching loans (Limit/Offset applied) plus the TOTAL
// row count for f's filters (Limit/Offset ignored for that count) — 0 when
// f.Limit <= 0, since the non-paginated bare-array callers have no page
// indicator to show a total on and the extra COUNT(*) would be wasted work.
func (r *Repository) FindAll(ctx context.Context, f LoanFilter) ([]Loan, int64, error) {
	// Most recently opened loan first. Ordering by id alone pinned whichever
	// loan was inserted last to the top even when an older-dated loan was
	// entered afterwards; id only breaks ties within the same day now.
	q := applyFilters(preloadAll(r.db.WithContext(ctx)).Model(&Loan{}).Order("opened_date desc, id desc"), f)
	var total int64
	if f.Limit > 0 {
		// A real COUNT over the same filter, ignoring Limit/Offset — computed
		// on a cloned session so chaining Limit/Offset below doesn't affect
		// it (same pattern as CountFiltered). Without this, `total` was left
		// at its zero value here despite the handler's response claiming it
		// as "a real COUNT" — every paginated Loans page therefore reported
		// total: 0, which made the frontend treat page 1 as the last page
		// and permanently disable Next as soon as the total became "known".
		if err := applyFilters(r.db.WithContext(ctx).Model(&Loan{}), f).Count(&total).Error; err != nil {
			return nil, 0, err
		}
		q = q.Limit(f.Limit)
	}
	if f.Offset > 0 {
		q = q.Offset(f.Offset)
	}
	var loans []Loan
	err := q.Find(&loans).Error
	return loans, total, err
}

// CountFiltered returns how many loans match f, ignoring Limit/Offset — the
// total the paginated list endpoint needs so the UI can render a stable
// "Page X of N" instead of inferring it from a has-more probe.
func (r *Repository) CountFiltered(ctx context.Context, f LoanFilter) (int64, error) {
	var count int64
	err := applyFilters(r.db.WithContext(ctx).Model(&Loan{}), f).Count(&count).Error
	return count, err
}

// CountAll returns the total number of loans ever created, used to
// generate sequential LoanNumber values.
func (r *Repository) CountAll(ctx context.Context) (int64, error) {
	var count int64
	err := r.db.WithContext(ctx).Model(&Loan{}).Count(&count).Error
	return count, err
}

// MaxLoanNumberSuffix returns the highest numeric suffix ever used in a
// "LN-NNNNN" loan number, including loans that have since been hard-deleted
// (see Service.HardDeleteLoan) — the next number is always one past this,
// never derived from a live row COUNT. COUNT drops when a loan is
// hard-deleted, but the numbers already handed out to SURVIVING loans
// don't shift down to fill the gap; deriving the next number from COUNT+1
// after a delete regenerates a number a later loan already holds and the
// unique index rejects the insert outright (SQLSTATE 23505). Reads
// Unscoped so a soft-deleted row (deleted_at set, not hard-deleted) still
// counts too — its number is still spoken for.
func (r *Repository) MaxLoanNumberSuffix(ctx context.Context) (int, error) {
	var maxSuffix int
	err := r.db.WithContext(ctx).Model(&Loan{}).Unscoped().
		Select("COALESCE(MAX(CAST(SUBSTRING(loan_number FROM 'LN-(\\d+)') AS INTEGER)), 0)").
		Scan(&maxSuffix).Error
	return maxSuffix, err
}

// FindOpenForCalendar returns every not-yet-closed loan (Active/Due
// Soon/Overdue), preloading only Customer's id/name — used by
// internal/reminder's calendar aggregation to derive Loan Due/Overdue/
// interest-anniversary events without paying for the full preloadAll graph
// (ornaments, images, payments, etc.) that a real loan detail view needs.
func (r *Repository) FindOpenForCalendar(ctx context.Context) ([]Loan, error) {
	var loans []Loan
	err := r.db.WithContext(ctx).
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
	db platform.DB
}

func NewOrnamentRepository(db platform.DB) *OrnamentRepository {
	return &OrnamentRepository{db: db}
}

func (r *OrnamentRepository) Create(ctx context.Context, o *Ornament) error {
	return r.db.WithContext(ctx).Create(o).Error
}

func (r *OrnamentRepository) Update(ctx context.Context, o *Ornament) error {
	return r.db.WithContext(ctx).Save(o).Error
}

func (r *OrnamentRepository) FindByID(ctx context.Context, id uint) (*Ornament, error) {
	var o Ornament
	if err := r.db.WithContext(ctx).Preload("PurityTest").Preload("Images").First(&o, id).Error; err != nil {
		return nil, err
	}
	return &o, nil
}

func (r *OrnamentRepository) FindByLoanID(ctx context.Context, loanID uint) ([]Ornament, error) {
	var ornaments []Ornament
	err := r.db.WithContext(ctx).Preload("PurityTest").Preload("Images").Where("loan_id = ?", loanID).Order("id asc").Find(&ornaments).Error
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
// FindByCustomerID returns matching rows plus the TOTAL row count (Limit/
// Offset ignored, 0 when limit <= 0).
func (r *OrnamentRepository) FindByCustomerID(ctx context.Context, customerID uint, from, to *time.Time, limit, offset int) ([]CustomerOrnamentRow, int64, error) {
	var rows []CustomerOrnamentRow
	q := r.db.WithContext(ctx).Model(&Ornament{}).
		Select("ornaments.*, loans.loan_number AS loan_number").
		Joins("JOIN loans ON loans.id = ornaments.loan_id").
		Where("loans.customer_id = ?", customerID)
	if from != nil {
		q = q.Where("loans.opened_date >= ?", startOfDay(*from))
	}
	if to != nil {
		q = q.Where("loans.opened_date < ?", startOfDay(*to).AddDate(0, 0, 1))
	}
	// Same ordering as FindAll — most recently opened loan first, id only as
	// a same-day tie-break — so both 360 sub-tables agree on "newest".
	q = q.Order("loans.opened_date desc, loans.id desc, ornaments.id asc")
	var total int64
	if limit > 0 {
		if err := q.Session(&gorm.Session{}).Count(&total).Error; err != nil {
			return nil, 0, err
		}
		q = q.Limit(limit).Offset(offset)
	}
	err := q.Find(&rows).Error
	return rows, total, err
}

func (r *OrnamentRepository) SavePurityTest(ctx context.Context, t *OrnamentPurityTest) error {
	return r.db.WithContext(ctx).Save(t).Error
}

func (r *OrnamentRepository) AddImage(ctx context.Context, img *OrnamentImage) error {
	return r.db.WithContext(ctx).Create(img).Error
}

// ApprovalRepository provides GORM-backed persistence for LoanApproval audit rows.
type ApprovalRepository struct {
	db platform.DB
}

func NewApprovalRepository(db platform.DB) *ApprovalRepository {
	return &ApprovalRepository{db: db}
}

func (r *ApprovalRepository) Create(ctx context.Context, a *LoanApproval) error {
	return r.db.WithContext(ctx).Create(a).Error
}

func (r *ApprovalRepository) FindByLoanID(ctx context.Context, loanID uint) ([]LoanApproval, error) {
	var approvals []LoanApproval
	err := r.db.WithContext(ctx).Where("loan_id = ?", loanID).Order("id asc").Find(&approvals).Error
	return approvals, err
}

// PaymentRepository provides GORM-backed persistence for LoanPayment audit rows.
type PaymentRepository struct {
	db platform.DB
}

func NewPaymentRepository(db platform.DB) *PaymentRepository {
	return &PaymentRepository{db: db}
}

func (r *PaymentRepository) Create(ctx context.Context, p *LoanPayment) error {
	return r.db.WithContext(ctx).Create(p).Error
}

// CreateTx is Create's transactional counterpart, for use inside a
// db.Transaction alongside Repository.LockByID/UpdateTx (e.g.
// Service.RecordPayment, Service.TopUpLoan).
func (r *PaymentRepository) CreateTx(ctx context.Context, tx *gorm.DB, p *LoanPayment) error {
	return r.dbOr(ctx, tx).Create(p).Error
}

// dbOr returns tx when the caller is inside a transaction, else the
// repository's own handle — mirrors Repository.dbOr.
func (r *PaymentRepository) dbOr(ctx context.Context, tx *gorm.DB) *gorm.DB {
	if tx != nil {
		return tx
	}
	return r.db.WithContext(ctx)
}

func (r *PaymentRepository) FindByLoanID(ctx context.Context, loanID uint) ([]LoanPayment, error) {
	var payments []LoanPayment
	err := r.db.WithContext(ctx).Where("loan_id = ?", loanID).Order("paid_on desc, id desc").Find(&payments).Error
	return payments, err
}

// FindByID looks up a single payment by its primary key — used by the
// customer-app payment-receipt endpoint, which then checks the payment's
// parent loan belongs to the requesting customer before generating anything.
func (r *PaymentRepository) FindByID(ctx context.Context, id uint) (*LoanPayment, error) {
	var p LoanPayment
	if err := r.db.WithContext(ctx).First(&p, id).Error; err != nil {
		return nil, err
	}
	return &p, nil
}

// FindByCustomerID returns every payment across every loan belonging to
// customerID, newest first, joining loan_payments to loans to scope by
// loans.customer_id — backs GET /customer/payments (the Payments tab's
// global history), paginated the same way FindAll's list endpoints are
// (limit/offset, caller decides "hasMore" from an oversized limit).
func (r *PaymentRepository) FindByCustomerID(ctx context.Context, customerID uint, limit, offset int) ([]LoanPayment, error) {
	var payments []LoanPayment
	q := r.db.WithContext(ctx).Model(&LoanPayment{}).
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
// FindByCustomerIDForProfile returns matching rows plus the TOTAL row count
// (Limit/Offset ignored, 0 when limit <= 0).
func (r *PaymentRepository) FindByCustomerIDForProfile(ctx context.Context, customerID uint, from, to *time.Time, limit, offset int) ([]CustomerPaymentRow, int64, error) {
	var rows []CustomerPaymentRow
	q := r.db.WithContext(ctx).Model(&LoanPayment{}).
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
	var total int64
	if limit > 0 {
		if err := q.Session(&gorm.Session{}).Count(&total).Error; err != nil {
			return nil, 0, err
		}
		q = q.Limit(limit).Offset(offset)
	}
	err := q.Find(&rows).Error
	return rows, total, err
}

// FindLatestPaidOn returns the loan's most recent LoanPayment.PaidOn, or the
// zero time if it has no payments yet — see LoanTopUpRepository.
// FindMostRecentDate's doc comment for why both are checked.
func (r *PaymentRepository) FindLatestPaidOn(ctx context.Context, loanID uint) (time.Time, error) {
	var p LoanPayment
	err := r.db.WithContext(ctx).Where("loan_id = ?", loanID).Order("paid_on desc, id desc").First(&p).Error
	if err != nil {
		if errors.Is(err, gorm.ErrRecordNotFound) {
			return time.Time{}, nil
		}
		return time.Time{}, err
	}
	return p.PaidOn, nil
}

// SumInterestCollected totals the interest + penal-interest portions of
// every payment recorded with PaidOn within [from, to] (inclusive) —
// backs the Dashboard's "Interest Collected" KPI (see
// Service.GetInterestCollected).
func (r *PaymentRepository) SumInterestCollected(ctx context.Context, from, to time.Time) (float64, error) {
	var total float64
	err := r.db.WithContext(ctx).Model(&LoanPayment{}).
		Where("paid_on >= ? AND paid_on <= ?", from, to).
		Select("COALESCE(SUM(interest_applied + penal_interest_applied), 0)").
		Row().Scan(&total)
	return total, err
}

// LoanTopUpRepository provides GORM-backed persistence for LoanTopUp rows.
type LoanTopUpRepository struct {
	db platform.DB
}

func NewLoanTopUpRepository(db platform.DB) *LoanTopUpRepository {
	return &LoanTopUpRepository{db: db}
}

// CreateTx is the only write this repository exposes — LoanTopUp rows are
// append-only (Phase 0.5 §6): a correction is a new reversal entry, never an
// edit of this one. Always called inside the same transaction that locked
// and updated the parent Loan (Service.TopUpLoan).
func (r *LoanTopUpRepository) CreateTx(ctx context.Context, tx *gorm.DB, t *LoanTopUp) error {
	return tx.WithContext(ctx).Create(t).Error
}

func (r *LoanTopUpRepository) FindByLoanID(ctx context.Context, loanID uint) ([]LoanTopUp, error) {
	var recs []LoanTopUp
	err := r.db.WithContext(ctx).Where("loan_id = ?", loanID).Order("occurred_on desc, id desc").Find(&recs).Error
	return recs, err
}

// FindMostRecentDate returns the OccurredOn of the loan's latest top-up, or
// the zero time if it has none yet — feeds the Phase 0.5 backdating check
// (platform.ValidateOccurredOn), alongside the loan's latest LoanPayment
// date (see PaymentRepository.FindLatestPaidOn), since either kind of event
// can be the most recent one on the account.
func (r *LoanTopUpRepository) FindMostRecentDate(ctx context.Context, loanID uint) (time.Time, error) {
	var t LoanTopUp
	err := r.db.WithContext(ctx).Where("loan_id = ?", loanID).Order("occurred_on desc, id desc").First(&t).Error
	if err != nil {
		if errors.Is(err, gorm.ErrRecordNotFound) {
			return time.Time{}, nil
		}
		return time.Time{}, err
	}
	return t.OccurredOn, nil
}

// BankPledgeRepository provides GORM-backed persistence for BankPledgeRecord rows.
type BankPledgeRepository struct {
	db platform.DB
}

func NewBankPledgeRepository(db platform.DB) *BankPledgeRepository {
	return &BankPledgeRepository{db: db}
}

func (r *BankPledgeRepository) Create(ctx context.Context, p *BankPledgeRecord) error {
	return r.db.WithContext(ctx).Create(p).Error
}

func (r *BankPledgeRepository) Update(ctx context.Context, p *BankPledgeRecord) error {
	return r.db.WithContext(ctx).Save(p).Error
}

func (r *BankPledgeRepository) FindByID(ctx context.Context, id uint) (*BankPledgeRecord, error) {
	var p BankPledgeRecord
	if err := r.db.WithContext(ctx).First(&p, id).Error; err != nil {
		return nil, err
	}
	return &p, nil
}

// HasActive reports whether the loan has any pledge record still in the
// Active state. Loan.BankPledgeStatus is a stored *copy* of this fact, and
// the two can disagree: before RecordBankPledge gained its once-per-loan
// guard a loan could hold two Active records, and releasing one overwrote
// the loan-level string while leaving the other open. Every guard that must
// not be fooled by that drift (CompleteRelease, RecordBankPledge) asks the
// records through here rather than reading the string.
func (r *BankPledgeRepository) HasActive(ctx context.Context, loanID uint) (bool, error) {
	var count int64
	err := r.db.WithContext(ctx).Model(&BankPledgeRecord{}).
		Where("loan_id = ? AND status = ?", loanID, BankPledgeStatusRecordActive).
		Count(&count).Error
	return count > 0, err
}

func (r *BankPledgeRepository) FindByLoanID(ctx context.Context, loanID uint) ([]BankPledgeRecord, error) {
	var pledges []BankPledgeRecord
	err := r.db.WithContext(ctx).Where("loan_id = ?", loanID).Order("id desc").Find(&pledges).Error
	return pledges, err
}

// FindHistoryByLoanID returns every re-pledge ever recorded against a loan —
// including released and voided ones — with each record's audit trail
// attached. The plain FindByLoanID above is kept for the existing callers that
// only want the raw rows.
func (r *BankPledgeRepository) FindHistoryByLoanID(ctx context.Context, loanID uint) ([]BankPledgeRecord, error) {
	var pledges []BankPledgeRecord
	err := r.db.WithContext(ctx).
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
// FindAllHistory returns matching pledges plus the TOTAL row count (Limit/
// Offset ignored, 0 when limit <= 0).
func (r *BankPledgeRepository) FindAllHistory(ctx context.Context, branchID *uint, limit, offset int) ([]BankPledgeRecord, int64, error) {
	var pledges []BankPledgeRecord
	q := r.db.WithContext(ctx).Model(&BankPledgeRecord{}).
		Preload("Events", func(d *gorm.DB) *gorm.DB { return d.Order("created_at asc, id asc") })
	if branchID != nil {
		q = q.Joins("JOIN loans ON loans.id = bank_pledge_records.loan_id").
			Where("loans.branch_id = ?", *branchID)
	}
	q = q.Order("bank_pledge_records.id desc")
	var total int64
	if limit > 0 {
		if err := q.Session(&gorm.Session{}).Count(&total).Error; err != nil {
			return nil, 0, err
		}
		q = q.Limit(limit).Offset(offset)
	}
	err := q.Find(&pledges).Error
	return pledges, total, err
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
// FindAllByCustomerID returns matching rows plus the TOTAL row count (Limit/
// Offset ignored, 0 when limit <= 0).
func (r *BankPledgeRepository) FindAllByCustomerID(ctx context.Context, customerID uint, from, to *time.Time, limit, offset int) ([]CustomerBankPledgeRow, int64, error) {
	var rows []CustomerBankPledgeRow
	q := r.db.WithContext(ctx).Model(&BankPledgeRecord{}).
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
	var total int64
	if limit > 0 {
		if err := q.Session(&gorm.Session{}).Count(&total).Error; err != nil {
			return nil, 0, err
		}
		q = q.Limit(limit).Offset(offset)
	}
	err := q.Find(&rows).Error
	return rows, total, err
}

// CreateEvent appends one entry to a re-pledge record's audit trail.
func (r *BankPledgeRepository) CreateEvent(ctx context.Context, e *BankPledgeEvent) error {
	return r.db.WithContext(ctx).Create(e).Error
}

// LoanRequestRepository provides GORM-backed persistence for LoanRequest rows.
type LoanRequestRepository struct {
	db platform.DB
}

func NewLoanRequestRepository(db platform.DB) *LoanRequestRepository {
	return &LoanRequestRepository{db: db}
}

func (r *LoanRequestRepository) Create(ctx context.Context, req *LoanRequest) error {
	return r.db.WithContext(ctx).Create(req).Error
}

func (r *LoanRequestRepository) Update(ctx context.Context, req *LoanRequest) error {
	return r.db.WithContext(ctx).Save(req).Error
}

func (r *LoanRequestRepository) FindByID(ctx context.Context, id uint) (*LoanRequest, error) {
	var req LoanRequest
	if err := r.db.WithContext(ctx).Preload("Loan.Customer").First(&req, id).Error; err != nil {
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

// FindAll returns matching requests plus the TOTAL row count for f's
// filters (Limit/Offset ignored, 0 when f.Limit <= 0).
func (r *LoanRequestRepository) FindAll(ctx context.Context, f LoanRequestFilter) ([]LoanRequest, int64, error) {
	q := r.db.WithContext(ctx).Preload("Loan.Customer").Model(&LoanRequest{}).Order("id desc")
	if f.BranchID != nil {
		q = q.Joins("JOIN loans ON loans.id = loan_requests.loan_id").Where("loans.branch_id = ?", *f.BranchID)
	}
	if f.Status != "" {
		q = q.Where("loan_requests.status = ?", f.Status)
	}
	if f.LoanID != 0 {
		q = q.Where("loan_requests.loan_id = ?", f.LoanID)
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
	var reqs []LoanRequest
	err := q.Find(&reqs).Error
	return reqs, total, err
}

// FindApprovedReleaseByLoanID finds the (most recent) Approved Release
// request for a loan — CompleteRelease uses this to confirm a release was
// actually approved before letting the gold go out.
func (r *LoanRequestRepository) FindApprovedReleaseByLoanID(ctx context.Context, loanID uint) (*LoanRequest, error) {
	var req LoanRequest
	err := r.db.WithContext(ctx).Preload("Loan.Customer").
		Where("loan_id = ? AND type = ? AND status = ?", loanID, RequestTypeRelease, RequestStatusApproved).
		Order("id desc").First(&req).Error
	if err != nil {
		return nil, err
	}
	return &req, nil
}

// FindPendingReleaseByLoanID finds the (most recent) still-Pending Release
// request for a loan, if any — CompleteRelease uses this to auto-resolve a
// request left dangling when the balance was cleared and the release
// completed through the "already paid in full" path (see its own doc
// comment) rather than that request's own checklist/approval chain, which
// otherwise left it stuck showing Pending forever on a loan that was
// actually already released.
func (r *LoanRequestRepository) FindPendingReleaseByLoanID(ctx context.Context, loanID uint) (*LoanRequest, error) {
	var req LoanRequest
	err := r.db.WithContext(ctx).Preload("Loan.Customer").
		Where("loan_id = ? AND type = ? AND status = ?", loanID, RequestTypeRelease, RequestStatusPending).
		Order("id desc").First(&req).Error
	if err != nil {
		return nil, err
	}
	return &req, nil
}

// RequestApprovalRepository provides GORM-backed persistence for
// RequestApproval audit rows — mirrors ApprovalRepository.
type RequestApprovalRepository struct {
	db platform.DB
}

func NewRequestApprovalRepository(db platform.DB) *RequestApprovalRepository {
	return &RequestApprovalRepository{db: db}
}

func (r *RequestApprovalRepository) Create(ctx context.Context, a *RequestApproval) error {
	return r.db.WithContext(ctx).Create(a).Error
}

func (r *RequestApprovalRepository) FindByRequestID(ctx context.Context, requestID uint) ([]RequestApproval, error) {
	var approvals []RequestApproval
	err := r.db.WithContext(ctx).Where("request_id = ?", requestID).Order("id asc").Find(&approvals).Error
	return approvals, err
}

// AuctionRepository provides GORM-backed persistence for AuctionRecord rows
// (plus their nested Notices).
type AuctionRepository struct {
	db platform.DB
}

func NewAuctionRepository(db platform.DB) *AuctionRepository {
	return &AuctionRepository{db: db}
}

func (r *AuctionRepository) Create(ctx context.Context, a *AuctionRecord) error {
	return r.db.WithContext(ctx).Create(a).Error
}

func (r *AuctionRepository) Update(ctx context.Context, a *AuctionRecord) error {
	return r.db.WithContext(ctx).Save(a).Error
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
func (r *AuctionRepository) FindActiveByLoanID(ctx context.Context, loanID uint) (*AuctionRecord, error) {
	var a AuctionRecord
	if err := preloadAuctionDetail(r.db.WithContext(ctx)).
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
func (r *AuctionRepository) FindActiveByLoanIDForUpdate(ctx context.Context, tx *gorm.DB, loanID uint) (*AuctionRecord, error) {
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
func (r *AuctionRepository) FindHistoryByLoanID(ctx context.Context, loanID uint) ([]AuctionRecord, error) {
	var records []AuctionRecord
	err := preloadAuctionDetail(r.db.WithContext(ctx)).
		Where("loan_id = ?", loanID).
		Order("created_at desc, id desc").
		Find(&records).Error
	return records, err
}

// ConcludedAuctionRow is one AuctionRecord plus its parent loan's
// LoanNumber and customer's Name — same rationale as CustomerAuctionRow.
// The History tab's two sub-tables need these to show/link the actual loan
// rather than a bare numeric loanId.
type ConcludedAuctionRow struct {
	AuctionRecord
	LoanNumber   string `json:"loanNumber"`
	CustomerName string `json:"customerName"`
}

// FindAllConcluded lists concluded auction cases (Settled or Withdrawn)
// across all loans — backs the Auctions screen's History tab. branchID is the
// caller's branch-scoping restriction (nil for Administrator). The loans/
// customers JOINs are unconditional (not just when branchID is set) because
// LoanNumber/CustomerName are always needed for display, not only for the
// branch filter.
//
// hasSale narrows to cases that did (true) or did not (false) actually sell
// gold — the History tab's "Auctions Conducted" vs "Closed Without Auction"
// split, done here so each sub-table's own limit/offset paginates only its
// own rows instead of counting against a mixed set. nil means no filter.
// limit/offset apply only when limit > 0, matching LoanFilter's convention.
// FindAllConcluded returns matching rows plus the TOTAL row count (Limit/
// Offset ignored, 0 when limit <= 0).
func (r *AuctionRepository) FindAllConcluded(ctx context.Context, branchID *uint, hasSale *bool, limit, offset int) ([]ConcludedAuctionRow, int64, error) {
	var rows []ConcludedAuctionRow
	q := preloadAuctionDetail(r.db.WithContext(ctx)).Model(&AuctionRecord{}).
		Select("auction_records.*, loans.loan_number AS loan_number, customers.name AS customer_name").
		Joins("JOIN loans ON loans.id = auction_records.loan_id").
		Joins("JOIN customers ON customers.id = loans.customer_id").
		Where("auction_records.stage IN (?, ?)", AuctionStageSettled, AuctionStageWithdrawn)
	if branchID != nil {
		q = q.Where("loans.branch_id = ?", *branchID)
	}
	if hasSale != nil {
		if *hasSale {
			q = q.Where("auction_records.sale_amount > 0")
		} else {
			q = q.Where("auction_records.sale_amount <= 0")
		}
	}
	q = q.Order("auction_records.updated_at desc, auction_records.id desc")
	var total int64
	if limit > 0 {
		if err := q.Session(&gorm.Session{}).Count(&total).Error; err != nil {
			return nil, 0, err
		}
		q = q.Limit(limit).Offset(offset)
	}
	err := q.Find(&rows).Error
	return rows, total, err
}

// ScheduledAuctionCalendarRow is the shape internal/reminder's calendar
// aggregation needs for a scheduled-auction event — same "just enough
// columns, joined here rather than making the caller do it" rationale as
// ConcludedAuctionRow. Deliberately not persisted anywhere (see
// reminder/model.go's package comment): computed fresh from the live
// AuctionRecord, same as loan due-date events are computed fresh from Loan.
type ScheduledAuctionCalendarRow struct {
	LoanID       uint
	LoanNumber   string
	BranchID     uint
	CustomerID   uint
	CustomerName string
	AuctionDate  time.Time
}

// FindScheduledForCalendar returns every loan currently sitting in
// AuctionStageScheduled with an AuctionDate set — backs the Reminder
// Calendar's AuctionScheduled events (see reminder.Service.GetCalendarEvents).
// Unfiltered by date range: the caller has few enough of these (at most one
// active auction case per loan) that filtering in Go alongside the other
// live-derived event types is simpler than adding another WHERE branch here.
func (r *AuctionRepository) FindScheduledForCalendar(ctx context.Context) ([]ScheduledAuctionCalendarRow, error) {
	var rows []ScheduledAuctionCalendarRow
	err := r.db.WithContext(ctx).Model(&AuctionRecord{}).
		Select("auction_records.loan_id AS loan_id, loans.loan_number AS loan_number, loans.branch_id AS branch_id, loans.customer_id AS customer_id, customers.name AS customer_name, auction_records.auction_date AS auction_date").
		Joins("JOIN loans ON loans.id = auction_records.loan_id").
		Joins("JOIN customers ON customers.id = loans.customer_id").
		Where("auction_records.stage = ? AND auction_records.auction_date IS NOT NULL", AuctionStageScheduled).
		Find(&rows).Error
	return rows, err
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
// FindAllByCustomerID returns matching rows plus the TOTAL row count (Limit/
// Offset ignored, 0 when limit <= 0).
func (r *AuctionRepository) FindAllByCustomerID(ctx context.Context, customerID uint, from, to *time.Time, limit, offset int) ([]CustomerAuctionRow, int64, error) {
	var rows []CustomerAuctionRow
	q := r.db.WithContext(ctx).Model(&AuctionRecord{}).
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
	var total int64
	if limit > 0 {
		if err := q.Session(&gorm.Session{}).Count(&total).Error; err != nil {
			return nil, 0, err
		}
		q = q.Limit(limit).Offset(offset)
	}
	err := q.Find(&rows).Error
	return rows, total, err
}

func (r *AuctionRepository) CreateNotice(ctx context.Context, n *AuctionNotice) error {
	return r.db.WithContext(ctx).Create(n).Error
}

// CreateEvent appends one entry to a case's staff-action audit trail. tx may
// be nil to write outside a transaction.
func (r *AuctionRepository) CreateEvent(ctx context.Context, tx *gorm.DB, e *AuctionEvent) error {
	return r.dbOr(ctx, tx).Create(e).Error
}

// dbOr returns tx when the caller is inside a transaction, else the
// repository's own handle — lets every write below participate in a
// transaction without duplicating each method.
func (r *AuctionRepository) dbOr(ctx context.Context, tx *gorm.DB) *gorm.DB {
	if tx != nil {
		return tx
	}
	return r.db.WithContext(ctx)
}

func (r *AuctionRepository) UpdateTx(ctx context.Context, tx *gorm.DB, a *AuctionRecord) error {
	return r.dbOr(ctx, tx).Save(a).Error
}

// FindPendingDecision returns the open escalation of the given kind against a
// case, if any. At most one can exist per (record, kind) — enforced by a
// partial unique index (see cmd/migrate).
func (r *AuctionRepository) FindPendingDecision(ctx context.Context, tx *gorm.DB, auctionRecordID uint, kind string) (*AuctionDecisionRequest, error) {
	var req AuctionDecisionRequest
	err := r.dbOr(ctx, tx).
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
func (r *AuctionRepository) HasAnyPendingDecision(ctx context.Context, auctionRecordID uint) (bool, error) {
	var count int64
	err := r.db.WithContext(ctx).Model(&AuctionDecisionRequest{}).
		Where("auction_record_id = ? AND status = ?", auctionRecordID, AuctionDecisionPending).
		Count(&count).Error
	return count > 0, err
}

func (r *AuctionRepository) CreateDecision(ctx context.Context, tx *gorm.DB, req *AuctionDecisionRequest) error {
	return r.dbOr(ctx, tx).Create(req).Error
}

func (r *AuctionRepository) UpdateDecision(ctx context.Context, tx *gorm.DB, req *AuctionDecisionRequest) error {
	return r.dbOr(ctx, tx).Save(req).Error
}

func (r *AuctionRepository) FindDecisionByID(ctx context.Context, tx *gorm.DB, id uint) (*AuctionDecisionRequest, error) {
	var req AuctionDecisionRequest
	if err := r.dbOr(ctx, tx).First(&req, id).Error; err != nil {
		return nil, err
	}
	return &req, nil
}

// FindPendingDecisions lists every open escalation across all loans — backs
// the pending-decisions queue. branchID scopes to the caller's branch (nil
// for Administrator).
func (r *AuctionRepository) FindPendingDecisions(ctx context.Context, branchID *uint) ([]AuctionDecisionRequest, error) {
	var reqs []AuctionDecisionRequest
	q := r.db.WithContext(ctx).Model(&AuctionDecisionRequest{}).
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
	db platform.DB
}

func NewDraftRepository(db platform.DB) *DraftRepository {
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
func (r *DraftRepository) Create(ctx context.Context, d *LoanDraft) error {
	return r.db.WithContext(ctx).Create(d).Error
}

// Replace overwrites an existing draft in place: the header fields are saved
// and the ornament rows are deleted and re-inserted rather than diffed. Rows
// have no identity worth preserving (no history hangs off them, and the
// frontend sends the whole table on every save), so a wholesale replace is
// both simpler and immune to the stale-row bugs a partial update invites.
// Wrapped in a transaction so a failed re-insert can't leave a draft with
// its ornaments deleted.
func (r *DraftRepository) Replace(ctx context.Context, d *LoanDraft) error {
	return r.db.WithContext(ctx).Transaction(func(tx *gorm.DB) error {
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

func (r *DraftRepository) FindByID(ctx context.Context, id uint) (*LoanDraft, error) {
	var d LoanDraft
	if err := preloadDraft(r.db.WithContext(ctx)).First(&d, id).Error; err != nil {
		return nil, err
	}
	return &d, nil
}

// FindAllByEmployee lists one employee's own drafts, newest-saved first —
// drafts are private to whoever saved them (see LoanDraft's doc comment).
// branchScope additionally restricts to the caller's branch when set.
func (r *DraftRepository) FindAllByEmployee(ctx context.Context, employeeID uint, branchScope *uint) ([]LoanDraft, error) {
	q := preloadDraft(r.db.WithContext(ctx)).Model(&LoanDraft{}).
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
func (r *DraftRepository) Delete(ctx context.Context, id uint) error {
	return r.db.WithContext(ctx).Transaction(func(tx *gorm.DB) error {
		if err := tx.Where("draft_id = ?", id).Delete(&LoanDraftOrnament{}).Error; err != nil {
			return err
		}
		return tx.Delete(&LoanDraft{}, id).Error
	})
}
