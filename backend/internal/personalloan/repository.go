package personalloan

import (
	"gorm.io/gorm"
	"gorm.io/gorm/clause"
)

// Repository provides GORM-backed persistence for PersonalLoan and its
// related installment/payment rows.
type Repository struct {
	db *gorm.DB
}

func NewRepository(db *gorm.DB) *Repository {
	return &Repository{db: db}
}

// DB exposes the underlying *gorm.DB so Service can run multi-step writes
// (create loan + schedule, renewal) inside one db.Transaction.
func (r *Repository) DB() *gorm.DB { return r.db }

func (r *Repository) Create(tx *gorm.DB, rec *PersonalLoan) error {
	return dbOrDefault(tx, r.db).Create(rec).Error
}

func (r *Repository) Update(tx *gorm.DB, rec *PersonalLoan) error {
	return dbOrDefault(tx, r.db).Save(rec).Error
}

// FindByID loads a loan, optionally scoped to a branch (nil = no scope, i.e.
// Administrator) — a mismatch is reported as gorm.ErrRecordNotFound so a
// non-admin can never learn another branch's loan even exists.
func (r *Repository) FindByID(id uint, branchID *uint) (*PersonalLoan, error) {
	var rec PersonalLoan
	q := r.db.Where("id = ?", id)
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
func (r *Repository) LockByID(tx *gorm.DB, id uint, branchID *uint) (*PersonalLoan, error) {
	var rec PersonalLoan
	q := tx.Clauses(clause.Locking{Strength: "UPDATE"}).Where("id = ?", id)
	if branchID != nil {
		q = q.Where("branch_id = ?", *branchID)
	}
	if err := q.First(&rec).Error; err != nil {
		return nil, err
	}
	return &rec, nil
}

// FindAll lists loans, newest first, optionally filtered by branch/customer/
// status.
func (r *Repository) FindAll(branchID *uint, customerID *uint, status string) ([]PersonalLoan, error) {
	var recs []PersonalLoan
	q := r.db.Order("id desc")
	if branchID != nil {
		q = q.Where("branch_id = ?", *branchID)
	}
	if customerID != nil {
		q = q.Where("customer_id = ?", *customerID)
	}
	if status != "" {
		q = q.Where("status = ?", status)
	}
	err := q.Find(&recs).Error
	return recs, err
}

// CountAll is used to generate the next sequential LoanNumber.
func (r *Repository) CountAll() (int64, error) {
	var count int64
	err := r.db.Unscoped().Model(&PersonalLoan{}).Count(&count).Error
	return count, err
}

func (r *Repository) CreateInstallments(tx *gorm.DB, recs []PersonalLoanInstallment) error {
	if len(recs) == 0 {
		return nil
	}
	return dbOrDefault(tx, r.db).Create(&recs).Error
}

func (r *Repository) FindInstallments(loanID uint) ([]PersonalLoanInstallment, error) {
	var recs []PersonalLoanInstallment
	err := r.db.Where("personal_loan_id = ?", loanID).Order("sequence_no asc").Find(&recs).Error
	return recs, err
}

func (r *Repository) UpdateInstallment(tx *gorm.DB, rec *PersonalLoanInstallment) error {
	return dbOrDefault(tx, r.db).Save(rec).Error
}

func (r *Repository) CreatePayment(tx *gorm.DB, rec *PersonalLoanPayment) error {
	return dbOrDefault(tx, r.db).Create(rec).Error
}

func (r *Repository) FindPayments(loanID uint) ([]PersonalLoanPayment, error) {
	var recs []PersonalLoanPayment
	err := r.db.Where("personal_loan_id = ?", loanID).Order("id asc").Find(&recs).Error
	return recs, err
}

// dbOrDefault returns tx if the caller supplied one (a write that must
// participate in an ongoing transaction), otherwise falls back to the
// repository's own db handle.
func dbOrDefault(tx *gorm.DB, fallback *gorm.DB) *gorm.DB {
	if tx != nil {
		return tx
	}
	return fallback
}
