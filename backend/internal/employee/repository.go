package employee

import (
	"context"
	"time"

	"gorm.io/gorm"

	"cloudhouse/backend/internal/platform"
)

// Repository provides GORM-backed persistence for Employee records.
type Repository struct {
	db platform.DB
}

func NewRepository(db platform.DB) *Repository {
	return &Repository{db: db}
}

func (r *Repository) Create(ctx context.Context, e *Employee) error {
	return r.db.WithContext(ctx).Create(e).Error
}

// FindByRole returns every employee of this tenant holding roleName exactly
// (case-sensitive — role names are the canonical StaffRoles spellings, not
// free text). Used by billing.Service to find who to notify about a
// subscription nearing/past expiry: every business's own Administrator(s),
// resolved the normal tenant-scoped way rather than needing any special
// cross-tenant lookup.
func (r *Repository) FindByRole(ctx context.Context, roleName string) ([]Employee, error) {
	var out []Employee
	err := r.db.WithContext(ctx).Where("role = ?", roleName).Find(&out).Error
	return out, err
}

// FindAll returns employees, optionally scoped to a single branch — pass
// nil for an Administrator's unfiltered "all branches" view, or a non-nil
// pointer to confine results to that branch (see platform.GetBranchScope).
// limit/offset paginate the result set; limit <= 0 means "no limit" (the
// full result set, preserving existing bare-array callers).
func (r *Repository) FindAll(ctx context.Context, branchID *uint, limit, offset int) ([]Employee, int64, error) {
	var employees []Employee
	q := r.db.WithContext(ctx).Preload("Branch").Order("id asc")
	if branchID != nil {
		q = q.Where("branch_id = ?", *branchID)
	}
	var total int64
	if limit > 0 {
		if err := q.Session(&gorm.Session{}).Model(&Employee{}).Count(&total).Error; err != nil {
			return nil, 0, err
		}
		q = q.Limit(limit)
	}
	if offset > 0 {
		q = q.Offset(offset)
	}
	err := q.Find(&employees).Error
	return employees, total, err
}

func (r *Repository) FindByID(ctx context.Context, id uint) (*Employee, error) {
	var e Employee
	if err := r.db.WithContext(ctx).Preload("Branch").First(&e, id).Error; err != nil {
		return nil, err
	}
	return &e, nil
}

func (r *Repository) Update(ctx context.Context, e *Employee) error {
	return r.db.WithContext(ctx).Save(e).Error
}

func (r *Repository) Delete(ctx context.Context, id uint) error {
	return r.db.WithContext(ctx).Delete(&Employee{}, id).Error
}

// CountAll returns the total number of employees ever created (including
// soft-deleted ones), used to generate sequential Code values.
func (r *Repository) CountAll(ctx context.Context) (int64, error) {
	var count int64
	err := r.db.WithContext(ctx).Unscoped().Model(&Employee{}).Count(&count).Error
	return count, err
}

// FindByEmail looks up an employee by exact (case-insensitive) email match.
// Used by internal/auth for login/forgot-password. Returns
// gorm.ErrRecordNotFound (via err) when no row matches or email is blank.
func (r *Repository) FindByEmail(ctx context.Context, email string) (*Employee, error) {
	var e Employee
	if email == "" {
		return nil, gorm.ErrRecordNotFound
	}
	if err := r.db.WithContext(ctx).Preload("Branch").Where("email = ?", email).First(&e).Error; err != nil {
		return nil, err
	}
	return &e, nil
}

// FindByUsername looks up an employee by exact username match. Used by
// internal/auth for login. Returns gorm.ErrRecordNotFound when no row
// matches or username is blank.
func (r *Repository) FindByUsername(ctx context.Context, username string) (*Employee, error) {
	var e Employee
	if username == "" {
		return nil, gorm.ErrRecordNotFound
	}
	if err := r.db.WithContext(ctx).Preload("Branch").Where("username = ?", username).First(&e).Error; err != nil {
		return nil, err
	}
	return &e, nil
}

// FindByPhone looks up an employee by exact phone match. Used by
// internal/auth for login and for the SMS-based forgot-password flow.
// Returns gorm.ErrRecordNotFound when no row matches or phone is blank.
func (r *Repository) FindByPhone(ctx context.Context, phone string) (*Employee, error) {
	var e Employee
	if phone == "" {
		return nil, gorm.ErrRecordNotFound
	}
	if err := r.db.WithContext(ctx).Preload("Branch").Where("phone = ?", phone).First(&e).Error; err != nil {
		return nil, err
	}
	return &e, nil
}

// FindByUsernameOrPhone looks up an employee whose Username OR Phone
// matches the given identifier — backs internal/auth.Login, which accepts
// either as the "who are you" field (see Service.Login's doc comment for
// why: this app doesn't use email/password login).
func (r *Repository) FindByUsernameOrPhone(ctx context.Context, identifier string) (*Employee, error) {
	var e Employee
	if identifier == "" {
		return nil, gorm.ErrRecordNotFound
	}
	if err := r.db.WithContext(ctx).Preload("Branch").Where("username = ? OR phone = ?", identifier, identifier).First(&e).Error; err != nil {
		return nil, err
	}
	return &e, nil
}

// FindByResetTokenHash looks up an employee whose password-reset token hash
// matches and whose expiry is still in the future. Used by
// internal/auth.ResetPassword.
func (r *Repository) FindByResetTokenHash(ctx context.Context, tokenHash string) (*Employee, error) {
	var e Employee
	if err := r.db.WithContext(ctx).Where("password_reset_token_hash = ? AND password_reset_expires_at > ?", tokenHash, time.Now()).First(&e).Error; err != nil {
		return nil, err
	}
	return &e, nil
}

// CurrentSession returns the employee's CURRENT role/branch, or found=false
// if the employee no longer exists — including soft-deleted, since GORM's
// default scope already excludes DeletedAt rows.
//
// Backs AuthMiddleware's per-request session revalidation (multi-tenancy
// plan, Step 8b): a stale JWT must not keep authorizing requests once the
// employee behind it has been deleted or reassigned a different role, and
// waiting for the token to expire (up to JWTExpiry, days by default) is not
// good enough. Deliberately a narrow, no-preload query — this runs on every
// authenticated request, unlike FindByID, which preloads Branch for the
// handful of callers that display it.
func (r *Repository) CurrentSession(ctx context.Context, employeeID uint) (roleName string, roleID, branchID uint, found bool) {
	var e Employee
	if err := r.db.WithContext(ctx).
		Select("role", "role_id", "branch_id").
		First(&e, employeeID).Error; err != nil {
		return "", 0, 0, false
	}
	return e.Role, e.RoleID, e.BranchID, true
}
