package reminder

import (
	"context"
	"time"

	"gorm.io/gorm"

	"cloudhouse/backend/internal/platform"
)

// Repository provides GORM-backed persistence for Reminder records.
type Repository struct {
	db platform.DB
}

func NewRepository(db platform.DB) *Repository {
	return &Repository{db: db}
}

func (r *Repository) Create(ctx context.Context, rem *Reminder) error {
	return r.db.WithContext(ctx).Create(rem).Error
}

func (r *Repository) Update(ctx context.Context, rem *Reminder) error {
	return r.db.WithContext(ctx).Save(rem).Error
}

func (r *Repository) Delete(ctx context.Context, id uint) error {
	return r.db.WithContext(ctx).Delete(&Reminder{}, id).Error
}

func (r *Repository) FindByID(ctx context.Context, id uint) (*Reminder, error) {
	var rem Reminder
	if err := r.db.WithContext(ctx).Preload("Customer").First(&rem, id).Error; err != nil {
		return nil, err
	}
	return &rem, nil
}

// Filter narrows FindAll's results; zero-value fields are ignored.
type Filter struct {
	CustomerID uint
	LoanID     uint
	Status     string
	From       *time.Time // DueDate >= From
	To         *time.Time // DueDate <= To

	// BranchID, when non-nil, scopes results to reminders whose Customer
	// belongs to that branch (Reminder has no branch_id column of its own).
	BranchID *uint

	// Query, when set, matches the customer's name/code or the linked
	// loan's number (case-insensitive, partial). The loan is LEFT JOINed
	// since a reminder need not be tied to a loan at all.
	Query string

	// Limit/Offset paginate the result set; Limit <= 0 means "no limit"
	// (the bare-array listing existing callers rely on).
	Limit  int
	Offset int
}

// FindAll returns matching reminders plus the TOTAL row count for f's
// filters (Limit/Offset ignored, 0 when f.Limit <= 0). Every reminders
// column is table-qualified since the Query search joins loans, which has
// its own due_date/status columns.
func (r *Repository) FindAll(ctx context.Context, f Filter) ([]Reminder, int64, error) {
	q := r.db.WithContext(ctx).Preload("Customer").Model(&Reminder{}).Order("reminders.due_date asc, reminders.id asc")
	if f.BranchID != nil || f.Query != "" {
		q = q.Joins("JOIN customers ON customers.id = reminders.customer_id")
	}
	if f.BranchID != nil {
		q = q.Where("customers.branch_id = ?", *f.BranchID)
	}
	if f.Query != "" {
		like := "%" + f.Query + "%"
		q = q.Joins("LEFT JOIN loans ON loans.id = reminders.loan_id").
			Where("customers.name ILIKE ? OR customers.code ILIKE ? OR loans.loan_number ILIKE ?", like, like, like)
	}
	if f.CustomerID != 0 {
		q = q.Where("reminders.customer_id = ?", f.CustomerID)
	}
	if f.LoanID != 0 {
		q = q.Where("reminders.loan_id = ?", f.LoanID)
	}
	if f.Status != "" {
		q = q.Where("reminders.status = ?", f.Status)
	}
	if f.From != nil {
		q = q.Where("reminders.due_date >= ?", *f.From)
	}
	if f.To != nil {
		q = q.Where("reminders.due_date <= ?", *f.To)
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
	var reminders []Reminder
	err := q.Find(&reminders).Error
	return reminders, total, err
}
