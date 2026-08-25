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

// FindAll returns employees, optionally scoped to a single branch — pass
// nil for an Administrator's unfiltered "all branches" view, or a non-nil
// pointer to confine results to that branch (see platform.GetBranchScope).
// limit/offset paginate the result set; limit <= 0 means "no limit" (the
// full result set, preserving existing bare-array callers).
func (r *Repository) FindAll(branchID *uint, limit, offset int) ([]Employee, error) {
	var employees []Employee
	q := r.db.Preload("Branch").Order("id asc")
	if branchID != nil {
		q = q.Where("branch_id = ?", *branchID)
	}
	if limit > 0 {
		q = q.Limit(limit)
	}
	if offset > 0 {
		q = q.Offset(offset)
	}
	err := q.Find(&employees).Error
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

// FindByUsername looks up an employee by exact username match. Used by
// internal/auth for login. Returns gorm.ErrRecordNotFound when no row
// matches or username is blank.
func (r *Repository) FindByUsername(username string) (*Employee, error) {
	var e Employee
	if username == "" {
		return nil, gorm.ErrRecordNotFound
	}
	if err := r.db.Preload("Branch").Where("username = ?", username).First(&e).Error; err != nil {
		return nil, err
	}
	return &e, nil
}

// FindByPhone looks up an employee by exact phone match. Used by
// internal/auth for login and for the SMS-based forgot-password flow.
// Returns gorm.ErrRecordNotFound when no row matches or phone is blank.
func (r *Repository) FindByPhone(phone string) (*Employee, error) {
	var e Employee
	if phone == "" {
		return nil, gorm.ErrRecordNotFound
	}
	if err := r.db.Preload("Branch").Where("phone = ?", phone).First(&e).Error; err != nil {
		return nil, err
	}
	return &e, nil
}

// FindByUsernameOrPhone looks up an employee whose Username OR Phone
// matches the given identifier — backs internal/auth.Login, which accepts
// either as the "who are you" field (see Service.Login's doc comment for
// why: this app doesn't use email/password login).
func (r *Repository) FindByUsernameOrPhone(identifier string) (*Employee, error) {
	var e Employee
	if identifier == "" {
		return nil, gorm.ErrRecordNotFound
	}
	if err := r.db.Preload("Branch").Where("username = ? OR phone = ?", identifier, identifier).First(&e).Error; err != nil {
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
