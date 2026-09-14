package personalloan

import (
	"context"
	"time"

	"gorm.io/gorm"

	"cloudhouse/backend/internal/platform"
	"gorm.io/gorm/clause"
)

// Repository provides GORM-backed persistence for PersonalLoan and its
// related installment/payment rows.
type Repository struct {
	db platform.DB
}

func NewRepository(db platform.DB) *Repository {
	return &Repository{db: db}
}

// DB exposes the underlying *gorm.DB so Service can run multi-step writes
// (create loan + schedule, renewal) inside one db.Transaction.
func (r *Repository) DB() platform.DB { return r.db }

func (r *Repository) Create(ctx context.Context, tx *gorm.DB, rec *PersonalLoan) error {
	return dbOrDefault(ctx, tx, r.db).Create(rec).Error
}

func (r *Repository) Update(ctx context.Context, tx *gorm.DB, rec *PersonalLoan) error {
	return dbOrDefault(ctx, tx, r.db).Save(rec).Error
}

// FindByID loads a loan, optionally scoped to a branch (nil = no scope, i.e.
// Administrator) — a mismatch is reported as gorm.ErrRecordNotFound so a
// non-admin can never learn another branch's loan even exists. Preloads
// Customer/Branch since every caller (Get, used by the detail page and by
// GetSchedule/ListPayments's ownership check) needs the customer's name —
// GORM never loads an association unless asked.
func (r *Repository) FindByID(ctx context.Context, id uint, branchID *uint) (*PersonalLoan, error) {
	var rec PersonalLoan
	q := r.db.WithContext(ctx).Preload("Customer").Preload("Branch").Where("id = ?", id)
	if branchID != nil {
		q = q.Where("branch_id = ?", *branchID)
	}
	if err := q.First(&rec).Error; err != nil {
		return nil, err
	}
	return &rec, nil
}

// LockByID is FindByID's row-locking counterpart, used by RecordPayment and
// RenewLoan to serialize concurrent writers against the same loan. Must be
// called within tx (a db.Transaction).
func (r *Repository) LockByID(ctx context.Context, tx *gorm.DB, id uint, branchID *uint) (*PersonalLoan, error) {
	var rec PersonalLoan
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
	Frequency  string
	// Query matches LoanNumber or the customer's Name (case-insensitive,
	// partial) — needs a join to customers, only added when Query is set so
	// every other list call stays a plain single-table query.
	Query  string
	Limit  int
	Offset int
}

// FindAll lists loans, newest first, filtered per f, plus the TOTAL row
// count for f's filters (Limit/Offset ignored for that count) — 0 when
// f.Limit <= 0, matching customer.Repository.FindAll's shape. Preloads
// Customer for the same reason FindByID does — the list page and row
// components display the customer's name.
func (r *Repository) FindAll(ctx context.Context, f ListFilter) ([]PersonalLoan, int64, error) {
	var recs []PersonalLoan
	q := r.db.WithContext(ctx).Preload("Customer").Model(&PersonalLoan{}).Order("personal_loans.id desc")
	if f.BranchID != nil {
		q = q.Where("branch_id = ?", *f.BranchID)
	}
	if f.CustomerID != nil {
		q = q.Where("customer_id = ?", *f.CustomerID)
	}
	if f.Status != "" {
		q = q.Where("status = ?", f.Status)
	}
	if f.Frequency != "" {
		q = q.Where("frequency = ?", f.Frequency)
	}
	if f.Query != "" {
		like := "%" + f.Query + "%"
		q = q.Joins("JOIN customers ON customers.id = personal_loans.customer_id").
			Where("personal_loans.loan_number ILIKE ? OR customers.name ILIKE ?", like, like)
	}
	var total int64
	if f.Limit > 0 {
		if err := q.Session(&gorm.Session{}).Model(&PersonalLoan{}).Count(&total).Error; err != nil {
			return nil, 0, err
		}
		q = q.Limit(f.Limit + 1).Offset(f.Offset)
	}
	err := q.Find(&recs).Error
	return recs, total, err
}

// CountAll is used to generate the next sequential LoanNumber.
func (r *Repository) CountAll(ctx context.Context) (int64, error) {
	var count int64
	err := r.db.WithContext(ctx).Unscoped().Model(&PersonalLoan{}).Count(&count).Error
	return count, err
}

func (r *Repository) CreateInstallments(ctx context.Context, tx *gorm.DB, recs []PersonalLoanInstallment) error {
	if len(recs) == 0 {
		return nil
	}
	return dbOrDefault(ctx, tx, r.db).Create(&recs).Error
}

// FindInstallments returns one page of a loan's schedule, ordered by
// SequenceNo. Fetches limit+1 rows so the service can cheaply report
// hasMore without a separate COUNT query (see customer.Handler.List's same
// trick).
func (r *Repository) FindInstallments(ctx context.Context, loanID uint, limit, offset int) ([]PersonalLoanInstallment, error) {
	var recs []PersonalLoanInstallment
	err := r.db.WithContext(ctx).Where("personal_loan_id = ?", loanID).Order("sequence_no asc").
		Limit(limit + 1).Offset(offset).Find(&recs).Error
	return recs, err
}

func (r *Repository) UpdateInstallment(ctx context.Context, tx *gorm.DB, rec *PersonalLoanInstallment) error {
	return dbOrDefault(ctx, tx, r.db).Save(rec).Error
}

func (r *Repository) CreatePayment(ctx context.Context, tx *gorm.DB, rec *PersonalLoanPayment) error {
	return dbOrDefault(ctx, tx, r.db).Create(rec).Error
}

// FindPayments returns one page of a loan's payment ledger, newest first
// (most recently collected payment on top, matching what staff want to see
// first) — limit+1 rows for the same cheap hasMore trick as FindInstallments.
func (r *Repository) FindPayments(ctx context.Context, loanID uint, limit, offset int) ([]PersonalLoanPayment, error) {
	var recs []PersonalLoanPayment
	err := r.db.WithContext(ctx).Where("personal_loan_id = ?", loanID).Order("id desc").
		Limit(limit + 1).Offset(offset).Find(&recs).Error
	return recs, err
}

// CalendarInstallment is one pending installment joined with its loan and
// customer — just enough for the reminder calendar to show "who owes what,
// when" without pulling in the full PersonalLoan/Customer structs (see
// reminder.Service.GetCalendarEvents).
type CalendarInstallment struct {
	LoanID       uint
	LoanNumber   string
	CustomerID   uint
	CustomerName string
	BranchID     uint
	DueDate      time.Time
	Amount       float64
}

// FindPendingInstallmentsForCalendar returns every not-yet-fully-paid
// installment (Pending or PartiallyPaid) belonging to a currently Active
// loan, optionally branch-scoped — the source data for the reminder
// calendar's personal-loan due/overdue events. Unlike FindInstallments this
// is not paginated: the calendar needs every open due date at once to
// bucket them by day.
func (r *Repository) FindPendingInstallmentsForCalendar(ctx context.Context, branchID *uint) ([]CalendarInstallment, error) {
	var rows []CalendarInstallment
	q := r.db.WithContext(ctx).Table("personal_loan_installments").
		Select("personal_loan_installments.due_date AS due_date, personal_loan_installments.amount AS amount, "+
			"personal_loans.id AS loan_id, personal_loans.loan_number AS loan_number, "+
			"personal_loans.customer_id AS customer_id, customers.name AS customer_name, "+
			"personal_loans.branch_id AS branch_id").
		Joins("JOIN personal_loans ON personal_loans.id = personal_loan_installments.personal_loan_id").
		Joins("JOIN customers ON customers.id = personal_loans.customer_id").
		Where("personal_loan_installments.status <> ?", InstallmentStatusPaid).
		Where("personal_loans.status = ?", StatusActive)
	if branchID != nil {
		q = q.Where("personal_loans.branch_id = ?", *branchID)
	}
	err := q.Scan(&rows).Error
	return rows, err
}

// dbOrDefault returns tx if the caller supplied one (a write that must
// participate in an ongoing transaction), otherwise falls back to the
// repository's own db handle scoped to ctx.
func dbOrDefault(ctx context.Context, tx *gorm.DB, fallback platform.DB) *gorm.DB {
	if tx != nil {
		return tx.WithContext(ctx)
	}
	return fallback.WithContext(ctx)
}
