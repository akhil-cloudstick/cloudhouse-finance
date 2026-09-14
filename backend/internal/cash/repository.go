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
	CategoryLoan       = "loan"       // Source == "Loan" (manual top-up) OR Purpose starts with "Loan disbursement — "
	CategoryAuction    = "auction"    // Source == "Auction" OR Purpose starts with "Auction surplus refunded"
	CategoryCollection = "collection" // Source == "Collection" (loan repayments)
	CategoryExpenses   = "expenses"   // everything else type=out that isn't Loan/Auction/Bank — the informal "Take Cash Out" bucket (CashOutBreakdown.Withdrawals)
)

// FindAll returns cash movements, optionally scoped to a single branch —
// pass nil for an Administrator's unfiltered "all branches" view, or a
// non-nil pointer to confine results to that branch (see
// platform.GetBranchScope) — optionally bounded to [fromDate, toDate] on
// occurred_on (either end left zero-value means "no bound" on that side),
// and optionally narrowed to one of the Category* buckets above. limit <= 0
// returns every matching row unpaginated (used by the CSV export handlers,
// which must never be capped to whatever page size the table itself is
// currently showing).
func (r *MovementRepository) FindAll(ctx context.Context, branchID *uint, fromDate, toDate time.Time, category string, limit, offset int) ([]CashMovement, int64, error) {
	var movements []CashMovement
	q := r.db.WithContext(ctx).Preload("Branch").Order("occurred_on desc, id desc")
	if branchID != nil {
		q = q.Where("branch_id = ?", *branchID)
	}
	if !fromDate.IsZero() {
		q = q.Where("occurred_on >= ?", fromDate)
	}
	if !toDate.IsZero() {
		q = q.Where("occurred_on < ?", toDate.AddDate(0, 0, 1))
	}
	switch category {
	case CategoryLoan:
		q = q.Where("source = ? OR purpose LIKE ?", "Loan", "Loan disbursement — %")
	case CategoryAuction:
		q = q.Where("source = ? OR purpose LIKE ?", "Auction", "Auction surplus refunded%")
	case CategoryCollection:
		q = q.Where("source = ?", "Collection")
	case CategoryExpenses:
		q = q.Where(
			"type = ? AND source IS DISTINCT FROM ? AND source IS DISTINCT FROM ? AND (purpose IS NULL OR (purpose NOT LIKE ? AND purpose NOT LIKE ? AND purpose NOT LIKE ?))",
			"out", "Loan", "Auction", "Loan disbursement — %", "Auction surplus refunded%", "Bank pledge release — %",
		)
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
func (r *ExpenseRepository) FindAll(ctx context.Context, branchID *uint, limit, offset int) ([]Expense, int64, error) {
	var expenses []Expense
	q := r.db.WithContext(ctx).Preload("Branch").Order("occurred_on desc, id desc")
	if branchID != nil {
		q = q.Where("branch_id = ?", *branchID)
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
	q := r.db.WithContext(ctx).Model(&Expense{}).
		Where("mode = ?", "Cash").
		Where("status <> ?", "Rejected").
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

// SumAllByDate sums every non-rejected expense amount (any Mode) for the
// given day (and branch, if provided) — the all-modes total shown next to
// SumCashByDate's Cash-only figure so the frontend can display both without
// having to re-derive one from the unscoped expense list.
func (r *ExpenseRepository) SumAllByDate(ctx context.Context, branchID *uint, date time.Time) (float64, error) {
	q := r.db.WithContext(ctx).Model(&Expense{}).
		Where("status <> ?", "Rejected").
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
	type row struct {
		Type string
		Sum  float64
	}
	q := r.db.WithContext(ctx).Model(&CashMovement{}).
		Where("occurred_on >= ? AND occurred_on < ?", startOfDay(date), startOfDay(date).AddDate(0, 0, 1))
	if branchID != nil {
		q = q.Where("branch_id = ?", *branchID)
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
	q := r.db.WithContext(ctx).Model(&CashMovement{}).
		Where("occurred_on >= ? AND occurred_on < ?", startOfDay(date), startOfDay(date).AddDate(0, 0, 1))
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

func (r *OpeningBalanceRepository) FindByBranchAndDate(ctx context.Context, branchID uint, date time.Time) (*OpeningCashBalance, error) {
	var rec OpeningCashBalance
	err := r.db.WithContext(ctx).Where("branch_id = ? AND balance_date = ?", branchID, startOfDay(date)).First(&rec).Error
	if err != nil {
		return nil, err
	}
	return &rec, nil
}

// Upsert creates or updates the opening balance for rec's (BranchID, BalanceDate).
func (r *OpeningBalanceRepository) Upsert(ctx context.Context, rec *OpeningCashBalance) error {
	rec.BalanceDate = startOfDay(rec.BalanceDate)
	existing, err := r.FindByBranchAndDate(ctx, rec.BranchID, rec.BalanceDate)
	if err == nil {
		existing.Amount = rec.Amount
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
	if err := r.db.WithContext(ctx).Preload("Branch").First(&rec, id).Error; err != nil {
		return nil, err
	}
	return &rec, nil
}

// FindAll returns gold sales, optionally scoped to a single branch (nil for
// an Administrator's unfiltered "all branches" view — see
// platform.GetBranchScope) and bounded to [fromDate, toDate] on sold_on;
// either end left zero-value means "no bound" on that side, same convention
// as MovementRepository.FindAll.
func (r *GoldSaleRepository) FindAll(ctx context.Context, branchID *uint, fromDate, toDate time.Time, limit, offset int) ([]GoldSale, int64, error) {
	var sales []GoldSale
	q := r.db.WithContext(ctx).Preload("Branch").Order("sold_on desc, id desc")
	if branchID != nil {
		q = q.Where("branch_id = ?", *branchID)
	}
	if !fromDate.IsZero() {
		q = q.Where("sold_on >= ?", fromDate)
	}
	if !toDate.IsZero() {
		q = q.Where("sold_on < ?", toDate.AddDate(0, 0, 1))
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
