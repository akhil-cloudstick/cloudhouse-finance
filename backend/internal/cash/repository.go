package cash

import (
	"context"
	"strings"
	"time"

	"gorm.io/gorm"

	"cloudhouse/backend/internal/platform"
)

// MovementRepository provides GORM-backed persistence for CashMovement records.
type MovementRepository struct {
	db platform.DB
}

func NewMovementRepository(db platform.DB) *MovementRepository {
	return &MovementRepository{db: db}
}

func (r *MovementRepository) Create(ctx context.Context, m *CashMovement) error {
	return r.db.WithContext(ctx).Create(m).Error
}

// Category values MovementRepository.FindAll's `category` param accepts —
// one bucket per the same Source/Purpose conventions
// SumBreakdownByDate/CashInBreakdown/CashOutBreakdown already use, exposed
// here as an actual row-level filter instead of only a same-day summary
// split. "" (CategoryAll) applies no filter at all.
const (
	CategoryAll        = ""
	CategoryLoan       = "loan"       // Source == "Loan" (manual top-up) OR Purpose starts with "Loan disbursement — " — gold loans only, excludes PL- (see CategoryPersonalLoan)
	CategoryAuction    = "auction"    // Source == "Auction" OR Purpose starts with "Auction surplus refunded"
	CategoryCollection = "collection" // Source == "Collection" (loan repayments) — gold loans only, excludes PL-
	CategoryExpenses   = "expenses"   // everything else type=out that isn't Loan/Auction/Bank — the informal "Take Cash Out" bucket (CashOutBreakdown.Withdrawals)
	// CategoryPersonalLoan/CategoryInvestment are the Ledger filter's
	// Personal Loan / Investment Type options. personalloan.Service reuses
	// the exact same cash.MovementService.RecordLoanDisbursementCashOut/
	// RecordLoanPaymentCashIn gold loans use (same Source "Loan"/
	// "Collection", same "{…} — {loanNumber}" Purpose shape) — there is no
	// separate Source for it — so a personal loan movement is told apart
	// from a gold loan one only by its embedded loan number's "PL-" prefix
	// (personalloan.Service.CreateLoan: `fmt.Sprintf("PL-%05d", …)`),
	// distinct from gold loans' "LN-" prefix. Investments DO have their own
	// Source ("Investment", cash-in) / Purpose prefix ("… — INV-…",
	// cash-out payouts), so no such loan-number scraping is needed there.
	CategoryPersonalLoan = "personal loan"
	CategoryInvestment   = "investment"
)

// MovementFilter is FindAll's multi-value filter set — separate from
// FindAll's own branchID/fromDate/toDate/search params (which predate this
// and stay as-is for every other existing caller) so adding the Ledger
// filter's Branch/Customer/Type sections (all multi-select) didn't mean
// widening FindAll's already-long positional parameter list further.
// BranchIDs/CustomerIDs/Categories, each nil or empty, apply no filter on
// that dimension; non-empty means "any row matching one of these".
type MovementFilter struct {
	BranchIDs   []uint
	CustomerIDs []uint
	Categories  []string
}

// categoryWhere returns the FindAll switch's single-category WHERE clause
// (SQL fragment + args) for one Category* bucket, or "" for CategoryAll —
// factored out so applyCategoryFilter can OR several of these together for
// FindAllFiltered's multi-select Type section.
func categoryWhere(category string) (string, []interface{}) {
	switch category {
	case CategoryLoan:
		return "((source = ? OR purpose LIKE ?) AND purpose NOT LIKE ?)", []interface{}{"Loan", "Loan disbursement — %", "%PL-%"}
	case CategoryAuction:
		return "(source = ? OR purpose LIKE ?)", []interface{}{"Auction", "Auction surplus refunded%"}
	case CategoryCollection:
		return "(source = ? AND purpose NOT LIKE ?)", []interface{}{"Collection", "%PL-%"}
	case CategoryExpenses:
		return "(type = ? AND source IS DISTINCT FROM ? AND source IS DISTINCT FROM ? AND (purpose IS NULL OR (purpose NOT LIKE ? AND purpose NOT LIKE ? AND purpose NOT LIKE ?)))",
			[]interface{}{"out", "Loan", "Auction", "Loan disbursement — %", "Auction surplus refunded%", "Bank pledge release — %"}
	case CategoryPersonalLoan:
		return "((source = ? OR source = ?) AND purpose LIKE ?)", []interface{}{"Loan", "Collection", "%PL-%"}
	case CategoryInvestment:
		return "(source = ? OR purpose LIKE ?)", []interface{}{"Investment", "%INV-%"}
	}
	return "", nil
}

// FindAll returns cash movements, optionally scoped to a single branch —
// pass nil for an Administrator's unfiltered "all branches" view, or a
// non-nil pointer to confine results to that branch (see
// platform.GetBranchScope) — optionally bounded to [fromDate, toDate] on
// occurred_on (either end left zero-value means "no bound" on that side),
// and optionally narrowed to one of the Category* buckets above. limit <= 0
// returns every matching row unpaginated (used by the CSV export handlers,
// which must never be capped to whatever page size the table itself is
// currently showing). search, when non-empty, narrows to rows whose
// purpose, source or bank ILIKE-contains it (the mobile Cash screen's
// search box).
func (r *MovementRepository) FindAll(ctx context.Context, branchID *uint, fromDate, toDate time.Time, category, search string, limit, offset int) ([]CashMovement, int64, error) {
	categories := []string{}
	if category != "" {
		categories = []string{category}
	}
	return r.FindAllFiltered(ctx, branchID, fromDate, toDate, MovementFilter{Categories: categories}, search, limit, offset)
}

// FindAllFiltered is FindAll plus the Ledger filter's multi-select Branch/
// Customer/Type sections (MovementFilter) — branchID (the caller's
// non-admin branch SCOPE) and filter.BranchIDs (the Branch section's own
// selection, Administrator-only in practice since a scoped caller already
// has branchID fixed) apply together via AND, same as every other
// dimension here.
func (r *MovementRepository) FindAllFiltered(ctx context.Context, branchID *uint, fromDate, toDate time.Time, filter MovementFilter, search string, limit, offset int) ([]CashMovement, int64, error) {
	var movements []CashMovement
	// Newest first by the transaction's day, then by when it was actually
	// recorded within that day — a date-only entry is stored at midnight, so
	// ordering on occurred_on alone sank it below everything else that day.
	// PartyCustomer/BankRef carry the names the Ledger's customer/bank links
	// show (mobile labels them from these) — PartyCustomer is trimmed to its
	// identity columns so the list never ships a customer's KYC details.
	q := r.filteredMovements(ctx, branchID, fromDate, toDate, filter, search).Preload("Branch").
		Preload("PartyCustomer", func(db *gorm.DB) *gorm.DB { return db.Select("id", "tenant_id", "name", "code") }).
		Preload("BankRef").
		Order("DATE(occurred_on) desc, created_at desc, id desc")
	var total int64
	if limit > 0 {
		if err := q.Session(&gorm.Session{}).Model(&CashMovement{}).Count(&total).Error; err != nil {
			return nil, 0, err
		}
		q = q.Limit(limit)
	}
	if offset > 0 {
		q = q.Offset(offset)
	}
	err := q.Find(&movements).Error
	return movements, total, err
}

// SumFiltered is the Ledger table footer's Total Debit (cash out) / Total
// Credit (cash in) across every movement FindAllFiltered would match — not
// just the current page.
func (r *MovementRepository) SumFiltered(ctx context.Context, branchID *uint, fromDate, toDate time.Time, filter MovementFilter, search string) (debit, credit float64, err error) {
	var row struct{ Debit, Credit float64 }
	err = r.filteredMovements(ctx, branchID, fromDate, toDate, filter, search).
		Select(`COALESCE(SUM(CASE WHEN type = 'out' THEN amount ELSE 0 END), 0) AS debit,
			COALESCE(SUM(CASE WHEN type = 'in' THEN amount ELSE 0 END), 0) AS credit`).
		Scan(&row).Error
	return row.Debit, row.Credit, err
}

// filteredMovements applies FindAllFiltered's WHERE conditions — shared with
// SumFiltered so the list and its totals can never disagree.
func (r *MovementRepository) filteredMovements(ctx context.Context, branchID *uint, fromDate, toDate time.Time, filter MovementFilter, search string) *gorm.DB {
	q := r.db.WithContext(ctx).Model(&CashMovement{})
	if branchID != nil {
		q = q.Where("branch_id = ?", *branchID)
	}
	if len(filter.BranchIDs) > 0 {
		q = q.Where("branch_id IN ?", filter.BranchIDs)
	}
	if len(filter.CustomerIDs) > 0 {
		q = q.Where("party_customer_id IN ?", filter.CustomerIDs)
	}
	if !fromDate.IsZero() {
		q = q.Where("occurred_on >= ?", fromDate)
	}
	if !toDate.IsZero() {
		q = q.Where("occurred_on < ?", toDate.AddDate(0, 0, 1))
	}
	if len(filter.Categories) > 0 {
		orQ := r.db.WithContext(ctx)
		any := false
		for _, cat := range filter.Categories {
			clause, args := categoryWhere(cat)
			if clause == "" {
				continue
			}
			orQ = orQ.Or(clause, args...)
			any = true
		}
		if any {
			q = q.Where(orQ)
		}
	}
	if search != "" {
		like := "%" + search + "%"
		q = q.Where("purpose ILIKE ? OR source ILIKE ? OR bank ILIKE ?", like, like, like)
	}
	return q
}

// ListByBank returns every cash movement tagged to bankID (CashMovement.
// BankID), newest first, optionally bounded to [fromDate, toDate] on
// occurred_on — backs the Party Transactions page's bank drill-down
// (Service.ListCashMovementsByBank). limit <= 0 returns every matching row
// unpaginated (the PDF statement export).
func (r *MovementRepository) ListByBank(ctx context.Context, bankID uint, fromDate, toDate time.Time, limit, offset int) ([]CashMovement, int64, error) {
	q := r.db.WithContext(ctx).Preload("Branch").Model(&CashMovement{}).
		Where("bank_id = ?", bankID).
		Order("occurred_on desc, id desc")
	if !fromDate.IsZero() {
		q = q.Where("occurred_on >= ?", fromDate)
	}
	if !toDate.IsZero() {
		q = q.Where("occurred_on < ?", toDate.AddDate(0, 0, 1))
	}
	var total int64
	if limit > 0 {
		if err := q.Session(&gorm.Session{}).Model(&CashMovement{}).Count(&total).Error; err != nil {
			return nil, 0, err
		}
		q = q.Limit(limit)
	}
	if offset > 0 {
		q = q.Offset(offset)
	}
	var movements []CashMovement
	err := q.Find(&movements).Error
	return movements, total, err
}

// ListByCustomer is ListByBank's counterpart for CashMovement.
// PartyCustomerID — backs the Party Transactions page's customer drill-down
// and CustomerDetail.tsx's "Transactions" tab (Service.
// ListCashMovementsByCustomer), same shape/semantics.
func (r *MovementRepository) ListByCustomer(ctx context.Context, customerID uint, fromDate, toDate time.Time, loanNumbers []string, limit, offset int) ([]CashMovement, int64, error) {
	q := r.db.WithContext(ctx).Preload("Branch").Model(&CashMovement{}).
		Where("party_customer_id = ?", customerID).
		Order("occurred_on desc, id desc")
	if !fromDate.IsZero() {
		q = q.Where("occurred_on >= ?", fromDate)
	}
	if !toDate.IsZero() {
		q = q.Where("occurred_on < ?", toDate.AddDate(0, 0, 1))
	}
	// Every loan-related movement's Purpose carries its loan number (e.g.
	// "Loan disbursement — LN-00049", "Collection — LN-00049" — see
	// RecordLoanDisbursementCashOut/RecordLoanPaymentCashIn/etc in
	// service.go), so a Purpose match is how the Ledger tab's Loan filter
	// narrows to one or more loans without a dedicated LoanID column. The
	// Loan filter is multi-select, so this ORs a LIKE per loan number rather
	// than taking a single one.
	if len(loanNumbers) > 0 {
		orQ := r.db.WithContext(ctx)
		for _, ln := range loanNumbers {
			orQ = orQ.Or("purpose LIKE ?", "%"+ln)
		}
		q = q.Where(orQ)
	}
	var total int64
	if limit > 0 {
		if err := q.Session(&gorm.Session{}).Model(&CashMovement{}).Count(&total).Error; err != nil {
			return nil, 0, err
		}
		q = q.Limit(limit)
	}
	if offset > 0 {
		q = q.Offset(offset)
	}
	var movements []CashMovement
	err := q.Find(&movements).Error
	return movements, total, err
}

// ListByBranch is ListByBank's counterpart for CashMovement.BranchID — backs
// the Party Transactions page's branch drill-down, same shape/semantics.
func (r *MovementRepository) ListByBranch(ctx context.Context, branchID uint, fromDate, toDate time.Time, limit, offset int) ([]CashMovement, int64, error) {
	q := r.db.WithContext(ctx).Preload("Branch").Model(&CashMovement{}).
		Where("branch_id = ?", branchID).
		Order("occurred_on desc, id desc")
	if !fromDate.IsZero() {
		q = q.Where("occurred_on >= ?", fromDate)
	}
	if !toDate.IsZero() {
		q = q.Where("occurred_on < ?", toDate.AddDate(0, 0, 1))
	}
	var total int64
	if limit > 0 {
		if err := q.Session(&gorm.Session{}).Model(&CashMovement{}).Count(&total).Error; err != nil {
			return nil, 0, err
		}
		q = q.Limit(limit)
	}
	if offset > 0 {
		q = q.Offset(offset)
	}
	var movements []CashMovement
	err := q.Find(&movements).Error
	return movements, total, err
}

func (r *MovementRepository) FindByID(ctx context.Context, id uint) (*CashMovement, error) {
	var m CashMovement
	if err := r.db.WithContext(ctx).Preload("Branch").First(&m, id).Error; err != nil {
		return nil, err
	}
	return &m, nil
}

func (r *MovementRepository) Update(ctx context.Context, m *CashMovement) error {
	return r.db.WithContext(ctx).Save(m).Error
}

func (r *MovementRepository) Delete(ctx context.Context, id uint) error {
	return r.db.WithContext(ctx).Delete(&CashMovement{}, id).Error
}

// DeleteByPurposes removes every CashMovement whose Purpose is an exact
// match for one of the given strings — used to retract a loan's
// disbursement (and any accompanying withheld-service-charge) entries
// when the loan is edited and about to be re-disbursed at a new amount,
// so the old figure doesn't linger in Cash & Expenses alongside the new
// one. A no-op given an empty slice.
func (r *MovementRepository) DeleteByPurposes(ctx context.Context, purposes []string) error {
	if len(purposes) == 0 {
		return nil
	}
	return r.db.WithContext(ctx).Where("purpose IN ?", purposes).Delete(&CashMovement{}).Error
}

// ExpenseRepository provides GORM-backed persistence for Expense records.
type ExpenseRepository struct {
	db platform.DB
}

func NewExpenseRepository(db platform.DB) *ExpenseRepository {
	return &ExpenseRepository{db: db}
}

func (r *ExpenseRepository) Create(ctx context.Context, e *Expense) error {
	return r.db.WithContext(ctx).Create(e).Error
}

// FindAll returns expenses, optionally scoped to a single branch — pass nil
// for an Administrator's unfiltered "all branches" view, or a non-nil
// pointer to confine results to that branch (see platform.GetBranchScope).
// search, when non-empty, narrows to rows whose category, payee or remarks
// ILIKE-contains it.
func (r *ExpenseRepository) FindAll(ctx context.Context, branchID *uint, search string, limit, offset int) ([]Expense, int64, error) {
	var expenses []Expense
	q := r.db.WithContext(ctx).Preload("Branch").Order("occurred_on desc, id desc")
	if branchID != nil {
		q = q.Where("branch_id = ?", *branchID)
	}
	if search != "" {
		like := "%" + search + "%"
		q = q.Where("category ILIKE ? OR payee ILIKE ? OR remarks ILIKE ?", like, like, like)
	}
	var total int64
	if limit > 0 {
		if err := q.Session(&gorm.Session{}).Model(&Expense{}).Count(&total).Error; err != nil {
			return nil, 0, err
		}
		q = q.Limit(limit)
	}
	if offset > 0 {
		q = q.Offset(offset)
	}
	err := q.Find(&expenses).Error
	return expenses, total, err
}

// SumFiltered is the Expense Register footer's total amount across every
// expense FindAll would match (same branch scope/search), not just the page.
func (r *ExpenseRepository) SumFiltered(ctx context.Context, branchID *uint, search string) (float64, error) {
	q := r.db.WithContext(ctx).Model(&Expense{})
	if branchID != nil {
		q = q.Where("branch_id = ?", *branchID)
	}
	if search != "" {
		like := "%" + search + "%"
		q = q.Where("category ILIKE ? OR payee ILIKE ? OR remarks ILIKE ?", like, like, like)
	}
	var sum float64
	err := q.Select("COALESCE(SUM(amount), 0)").Scan(&sum).Error
	return sum, err
}

func (r *ExpenseRepository) FindByID(ctx context.Context, id uint) (*Expense, error) {
	var e Expense
	if err := r.db.WithContext(ctx).Preload("Branch").First(&e, id).Error; err != nil {
		return nil, err
	}
	return &e, nil
}

func (r *ExpenseRepository) Update(ctx context.Context, e *Expense) error {
	return r.db.WithContext(ctx).Save(e).Error
}

// SumCashByDate sums Cash-mode, non-rejected expense amounts for the given
// day (and branch, if provided) — the figure that automatically reduces
// Expected Cash in Hand.
func (r *ExpenseRepository) SumCashByDate(ctx context.Context, branchID *uint, date time.Time) (float64, error) {
	return r.SumCashBetween(ctx, branchID, nil, startOfDay(date), startOfDay(date).AddDate(0, 0, 1))
}

// SumCashBetween is SumCashByDate over [from, to) — a zero from means "since
// the beginning". excludeBranchIDs drops those branches (used when summing
// the unseeded remainder across all branches, see SummaryService.openingFor).
func (r *ExpenseRepository) SumCashBetween(ctx context.Context, branchID *uint, excludeBranchIDs []uint, from, to time.Time) (float64, error) {
	q := r.db.WithContext(ctx).Model(&Expense{}).
		Where("mode = ?", "Cash").
		Where("status = ?", "Approved").
		Where("occurred_on < ?", to)
	if !from.IsZero() {
		q = q.Where("occurred_on >= ?", from)
	}
	if branchID != nil {
		q = q.Where("branch_id = ?", *branchID)
	}
	if len(excludeBranchIDs) > 0 {
		q = q.Where("branch_id NOT IN ?", excludeBranchIDs)
	}
	var total float64
	if err := q.Select("COALESCE(SUM(amount), 0)").Scan(&total).Error; err != nil {
		return 0, err
	}
	return total, nil
}

// SumAllByDate sums every approved (posted) expense amount (any Mode) for the
// given day (and branch, if provided) — the all-modes total shown next to
// SumCashByDate's Cash-only figure so the frontend can display both without
// having to re-derive one from the unscoped expense list.
func (r *ExpenseRepository) SumAllByDate(ctx context.Context, branchID *uint, date time.Time) (float64, error) {
	q := r.db.WithContext(ctx).Model(&Expense{}).
		Where("status = ?", "Approved").
		Where("occurred_on >= ? AND occurred_on < ?", startOfDay(date), startOfDay(date).AddDate(0, 0, 1))
	if branchID != nil {
		q = q.Where("branch_id = ?", *branchID)
	}
	var total float64
	if err := q.Select("COALESCE(SUM(amount), 0)").Scan(&total).Error; err != nil {
		return 0, err
	}
	return total, nil
}

func startOfDay(t time.Time) time.Time {
	y, m, d := t.Date()
	return time.Date(y, m, d, 0, 0, 0, 0, t.Location())
}

// MovementRepository.SumByTypeAndDate sums cash-in/cash-out movement
// amounts for the given day (and branch, if provided).
func (r *MovementRepository) SumByTypeAndDate(ctx context.Context, branchID *uint, date time.Time) (in float64, out float64, err error) {
	return r.SumByTypeBetween(ctx, branchID, nil, startOfDay(date), startOfDay(date).AddDate(0, 0, 1))
}

// SumByTypeBetween is SumByTypeAndDate over [from, to) — a zero from means
// "since the beginning". excludeBranchIDs drops those branches but keeps
// branch-less movements (see SummaryService.openingFor).
func (r *MovementRepository) SumByTypeBetween(ctx context.Context, branchID *uint, excludeBranchIDs []uint, from, to time.Time) (in float64, out float64, err error) {
	type row struct {
		Type string
		Sum  float64
	}
	// expense_id IS NULL: an expense's cash-out movement (see
	// MovementService.RecordExpenseCashOut) is excluded here since the
	// Summary's Disbursements figure already counts it via
	// ExpenseRepository.SumCashByDate — including it too would deduct the
	// same expense twice from ExpectedCash.
	q := r.db.WithContext(ctx).Model(&CashMovement{}).
		Where("occurred_on < ?", to).
		Where("expense_id IS NULL")
	if !from.IsZero() {
		q = q.Where("occurred_on >= ?", from)
	}
	if branchID != nil {
		q = q.Where("branch_id = ?", *branchID)
	}
	if len(excludeBranchIDs) > 0 {
		q = q.Where("(branch_id IS NULL OR branch_id NOT IN ?)", excludeBranchIDs)
	}
	var rows []row
	if err := q.Select("type, COALESCE(SUM(amount), 0) as sum").Group("type").Scan(&rows).Error; err != nil {
		return 0, 0, err
	}
	for _, r := range rows {
		switch r.Type {
		case "in":
			in = r.Sum
		case "out":
			out = r.Sum
		}
	}
	return in, out, nil
}

// CashInBreakdown/CashOutBreakdown split MovementRepository.SumByTypeAndDate's
// single in/out totals into the sources that actually feed them, so the
// frontend's KPI subtitles can show real numbers instead of a static label
// naming (but not measuring) each source.
type CashInBreakdown struct {
	Repayments float64 `json:"repayments"` // Source == "Collection" (loan interest/principal repayments)
	Pledges    float64 `json:"pledges"`    // Source == "Bank" (bank-pledge cash-in)
	// Auctions is Source == "Auction" — net proceeds realised from auctioning
	// pledged gold. Bucketed separately rather than falling into TopUps because
	// it is neither a customer payment nor cash the branch put in itself, and
	// misfiling it as a manual top-up would overstate how much cash staff added.
	Auctions float64 `json:"auctions"`
	// GoldSales is Source == "GoldSale" — proceeds from the business selling
	// gold it owns. Bucketed separately for the same reason Auctions is:
	// neither a customer payment nor cash staff put in themselves, so
	// leaving it in TopUps would overstate manual top-ups.
	GoldSales float64 `json:"goldSales"`
	TopUps    float64 `json:"topUps"` // Source == "Savings" | "Loan" (manual "Add Cash")
}

type CashOutBreakdown struct {
	LoanDisbursements float64 `json:"loanDisbursements"` // Purpose starts with "Loan disbursement — "
	BankReleases      float64 `json:"bankReleases"`      // Purpose starts with "Bank pledge release — "
	// AuctionRefunds is Purpose starting with "Auction surplus refunded" —
	// surplus handed back to a customer after their gold sold for more than
	// they owed. Kept out of Withdrawals so a refund owed to a customer is not
	// reported as the branch taking cash out for itself.
	AuctionRefunds float64 `json:"auctionRefunds"`
	// GoldPurchases is Purpose starting with "Gold purchase cost — " — what
	// the business paid to acquire gold it's now reselling (see
	// MovementService.RecordGoldSaleCashOut). Bucketed separately from
	// Withdrawals for the same reason Auctions/GoldSales are split out of
	// TopUps on the cash-IN side: it's a real cost of the gold-sale
	// transaction, not a manual "Take Cash Out".
	GoldPurchases float64 `json:"goldPurchases"`
	Withdrawals   float64 `json:"withdrawals"` // everything else (manual "Take Cash Out")
}

// SumBreakdownByDate buckets every cash movement for the given day (and
// branch, if provided) by its source/purpose, in Go rather than SQL — the
// bucketing rules mirror the Purpose prefixes set by
// MovementService.RecordLoanDisbursementCashOut/RecordBankPledgeCashOut and
// the Source values set by RecordBankPledgeCashIn/RecordLoanPaymentCashIn,
// so keeping them together as plain string comparisons here (rather than a
// harder-to-follow SQL CASE) keeps the two in sync at a glance.
func (r *MovementRepository) SumBreakdownByDate(ctx context.Context, branchID *uint, date time.Time) (CashInBreakdown, CashOutBreakdown, error) {
	type row struct {
		Type    string
		Source  string
		Purpose string
		Amount  float64
	}
	// expense_id IS NULL: same exclusion as SumByTypeAndDate above, for the
	// same double-counting reason.
	q := r.db.WithContext(ctx).Model(&CashMovement{}).
		Where("occurred_on >= ? AND occurred_on < ?", startOfDay(date), startOfDay(date).AddDate(0, 0, 1)).
		Where("expense_id IS NULL")
	if branchID != nil {
		q = q.Where("branch_id = ?", *branchID)
	}
	var rows []row
	if err := q.Select("type, source, purpose, amount").Scan(&rows).Error; err != nil {
		return CashInBreakdown{}, CashOutBreakdown{}, err
	}

	var in CashInBreakdown
	var out CashOutBreakdown
	for _, rw := range rows {
		switch rw.Type {
		case "in":
			switch rw.Source {
			case "Collection":
				in.Repayments += rw.Amount
			case "Bank":
				in.Pledges += rw.Amount
			case "Auction":
				in.Auctions += rw.Amount
			case "GoldSale":
				in.GoldSales += rw.Amount
			default: // "Savings", "Loan"
				in.TopUps += rw.Amount
			}
		case "out":
			switch {
			case strings.HasPrefix(rw.Purpose, "Loan disbursement — "):
				out.LoanDisbursements += rw.Amount
			case strings.HasPrefix(rw.Purpose, "Bank pledge release — "):
				out.BankReleases += rw.Amount
			case strings.HasPrefix(rw.Purpose, "Auction surplus refunded"):
				out.AuctionRefunds += rw.Amount
			case strings.HasPrefix(rw.Purpose, "Gold purchase cost — "):
				out.GoldPurchases += rw.Amount
			default:
				out.Withdrawals += rw.Amount
			}
		}
	}
	return in, out, nil
}

// OpeningBalanceRepository provides GORM-backed persistence for
// OpeningCashBalance records — one row per (branch, date).
type OpeningBalanceRepository struct {
	db platform.DB
}

func NewOpeningBalanceRepository(db platform.DB) *OpeningBalanceRepository {
	return &OpeningBalanceRepository{db: db}
}

// FindByBranchDateMode returns the opening balance for one (branch, date,
// mode, bank) — bankID nil for Cash.
func (r *OpeningBalanceRepository) FindByBranchDateMode(ctx context.Context, branchID uint, date time.Time, mode string, bankID *uint) (*OpeningCashBalance, error) {
	var rec OpeningCashBalance
	q := r.db.WithContext(ctx).Preload("Bank").Preload("FromBank").
		Where("branch_id = ? AND balance_date = ? AND mode = ?", branchID, startOfDay(date), mode)
	if bankID == nil {
		q = q.Where("bank_id IS NULL")
	} else {
		q = q.Where("bank_id = ?", *bankID)
	}
	if err := q.First(&rec).Error; err != nil {
		return nil, err
	}
	return &rec, nil
}

// FindLatestCashOnOrBefore returns the most recent manually entered Cash-mode
// opening balance for the branch dated on or before date — the seed the
// carried-forward opening is rolled forward from (see SummaryService.openingFor).
func (r *OpeningBalanceRepository) FindLatestCashOnOrBefore(ctx context.Context, branchID uint, date time.Time) (*OpeningCashBalance, error) {
	var rec OpeningCashBalance
	err := r.db.WithContext(ctx).
		Where("branch_id = ? AND mode = ? AND bank_id IS NULL AND balance_date <= ?", branchID, "Cash", startOfDay(date)).
		Order("balance_date DESC").
		First(&rec).Error
	if err != nil {
		return nil, err
	}
	return &rec, nil
}

// CashSeedBranchIDs lists every branch that has at least one Cash-mode opening
// balance dated on or before date.
func (r *OpeningBalanceRepository) CashSeedBranchIDs(ctx context.Context, date time.Time) ([]uint, error) {
	var ids []uint
	err := r.db.WithContext(ctx).Model(&OpeningCashBalance{}).
		Where("mode = ? AND bank_id IS NULL AND balance_date <= ?", "Cash", startOfDay(date)).
		Distinct().Pluck("branch_id", &ids).Error
	return ids, err
}

// Upsert creates or updates the opening balance for rec's (BranchID,
// BalanceDate, Mode, BankID).
func (r *OpeningBalanceRepository) Upsert(ctx context.Context, rec *OpeningCashBalance) error {
	rec.BalanceDate = startOfDay(rec.BalanceDate)
	existing, err := r.FindByBranchDateMode(ctx, rec.BranchID, rec.BalanceDate, rec.Mode, rec.BankID)
	if err == nil {
		existing.Amount = rec.Amount
		existing.FromBankID = rec.FromBankID
		existing.FromBank = nil
		if err := r.db.WithContext(ctx).Save(existing).Error; err != nil {
			return err
		}
		*rec = *existing
		return nil
	}
	if err != gorm.ErrRecordNotFound {
		return err
	}
	return r.db.WithContext(ctx).Create(rec).Error
}

// GoldSaleRepository provides GORM-backed persistence for GoldSale records.
type GoldSaleRepository struct {
	db platform.DB
}

func NewGoldSaleRepository(db platform.DB) *GoldSaleRepository {
	return &GoldSaleRepository{db: db}
}

func (r *GoldSaleRepository) Create(ctx context.Context, rec *GoldSale) error {
	return r.db.WithContext(ctx).Create(rec).Error
}

func (r *GoldSaleRepository) FindByID(ctx context.Context, id uint) (*GoldSale, error) {
	var rec GoldSale
	if err := r.db.WithContext(ctx).Preload("Branch").Preload("BankRef").First(&rec, id).Error; err != nil {
		return nil, err
	}
	return &rec, nil
}

// FindAll returns gold sales, optionally scoped to a single branch (nil for
// an Administrator's unfiltered "all branches" view — see
// platform.GetBranchScope) and bounded to [fromDate, toDate] on sold_on;
// either end left zero-value means "no bound" on that side, same convention
// as MovementRepository.FindAll. search, when non-empty, narrows to rows
// whose ornament_type or remarks ILIKE-contains it.
func (r *GoldSaleRepository) FindAll(ctx context.Context, branchID *uint, fromDate, toDate time.Time, search string, limit, offset int) ([]GoldSale, int64, error) {
	var sales []GoldSale
	q := r.db.WithContext(ctx).Preload("Branch").Preload("BankRef").Order("sold_on desc, id desc")
	if branchID != nil {
		q = q.Where("branch_id = ?", *branchID)
	}
	if !fromDate.IsZero() {
		q = q.Where("sold_on >= ?", fromDate)
	}
	if !toDate.IsZero() {
		q = q.Where("sold_on < ?", toDate.AddDate(0, 0, 1))
	}
	if search != "" {
		like := "%" + search + "%"
		q = q.Where("ornament_type ILIKE ? OR remarks ILIKE ?", like, like)
	}
	var total int64
	if limit > 0 {
		if err := q.Session(&gorm.Session{}).Model(&GoldSale{}).Count(&total).Error; err != nil {
			return nil, 0, err
		}
		q = q.Limit(limit)
	}
	if offset > 0 {
		q = q.Offset(offset)
	}
	err := q.Find(&sales).Error
	return sales, total, err
}

// GoldSaleTotals is the Gold Sales footer across every sale FindAll would
// match (same filters), not just the page.
type GoldSaleTotals struct {
	TotalSold   float64 `json:"totalSold"`
	TotalCost   float64 `json:"totalCost"`
	TotalProfit float64 `json:"totalProfit"`
}

func (r *GoldSaleRepository) SumFiltered(ctx context.Context, branchID *uint, fromDate, toDate time.Time, search string) (GoldSaleTotals, error) {
	q := r.db.WithContext(ctx).Model(&GoldSale{})
	if branchID != nil {
		q = q.Where("branch_id = ?", *branchID)
	}
	if !fromDate.IsZero() {
		q = q.Where("sold_on >= ?", fromDate)
	}
	if !toDate.IsZero() {
		q = q.Where("sold_on < ?", toDate.AddDate(0, 0, 1))
	}
	if search != "" {
		like := "%" + search + "%"
		q = q.Where("ornament_type ILIKE ? OR remarks ILIKE ?", like, like)
	}
	var t GoldSaleTotals
	err := q.Select(`COALESCE(SUM(sold_amount), 0) AS total_sold, COALESCE(SUM(cost_amount), 0) AS total_cost,
		COALESCE(SUM(profit), 0) AS total_profit`).Scan(&t).Error
	return t, err
}

// SumNet returns every cash movement's all-time net — SUM(in) − SUM(out),
// optionally scoped to one branch (nil = all branches). This is the
// dashboard "Cash in Hand" KPI exactly as the web and mobile dashboards
// computed it client-side from the full movement list (not
// Summary.ExpectedCash, which is a date-scoped reconciliation figure that
// needs an opening balance for the day).
func (r *MovementRepository) SumNet(ctx context.Context, branchID *uint) (float64, error) {
	q := r.db.WithContext(ctx).Model(&CashMovement{})
	if branchID != nil {
		q = q.Where("branch_id = ?", *branchID)
	}
	var net float64
	err := q.Select("COALESCE(SUM(CASE WHEN type = 'in' THEN amount WHEN type = 'out' THEN -amount ELSE 0 END), 0)").
		Scan(&net).Error
	return net, err
}

// CashSourceRepository provides GORM-backed persistence for CashSource
// records — a small find-or-create lookup list, same shape as bank.Repository.
type CashSourceRepository struct {
	db platform.DB
}

func NewCashSourceRepository(db platform.DB) *CashSourceRepository {
	return &CashSourceRepository{db: db}
}

func (r *CashSourceRepository) Create(ctx context.Context, s *CashSource) error {
	return r.db.WithContext(ctx).Create(s).Error
}

// FindAll returns cash sources matching query, plus the TOTAL row count
// (Limit/Offset ignored, 0 when limit <= 0) — same convention as
// bank.Repository.FindAll: limit == 0 returns every match unpaged, limit > 0
// applies Limit/Offset for a paginated picker.
func (r *CashSourceRepository) FindAll(ctx context.Context, query string, limit, offset int) ([]CashSource, int64, error) {
	var sources []CashSource
	q := r.db.WithContext(ctx).Order("name asc")
	if query != "" {
		q = q.Where("name ILIKE ?", "%"+query+"%")
	}
	var total int64
	if limit > 0 {
		if err := q.Session(&gorm.Session{}).Model(&CashSource{}).Count(&total).Error; err != nil {
			return nil, 0, err
		}
		q = q.Limit(limit).Offset(offset)
	}
	err := q.Find(&sources).Error
	return sources, total, err
}

func (r *CashSourceRepository) FindByName(ctx context.Context, name string) (*CashSource, error) {
	var s CashSource
	if err := r.db.WithContext(ctx).Where("name ILIKE ?", name).First(&s).Error; err != nil {
		return nil, err
	}
	return &s, nil
}

// ExpenseCategoryRepository provides GORM-backed persistence for
// ExpenseCategory records — same shape as CashSourceRepository.
type ExpenseCategoryRepository struct {
	db platform.DB
}

func NewExpenseCategoryRepository(db platform.DB) *ExpenseCategoryRepository {
	return &ExpenseCategoryRepository{db: db}
}

func (r *ExpenseCategoryRepository) Create(ctx context.Context, c *ExpenseCategory) error {
	return r.db.WithContext(ctx).Create(c).Error
}

func (r *ExpenseCategoryRepository) FindAll(ctx context.Context, query string, limit, offset int) ([]ExpenseCategory, int64, error) {
	var cats []ExpenseCategory
	q := r.db.WithContext(ctx).Order("name asc")
	if query != "" {
		q = q.Where("name ILIKE ?", "%"+query+"%")
	}
	var total int64
	if limit > 0 {
		if err := q.Session(&gorm.Session{}).Model(&ExpenseCategory{}).Count(&total).Error; err != nil {
			return nil, 0, err
		}
		q = q.Limit(limit).Offset(offset)
	}
	err := q.Find(&cats).Error
	return cats, total, err
}

func (r *ExpenseCategoryRepository) FindByName(ctx context.Context, name string) (*ExpenseCategory, error) {
	var c ExpenseCategory
	if err := r.db.WithContext(ctx).Where("name ILIKE ?", name).First(&c).Error; err != nil {
		return nil, err
	}
	return &c, nil
}

// FindByID backs the category ledger drill-down (GET
// /expense-categories/:id/ledger), which needs the category's NAME to
// filter expenses by (see MovementService.ListLedgerByCategory's doc
// comment on why this is a name match, not a FK join).
func (r *ExpenseCategoryRepository) FindByID(ctx context.Context, id uint) (*ExpenseCategory, error) {
	var c ExpenseCategory
	if err := r.db.WithContext(ctx).First(&c, id).Error; err != nil {
		return nil, err
	}
	return &c, nil
}

// LoanCashSourceRepository provides GORM-backed persistence for
// LoanCashSource records — one row per loan-sourced CashMovement.
type LoanCashSourceRepository struct {
	db platform.DB
}

func NewLoanCashSourceRepository(db platform.DB) *LoanCashSourceRepository {
	return &LoanCashSourceRepository{db: db}
}

func (r *LoanCashSourceRepository) Create(ctx context.Context, rec *LoanCashSource) error {
	return r.db.WithContext(ctx).Create(rec).Error
}

// SearchDistinctLoans returns one row per distinct loan number (case
// insensitive) — the most recent entry for it, so its bank/principal/rate
// are the latest ones recorded — for AddCashModal.tsx's Loan Number picker,
// which lets the same loan be drawn against across several Add Cash entries.
func (r *LoanCashSourceRepository) SearchDistinctLoans(ctx context.Context, query string, bankID uint, limit, offset int) ([]LoanCashSource, error) {
	var recs []LoanCashSource
	q := r.db.WithContext(ctx).Model(&LoanCashSource{}).
		Select("DISTINCT ON (LOWER(loan_number)) *").
		Order("LOWER(loan_number), created_at DESC")
	if query != "" {
		q = q.Where("loan_number ILIKE ?", "%"+query+"%")
	}
	// bankID > 0 narrows to loans drawn from that bank — the Add Cash modal
	// picks the bank first, then lists only that bank's loans.
	if bankID > 0 {
		q = q.Where("bank_id = ?", bankID)
	}
	if limit > 0 {
		q = q.Limit(limit).Offset(offset)
	}
	err := q.Preload("Bank").Find(&recs).Error
	return recs, err
}

// FindByCashMovementIDs batch-loads the LoanCashSource rows for ids, keyed by
// cash_movement_id. Errors degrade to an empty map — a missing loan number
// must never fail the movement list it decorates.
func (r *LoanCashSourceRepository) FindByCashMovementIDs(ctx context.Context, ids []uint) map[uint]*LoanCashSource {
	out := map[uint]*LoanCashSource{}
	if len(ids) == 0 {
		return out
	}
	var recs []LoanCashSource
	if err := r.db.WithContext(ctx).Preload("Bank").Where("cash_movement_id IN ?", ids).Find(&recs).Error; err != nil {
		return out
	}
	for i := range recs {
		out[recs[i].CashMovementID] = &recs[i]
	}
	return out
}

func (r *LoanCashSourceRepository) FindByCashMovementID(ctx context.Context, cashMovementID uint) (*LoanCashSource, error) {
	var rec LoanCashSource
	if err := r.db.WithContext(ctx).Preload("Bank").Where("cash_movement_id = ?", cashMovementID).First(&rec).Error; err != nil {
		return nil, err
	}
	return &rec, nil
}

// NetByDay returns SUM(in) − SUM(out) per calendar day for movements with
// occurred_on in [from, to), keyed "YYYY-MM-DD". Days are bucketed in Go
// with the server's local time zone — the same startOfDay convention every
// other date filter in this file uses — rather than SQL DATE(), whose
// answer depends on the database session's time zone. Days with no
// movements are simply absent from the map.
func (r *MovementRepository) NetByDay(ctx context.Context, branchID *uint, from, to time.Time) (map[string]float64, error) {
	type row struct {
		Type       string
		Amount     float64
		OccurredOn time.Time
	}
	q := r.db.WithContext(ctx).Model(&CashMovement{}).
		Where("occurred_on >= ? AND occurred_on < ?", from, to)
	if branchID != nil {
		q = q.Where("branch_id = ?", *branchID)
	}
	var rows []row
	if err := q.Select("type, amount, occurred_on").Scan(&rows).Error; err != nil {
		return nil, err
	}
	out := map[string]float64{}
	for _, rw := range rows {
		key := rw.OccurredOn.In(time.Local).Format("2006-01-02")
		switch rw.Type {
		case "in":
			out[key] += rw.Amount
		case "out":
			out[key] -= rw.Amount
		}
	}
	return out, nil
}
