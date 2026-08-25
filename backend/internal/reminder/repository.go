package reminder

import (
	"time"

	"gorm.io/gorm"
)

// Repository provides GORM-backed persistence for Reminder records.
type Repository struct {
	db *gorm.DB
}

func NewRepository(db *gorm.DB) *Repository {
	return &Repository{db: db}
}

func (r *Repository) Create(rem *Reminder) error {
	return r.db.Create(rem).Error
}

func (r *Repository) Update(rem *Reminder) error {
	return r.db.Save(rem).Error
}

func (r *Repository) Delete(id uint) error {
	return r.db.Delete(&Reminder{}, id).Error
}

func (r *Repository) FindByID(id uint) (*Reminder, error) {
	var rem Reminder
	if err := r.db.Preload("Customer").First(&rem, id).Error; err != nil {
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

func (r *Repository) FindAll(f Filter) ([]Reminder, error) {
	q := r.db.Preload("Customer").Model(&Reminder{}).Order("due_date asc")
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
