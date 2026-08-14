package cash

import (
	"strings"
	"time"

	"gorm.io/gorm"
)

// MovementRepository provides GORM-backed persistence for CashMovement records.
type MovementRepository struct {
	db *gorm.DB
}

func NewMovementRepository(db *gorm.DB) *MovementRepository {
	return &MovementRepository{db: db}
}

func (r *MovementRepository) Create(m *CashMovement) error {
	return r.db.Create(m).Error
}

// FindAll returns cash movements, optionally scoped to a single branch —
// pass nil for an Administrator's unfiltered "all branches" view, or a
// non-nil pointer to confine results to that branch (see
// platform.GetBranchScope).
func (r *MovementRepository) FindAll(branchID *uint) ([]CashMovement, error) {
	var movements []CashMovement
	q := r.db.Preload("Branch").Order("occurred_on desc, id desc")
	if branchID != nil {
		q = q.Where("branch_id = ?", *branchID)
	}
	err := q.Find(&movements).Error
	return movements, err
}

func (r *MovementRepository) FindByID(id uint) (*CashMovement, error) {
	var m CashMovement
	if err := r.db.Preload("Branch").First(&m, id).Error; err != nil {
		return nil, err
	}
	return &m, nil
}

func (r *MovementRepository) Update(m *CashMovement) error {
	return r.db.Save(m).Error
}

func (r *MovementRepository) Delete(id uint) error {
	return r.db.Delete(&CashMovement{}, id).Error
}

// ExpenseRepository provides GORM-backed persistence for Expense records.
type ExpenseRepository struct {
	db *gorm.DB
}

func NewExpenseRepository(db *gorm.DB) *ExpenseRepository {
	return &ExpenseRepository{db: db}
}

func (r *ExpenseRepository) Create(e *Expense) error {
	return r.db.Create(e).Error
}

// FindAll returns expenses, optionally scoped to a single branch — pass nil
// for an Administrator's unfiltered "all branches" view, or a non-nil
// pointer to confine results to that branch (see platform.GetBranchScope).
func (r *ExpenseRepository) FindAll(branchID *uint) ([]Expense, error) {
	var expenses []Expense
	q := r.db.Preload("Branch").Order("occurred_on desc, id desc")
	if branchID != nil {
		q = q.Where("branch_id = ?", *branchID)
	}
	err := q.Find(&expenses).Error
	return expenses, err
}

func (r *ExpenseRepository) FindByID(id uint) (*Expense, error) {
	var e Expense
	if err := r.db.Preload("Branch").First(&e, id).Error; err != nil {
		return nil, err
	}
	return &e, nil
}

func (r *ExpenseRepository) Update(e *Expense) error {
	return r.db.Save(e).Error
}

// SumCashByDate sums Cash-mode, non-rejected expense amounts for the given
// day (and branch, if provided) — the figure that automatically reduces
// Expected Cash in Hand.
func (r *ExpenseRepository) SumCashByDate(branchID *uint, date time.Time) (float64, error) {
	q := r.db.Model(&Expense{}).
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
func (r *ExpenseRepository) SumAllByDate(branchID *uint, date time.Time) (float64, error) {
	q := r.db.Model(&Expense{}).
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
func (r *MovementRepository) SumByTypeAndDate(branchID *uint, date time.Time) (in float64, out float64, err error) {
	type row struct {
		Type string
		Sum  float64
	}
	q := r.db.Model(&CashMovement{}).
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
	TopUps   float64 `json:"topUps"` // Source == "Savings" | "Loan" (manual "Add Cash")
}

type CashOutBreakdown struct {
	LoanDisbursements float64 `json:"loanDisbursements"` // Purpose starts with "Loan disbursement — "
	BankReleases      float64 `json:"bankReleases"`      // Purpose starts with "Bank pledge release — "
	// AuctionRefunds is Purpose starting with "Auction surplus refunded" —
	// surplus handed back to a customer after their gold sold for more than
	// they owed. Kept out of Withdrawals so a refund owed to a customer is not
	// reported as the branch taking cash out for itself.
	AuctionRefunds float64 `json:"auctionRefunds"`
	Withdrawals    float64 `json:"withdrawals"` // everything else (manual "Take Cash Out")
}

// SumBreakdownByDate buckets every cash movement for the given day (and
// branch, if provided) by its source/purpose, in Go rather than SQL — the
// bucketing rules mirror the Purpose prefixes set by
// MovementService.RecordLoanDisbursementCashOut/RecordBankPledgeCashOut and
// the Source values set by RecordBankPledgeCashIn/RecordLoanPaymentCashIn,
// so keeping them together as plain string comparisons here (rather than a
// harder-to-follow SQL CASE) keeps the two in sync at a glance.
func (r *MovementRepository) SumBreakdownByDate(branchID *uint, date time.Time) (CashInBreakdown, CashOutBreakdown, error) {
	type row struct {
		Type    string
		Source  string
		Purpose string
		Amount  float64
	}
	q := r.db.Model(&CashMovement{}).
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
	db *gorm.DB
}

func NewOpeningBalanceRepository(db *gorm.DB) *OpeningBalanceRepository {
	return &OpeningBalanceRepository{db: db}
}

func (r *OpeningBalanceRepository) FindByBranchAndDate(branchID uint, date time.Time) (*OpeningCashBalance, error) {
	var rec OpeningCashBalance
	err := r.db.Where("branch_id = ? AND balance_date = ?", branchID, startOfDay(date)).First(&rec).Error
	if err != nil {
		return nil, err
	}
	return &rec, nil
}

// Upsert creates or updates the opening balance for rec's (BranchID, BalanceDate).
func (r *OpeningBalanceRepository) Upsert(rec *OpeningCashBalance) error {
	rec.BalanceDate = startOfDay(rec.BalanceDate)
	existing, err := r.FindByBranchAndDate(rec.BranchID, rec.BalanceDate)
	if err == nil {
		existing.Amount = rec.Amount
		if err := r.db.Save(existing).Error; err != nil {
			return err
		}
		*rec = *existing
		return nil
	}
	if err != gorm.ErrRecordNotFound {
		return err
	}
	return r.db.Create(rec).Error
}
