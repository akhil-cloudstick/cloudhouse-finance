package scheme

import (
	"gorm.io/gorm"
)

// Repository provides GORM-backed persistence for Scheme records.
type Repository struct {
	db *gorm.DB
}

func NewRepository(db *gorm.DB) *Repository {
	return &Repository{db: db}
}

func (r *Repository) Create(s *Scheme) error {
	return r.db.Create(s).Error
}

// FindAll returns schemes, optionally scoped to a single branch — pass nil
// for an Administrator's unfiltered "all branches" view, or a non-nil
// pointer to confine results to that branch (see platform.GetBranchScope).
func (r *Repository) FindAll(query string, branchID *uint) ([]Scheme, error) {
	var schemes []Scheme
	q := r.db.Preload("Branch").Order("id asc")
	if query != "" {
		q = q.Where("name ILIKE ?", "%"+query+"%")
	}
	if branchID != nil {
		q = q.Where("branch_id = ?", *branchID)
	}
	err := q.Find(&schemes).Error
	return schemes, err
}

// FindActive mirrors customer.Repository.FindAll's pagination convention:
// limit == 0 returns every active scheme unpaged (the full Loan Schemes
// page's behaviour); limit > 0 applies Limit/Offset (the paginated
// SearchableSelect in NewLoan.tsx).
func (r *Repository) FindActive(query string, limit, offset int) ([]Scheme, error) {
	var schemes []Scheme
	q := r.db.Where("is_active = ?", true).Order("id asc")
	if query != "" {
		q = q.Where("name ILIKE ?", "%"+query+"%")
	}
	if limit > 0 {
		q = q.Limit(limit).Offset(offset)
	}
	err := q.Find(&schemes).Error
	return schemes, err
}

func (r *Repository) FindInactive() ([]Scheme, error) {
	var schemes []Scheme
	err := r.db.Where("is_active = ?", false).Order("id asc").Find(&schemes).Error
	return schemes, err
}

func (r *Repository) FindByID(id uint) (*Scheme, error) {
	var s Scheme
	if err := r.db.Preload("Branch").First(&s, id).Error; err != nil {
		return nil, err
	}
	return &s, nil
}

func (r *Repository) Update(s *Scheme) error {
	return r.db.Save(s).Error
}

func (r *Repository) Delete(id uint) error {
	return r.db.Delete(&Scheme{}, id).Error
}

// CountAll returns the total number of schemes ever created (including
// soft-deleted ones), used to generate sequential Code values.
func (r *Repository) CountAll() (int64, error) {
	var count int64
	err := r.db.Unscoped().Model(&Scheme{}).Count(&count).Error
	return count, err
}
