package superadmin

import (
	"context"

	"gorm.io/gorm"

	"cloudhouse/backend/internal/platform"
)

// Repository provides GORM-backed persistence for SuperAdminUser and AuditLog.
//
// Every method here runs under platform.AllowCrossTenant deliberately: the
// superadmin console's whole job is to see across businesses. Neither table this
// package owns is tenant-scoped in the first place (see the model.go doc
// comments), so the wrapping is defensive rather than load-bearing today —
// but it is what makes "no query in this file needs a business established"
// visible at a glance, and keeps the pattern consistent if a future column
// here ever did need scoping.
type Repository struct {
	db *gorm.DB
}

func NewRepository(db *gorm.DB) *Repository {
	return &Repository{db: db}
}

func (r *Repository) FindSuperAdminUserByUsername(ctx context.Context, username string) (*SuperAdminUser, error) {
	var u SuperAdminUser
	err := r.db.WithContext(platform.AllowCrossTenant(ctx)).
		Where("LOWER(username) = LOWER(?)", username).First(&u).Error
	if err != nil {
		return nil, err
	}
	return &u, nil
}

func (r *Repository) CreateSuperAdminUser(ctx context.Context, u *SuperAdminUser) error {
	return r.db.WithContext(platform.AllowCrossTenant(ctx)).Create(u).Error
}

// CountSuperAdminUsers backs the bootstrap check — see seed.go.
func (r *Repository) CountSuperAdminUsers(ctx context.Context) (int64, error) {
	var n int64
	err := r.db.WithContext(platform.AllowCrossTenant(ctx)).Model(&SuperAdminUser{}).Count(&n).Error
	return n, err
}

func (r *Repository) CreateAuditLog(ctx context.Context, entry *AuditLog) error {
	return r.db.WithContext(platform.AllowCrossTenant(ctx)).Create(entry).Error
}

// AuditLogFilter narrows the audit list — every field optional.
type AuditLogFilter struct {
	TenantID *uint
	Action   string
	Limit    int
	Offset   int
}

func (r *Repository) FindAuditLogs(ctx context.Context, f AuditLogFilter) ([]AuditLog, error) {
	q := r.db.WithContext(platform.AllowCrossTenant(ctx)).Order("created_at desc")
	if f.TenantID != nil {
		q = q.Where("tenant_id = ?", *f.TenantID)
	}
	if f.Action != "" {
		q = q.Where("action = ?", f.Action)
	}
	if f.Limit > 0 {
		q = q.Limit(f.Limit).Offset(f.Offset)
	}
	var out []AuditLog
	err := q.Find(&out).Error
	return out, err
}
