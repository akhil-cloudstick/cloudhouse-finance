package employee

import (
	"time"

	"gorm.io/gorm"
)

// Repository provides GORM-backed persistence for Employee records.
type Repository struct {
	db *gorm.DB
}

func NewRepository(db *gorm.DB) *Repository {
	return &Repository{db: db}
}

func (r *Repository) Create(e *Employee) error {
	return r.db.Create(e).Error
}

func (r *Repository) FindAll() ([]Employee, error) {
	var employees []Employee
	err := r.db.Preload("Branch").Order("id asc").Find(&employees).Error
	return employees, err
}

func (r *Repository) FindByID(id uint) (*Employee, error) {
	var e Employee
	if err := r.db.Preload("Branch").First(&e, id).Error; err != nil {
		return nil, err
	}
	return &e, nil
}

func (r *Repository) Update(e *Employee) error {
	return r.db.Save(e).Error
}

func (r *Repository) Delete(id uint) error {
	return r.db.Delete(&Employee{}, id).Error
}

// CountAll returns the total number of employees ever created (including
// soft-deleted ones), used to generate sequential Code values.
func (r *Repository) CountAll() (int64, error) {
	var count int64
	err := r.db.Unscoped().Model(&Employee{}).Count(&count).Error
	return count, err
}

// FindByEmail looks up an employee by exact (case-insensitive) email match.
// Used by internal/auth for login/forgot-password. Returns
// gorm.ErrRecordNotFound (via err) when no row matches or email is blank.
func (r *Repository) FindByEmail(email string) (*Employee, error) {
	var e Employee
	if email == "" {
		return nil, gorm.ErrRecordNotFound
	}
	if err := r.db.Preload("Branch").Where("email = ?", email).First(&e).Error; err != nil {
		return nil, err
	}
	return &e, nil
}

// FindByResetTokenHash looks up an employee whose password-reset token hash
// matches and whose expiry is still in the future. Used by
// internal/auth.ResetPassword.
func (r *Repository) FindByResetTokenHash(tokenHash string) (*Employee, error) {
	var e Employee
	if err := r.db.Where("password_reset_token_hash = ? AND password_reset_expires_at > ?", tokenHash, time.Now()).First(&e).Error; err != nil {
		return nil, err
	}
	return &e, nil
}
