package scheme

import (
	"context"

	"gorm.io/gorm"

	"cloudhouse/backend/internal/platform"
)

// Repository provides GORM-backed persistence for Scheme records.
type Repository struct {
	db platform.DB
}

func NewRepository(db platform.DB) *Repository {
	return &Repository{db: db}
}

func (r *Repository) Create(ctx context.Context, s *Scheme) error {
	return r.db.WithContext(ctx).Create(s).Error
}

// FindAll returns schemes, optionally scoped to a single branch — pass nil
// for an Administrator's unfiltered "all branches" view, or a non-nil
// pointer to confine results to that branch (see platform.GetBranchScope).
// limit == 0 returns every matching scheme unpaged (the web Schemes page's
// behaviour); limit > 0 applies Limit/Offset (the mobile app's paginated
// list) — same convention as FindActive below.
func (r *Repository) FindAll(ctx context.Context, query string, branchID *uint, limit, offset int) ([]Scheme, int64, error) {
	var schemes []Scheme
	q := r.db.WithContext(ctx).Preload("Branch").Order("id asc")
	if query != "" {
		q = q.Where("name ILIKE ? OR code ILIKE ?", "%"+query+"%", "%"+query+"%")
	}
	if branchID != nil {
		q = q.Where("branch_id = ?", *branchID)
	}
	var total int64
	if limit > 0 {
		if err := q.Session(&gorm.Session{}).Model(&Scheme{}).Count(&total).Error; err != nil {
			return nil, 0, err
		}
		q = q.Limit(limit).Offset(offset)
	}
	err := q.Find(&schemes).Error
	return schemes, total, err
}

// FindActive mirrors customer.Repository.FindAll's pagination convention:
// limit == 0 returns every active scheme unpaged (the full Loan Schemes
// page's behaviour); limit > 0 applies Limit/Offset (the paginated
// SearchableSelect in NewLoan.tsx). branchID mirrors FindAll's scoping (nil
// = all branches, Administrator only) so a non-admin's active-scheme picker
// never offers a scheme that List/FindAll would then hide from them.
func (r *Repository) FindActive(ctx context.Context, query string, branchID *uint, limit, offset int) ([]Scheme, int64, error) {
	var schemes []Scheme
	q := r.db.WithContext(ctx).Where("is_active = ?", true).Order("id asc")
	if query != "" {
		q = q.Where("name ILIKE ? OR code ILIKE ?", "%"+query+"%", "%"+query+"%")
	}
	if branchID != nil {
		q = q.Where("branch_id = ?", *branchID)
	}
	var total int64
	if limit > 0 {
		if err := q.Session(&gorm.Session{}).Model(&Scheme{}).Count(&total).Error; err != nil {
			return nil, 0, err
		}
		q = q.Limit(limit).Offset(offset)
	}
	err := q.Find(&schemes).Error
	return schemes, total, err
}

func (r *Repository) FindInactive(ctx context.Context) ([]Scheme, error) {
	var schemes []Scheme
	err := r.db.WithContext(ctx).Where("is_active = ?", false).Order("id asc").Find(&schemes).Error
	return schemes, err
}

func (r *Repository) FindByID(ctx context.Context, id uint) (*Scheme, error) {
	var s Scheme
	if err := r.db.WithContext(ctx).Preload("Branch").First(&s, id).Error; err != nil {
		return nil, err
	}
	return &s, nil
}

func (r *Repository) Update(ctx context.Context, s *Scheme) error {
	return r.db.WithContext(ctx).Save(s).Error
}

// HardDelete permanently removes the scheme row (bypassing the soft-delete
// DeletedAt column). Callers must first confirm nothing references it — see
// CountReferences.
func (r *Repository) HardDelete(ctx context.Context, id uint) error {
	return r.db.WithContext(ctx).Unscoped().Delete(&Scheme{}, id).Error
}

// CountReferences returns how many loans and loan drafts point at the
// scheme. Soft-deleted loans are counted too (their rows still exist and
// still carry the scheme_id foreign key). Raw SQL rather than the loan
// models since loan already imports scheme (import cycle); the GORM tenant
// filter doesn't apply to raw queries, but scheme ids are globally unique
// so the id alone is enough.
func (r *Repository) CountReferences(ctx context.Context, id uint) (loans, drafts int64, err error) {
	db := r.db.WithContext(ctx)
	if err = db.Raw("SELECT COUNT(*) FROM loans WHERE scheme_id = ?", id).Scan(&loans).Error; err != nil {
		return 0, 0, err
	}
	if err = db.Raw("SELECT COUNT(*) FROM loan_drafts WHERE scheme_id = ?", id).Scan(&drafts).Error; err != nil {
		return 0, 0, err
	}
	return loans, drafts, nil
}

// CountAll returns the total number of schemes ever created (including
// soft-deleted ones), used to generate sequential Code values.
func (r *Repository) CountAll(ctx context.Context) (int64, error) {
	var count int64
	err := r.db.WithContext(ctx).Unscoped().Model(&Scheme{}).Count(&count).Error
	return count, err
}

func (r *Repository) MaxCodeSuffix(ctx context.Context) (int, error) {
	var maxSuffix int
	err := r.db.WithContext(ctx).Model(&Scheme{}).Unscoped().
		Select("COALESCE(MAX(CAST(SUBSTRING(code FROM 'SCH-(\\d+)') AS INTEGER)), 0)").
		Scan(&maxSuffix).Error
	return maxSuffix, err
}
