package reminder

import (
	"context"
	"time"

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
}

func (r *Repository) FindAll(ctx context.Context, f Filter) ([]Reminder, error) {
	q := r.db.WithContext(ctx).Preload("Customer").Model(&Reminder{}).Order("due_date asc")
	if f.BranchID != nil {
		q = q.Joins("JOIN customers ON customers.id = reminders.customer_id").Where("customers.branch_id = ?", *f.BranchID)
	}
	if f.CustomerID != 0 {
		q = q.Where("customer_id = ?", f.CustomerID)
	}
	if f.LoanID != 0 {
		q = q.Where("loan_id = ?", f.LoanID)
	}
	if f.Status != "" {
		q = q.Where("status = ?", f.Status)
	}
	if f.From != nil {
		q = q.Where("due_date >= ?", *f.From)
	}
	if f.To != nil {
		q = q.Where("due_date <= ?", *f.To)
	}
	var reminders []Reminder
	err := q.Find(&reminders).Error
	return reminders, err
}
