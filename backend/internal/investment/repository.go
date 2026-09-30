package investment

import (
	"context"
	"time"

	"gorm.io/gorm"

	"cloudhouse/backend/internal/platform"
	"gorm.io/gorm/clause"
)

// Repository provides GORM-backed persistence for InvestmentPlan,
// Investment and InvestmentPayout.
type Repository struct {
	db platform.DB
}

func NewRepository(db platform.DB) *Repository {
	return &Repository{db: db}
}

// DB exposes the underlying *gorm.DB so Service can run multi-step writes
// (create investment + schedule, maturity decisions) inside one
// db.Transaction — mirrors personalloan.Repository.DB.
func (r *Repository) DB() platform.DB { return r.db }

// --- Plans ---

func (r *Repository) CreatePlan(ctx context.Context, rec *InvestmentPlan) error {
	return r.db.WithContext(ctx).Create(rec).Error
}

func (r *Repository) UpdatePlan(ctx context.Context, rec *InvestmentPlan) error {
	return r.db.WithContext(ctx).Save(rec).Error
}

func (r *Repository) FindPlanByID(ctx context.Context, id uint) (*InvestmentPlan, error) {
	var rec InvestmentPlan
	if err := r.db.WithContext(ctx).First(&rec, id).Error; err != nil {
		return nil, err
	}
	return &rec, nil
}

// FindAllPlans lists plans, newest first; activeOnly restricts to
// IsActive plans (used when populating the "pick a plan" list for a new
// investment — a retired plan must still be readable by ID for existing
// investments, just not offered for new ones).
//
// search, when non-empty, matches the plan name (case-insensitive,
// partial). limit > 0 applies Limit/Offset and reports the TOTAL match
// count (0 when limit <= 0, where every matching plan is returned).
func (r *Repository) FindAllPlans(ctx context.Context, activeOnly bool, search string, limit, offset int) ([]InvestmentPlan, int64, error) {
	var recs []InvestmentPlan
	q := r.db.WithContext(ctx).Model(&InvestmentPlan{}).Order("id desc")
	if activeOnly {
		q = q.Where("is_active = ?", true)
	}
	if search != "" {
		q = q.Where("name ILIKE ?", "%"+search+"%")
	}
	var total int64
	if limit > 0 {
		if err := q.Session(&gorm.Session{}).Count(&total).Error; err != nil {
			return nil, 0, err
		}
		q = q.Limit(limit).Offset(offset)
	}
	err := q.Find(&recs).Error
	return recs, total, err
}

// --- Investments ---

func (r *Repository) Create(ctx context.Context, tx *gorm.DB, rec *Investment) error {
	return dbOrDefault(ctx, tx, r.db).Create(rec).Error
}

func (r *Repository) Update(ctx context.Context, tx *gorm.DB, rec *Investment) error {
	return dbOrDefault(ctx, tx, r.db).Save(rec).Error
}

// FindByID loads an investment, optionally scoped to a branch (nil = no
// scope, i.e. Administrator) — mirrors personalloan.Repository.FindByID's
// not-found-on-mismatch behavior. Preloads Customer/Branch/Plan since every
// caller needs the investor's name and plan terms.
func (r *Repository) FindByID(ctx context.Context, id uint, branchID *uint) (*Investment, error) {
	var rec Investment
	q := r.db.WithContext(ctx).Preload("Customer").Preload("Branch").Preload("Plan").Where("id = ?", id)
	if branchID != nil {
		q = q.Where("branch_id = ?", *branchID)
	}
	if err := q.First(&rec).Error; err != nil {
		return nil, err
	}
	return &rec, nil
}

// FindIDByNumber resolves an investment number ("INV-00003") to its ID,
// branch-scoped like FindByID — lets a ledger reference link straight to
// the investment.
func (r *Repository) FindIDByNumber(ctx context.Context, number string, branchID *uint) (uint, error) {
	var rec Investment
	q := r.db.WithContext(ctx).Select("id").Where("investment_number = ?", number)
	if branchID != nil {
		q = q.Where("branch_id = ?", *branchID)
	}
	if err := q.First(&rec).Error; err != nil {
		return 0, err
	}
	return rec.ID, nil
}

// LockByID is FindByID's row-locking counterpart, used by MarkPayoutPaid
// and MatureInvestment to serialize concurrent writers — mirrors
// personalloan.Repository.LockByID. Must be called within tx.
func (r *Repository) LockByID(ctx context.Context, tx *gorm.DB, id uint, branchID *uint) (*Investment, error) {
	var rec Investment
	q := tx.WithContext(ctx).Clauses(clause.Locking{Strength: "UPDATE"}).Where("id = ?", id)
	if branchID != nil {
		q = q.Where("branch_id = ?", *branchID)
	}
	if err := q.First(&rec).Error; err != nil {
		return nil, err
	}
	return &rec, nil
}

// ListFilter narrows FindAll's results; zero-value fields are ignored.
type ListFilter struct {
	BranchID   *uint
	CustomerID *uint
	Status     string
	Query      string // matches InvestmentNumber or the customer's Name/Code
	Limit      int
	Offset     int
}

// FindAll lists investments, newest first, filtered per f, plus the TOTAL
// row count for f's filters (Limit/Offset ignored for that count) — 0 when
// f.Limit <= 0 — mirrors personalloan.Repository.FindAll, including its
// Limit+1/hasMore trick.
func (r *Repository) FindAll(ctx context.Context, f ListFilter) ([]Investment, int64, error) {
	var recs []Investment
	q := r.db.WithContext(ctx).Preload("Customer").Preload("Plan").Model(&Investment{}).Order("investments.id desc")
	// Columns are table-qualified: the Query search JOINs customers, which
	// has its own branch_id, so an unqualified branch_id was ambiguous.
	if f.BranchID != nil {
		q = q.Where("investments.branch_id = ?", *f.BranchID)
	}
	if f.CustomerID != nil {
		q = q.Where("investments.customer_id = ?", *f.CustomerID)
	}
	if f.Status != "" {
		q = q.Where("investments.status = ?", f.Status)
	}
	if f.Query != "" {
		like := "%" + f.Query + "%"
		q = q.Joins("JOIN customers ON customers.id = investments.customer_id").
			Where("investments.investment_number ILIKE ? OR customers.name ILIKE ? OR customers.code ILIKE ?", like, like, like)
	}
	var total int64
	if f.Limit > 0 {
		if err := q.Session(&gorm.Session{}).Model(&Investment{}).Count(&total).Error; err != nil {
			return nil, 0, err
		}
		q = q.Limit(f.Limit + 1).Offset(f.Offset)
	}
	err := q.Find(&recs).Error
	return recs, total, err
}

// CountAll is used to generate the next sequential InvestmentNumber.
func (r *Repository) CountAll(ctx context.Context) (int64, error) {
	var count int64
	err := r.db.WithContext(ctx).Unscoped().Model(&Investment{}).Count(&count).Error
	return count, err
}

// FindDueForMaturitySweep returns every Active investment whose
// MaturityDate has passed — the background job's input for flagging
// Matured (see Service.SweepMaturities). Never returns anything already
// Matured/Closed/Renewed, so the sweep is naturally idempotent.
func (r *Repository) FindDueForMaturitySweep(ctx context.Context, asOf time.Time) ([]Investment, error) {
	var recs []Investment
	err := r.db.WithContext(ctx).Where("status = ? AND maturity_date <= ?", StatusActive, asOf).Find(&recs).Error
	return recs, err
}

// --- Payouts ---

func (r *Repository) CreatePayouts(ctx context.Context, tx *gorm.DB, recs []InvestmentPayout) error {
	if len(recs) == 0 {
		return nil
	}
	return dbOrDefault(ctx, tx, r.db).Create(&recs).Error
}

// FindPayouts returns one page of an investment's payout schedule, ordered
// by SequenceNo — mirrors personalloan.Repository.FindInstallments.
func (r *Repository) FindPayouts(ctx context.Context, investmentID uint, limit, offset int) ([]InvestmentPayout, error) {
	var recs []InvestmentPayout
	err := r.db.WithContext(ctx).Where("investment_id = ?", investmentID).Order("sequence_no asc").
		Limit(limit + 1).Offset(offset).Find(&recs).Error
	return recs, err
}

// FindPayoutByID loads a single payout row (no branch scoping of its
// own — callers first load/lock the parent Investment, which IS
// branch-scoped, then use this to fetch the specific row).
func (r *Repository) FindPayoutByID(ctx context.Context, id uint) (*InvestmentPayout, error) {
	var rec InvestmentPayout
	if err := r.db.WithContext(ctx).First(&rec, id).Error; err != nil {
		return nil, err
	}
	return &rec, nil
}

// LockPayoutByID is FindPayoutByID's row-locking counterpart, used by
// MarkPayoutPaid within the same transaction as the parent investment's
// lock.
func (r *Repository) LockPayoutByID(ctx context.Context, tx *gorm.DB, id uint) (*InvestmentPayout, error) {
	var rec InvestmentPayout
	if err := tx.WithContext(ctx).Clauses(clause.Locking{Strength: "UPDATE"}).First(&rec, id).Error; err != nil {
		return nil, err
	}
	return &rec, nil
}

func (r *Repository) UpdatePayout(ctx context.Context, tx *gorm.DB, rec *InvestmentPayout) error {
	return dbOrDefault(ctx, tx, r.db).Save(rec).Error
}

// AppendPayout adds one extra payout row inside tx — used by
// MatureInvestment's Close path to append the final principal-return row.
func (r *Repository) AppendPayout(ctx context.Context, tx *gorm.DB, rec *InvestmentPayout) error {
	return dbOrDefault(ctx, tx, r.db).Create(rec).Error
}

// CalendarPayout is one pending payout joined with its investment and
// investor — just enough for the reminder calendar to show "who is owed
// what, when" (mirrors personalloan.Repository.CalendarInstallment /
// FindPendingInstallmentsForCalendar).
type CalendarPayout struct {
	InvestmentID     uint
	InvestmentNumber string
	CustomerID       uint
	CustomerName     string
	BranchID         uint
	DueDate          time.Time
	Amount           float64
}

// FindPendingPayoutsForCalendar returns every not-yet-paid payout belonging
// to an Active or Matured investment (a Matured investment can still have
// a pending final payout awaiting the admin's Close decision), optionally
// branch-scoped.
func (r *Repository) FindPendingPayoutsForCalendar(ctx context.Context, branchID *uint) ([]CalendarPayout, error) {
	var rows []CalendarPayout
	q := r.db.WithContext(ctx).Table("investment_payouts").
		Select("investment_payouts.due_date AS due_date, investment_payouts.amount AS amount, "+
			"investments.id AS investment_id, investments.investment_number AS investment_number, "+
			"investments.customer_id AS customer_id, customers.name AS customer_name, "+
			"investments.branch_id AS branch_id").
		Joins("JOIN investments ON investments.id = investment_payouts.investment_id").
		Joins("JOIN customers ON customers.id = investments.customer_id").
		Where("investment_payouts.status = ?", PayoutStatusPending).
		Where("investments.status IN ?", []string{StatusActive, StatusMatured})
	if branchID != nil {
		q = q.Where("investments.branch_id = ?", *branchID)
	}
	err := q.Scan(&rows).Error
	return rows, err
}

// --- Transactions (Live engine ledger) ---

func (r *Repository) CreateTransaction(ctx context.Context, tx *gorm.DB, rec *InvestmentTransaction) error {
	return dbOrDefault(ctx, tx, r.db).Create(rec).Error
}

func (r *Repository) UpdateTransaction(ctx context.Context, tx *gorm.DB, rec *InvestmentTransaction) error {
	return dbOrDefault(ctx, tx, r.db).Save(rec).Error
}

// FindTransactions returns one page of an investment's ledger, newest
// first — mirrors FindPayouts' Limit+1/hasMore shape.
func (r *Repository) FindTransactions(ctx context.Context, investmentID uint, limit, offset int) ([]InvestmentTransaction, error) {
	var recs []InvestmentTransaction
	err := r.db.WithContext(ctx).Where("investment_id = ?", investmentID).
		Order("occurred_on desc, id desc").Limit(limit + 1).Offset(offset).Find(&recs).Error
	return recs, err
}

// FindAllTransactions returns every transaction on an investment, oldest
// first — the ledger's order (see Service.GetLedger).
func (r *Repository) FindAllTransactions(ctx context.Context, investmentID uint) ([]InvestmentTransaction, error) {
	var recs []InvestmentTransaction
	err := r.db.WithContext(ctx).Where("investment_id = ?", investmentID).
		Order("occurred_on asc, id asc").Find(&recs).Error
	return recs, err
}

// FindPaidPayouts returns every Paid payout on an investment, in schedule
// order — the Schedule engine's ledger rows (see Service.GetLedger).
func (r *Repository) FindPaidPayouts(ctx context.Context, investmentID uint) ([]InvestmentPayout, error) {
	var recs []InvestmentPayout
	err := r.db.WithContext(ctx).Where("investment_id = ? AND status = ?", investmentID, PayoutStatusPaid).
		Order("sequence_no asc").Find(&recs).Error
	return recs, err
}

// dbOrDefault returns tx if the caller supplied one (a write that must
// participate in an ongoing transaction), otherwise falls back to the
// repository's own db handle scoped to ctx — mirrors
// personalloan.Repository's identical helper.
func dbOrDefault(ctx context.Context, tx *gorm.DB, fallback platform.DB) *gorm.DB {
	if tx != nil {
		return tx.WithContext(ctx)
	}
	return fallback.WithContext(ctx)
}
