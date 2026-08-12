package puritystandard

import "gorm.io/gorm"

// Repository provides GORM-backed persistence for PurityStandard records.
type Repository struct {
	db *gorm.DB
}

func NewRepository(db *gorm.DB) *Repository {
	return &Repository{db: db}
}

func (r *Repository) Create(p *PurityStandard) error {
	return r.db.Create(p).Error
}

// FindAll returns active purity standards, ordered from highest to lowest
// karat (falling back to fineness% for any row with no karat) so the
// suggestion list reads in the order staff expect (24K first).
func (r *Repository) FindAll(query string) ([]PurityStandard, error) {
	var list []PurityStandard
	q := r.db.Where("is_active = ?", true).Order("karat DESC NULLS LAST, fineness_percent DESC NULLS LAST")
	if query != "" {
		q = q.Where("label ILIKE ?", "%"+query+"%")
	}
	err := q.Find(&list).Error
	return list, err
}

// FindByKarat looks up an active row by exact karat match. Returns
// gorm.ErrRecordNotFound (via err) when no row matches.
func (r *Repository) FindByKarat(karat int) (*PurityStandard, error) {
	var p PurityStandard
	if err := r.db.Where("karat = ? AND is_active = ?", karat, true).First(&p).Error; err != nil {
		return nil, err
	}
	return &p, nil
}

// FindByFineness looks up an active row by exact fineness% match (compared
// to 1 decimal place, matching how seeded rows are computed). Returns
// gorm.ErrRecordNotFound (via err) when no row matches.
func (r *Repository) FindByFineness(finenessPercent float64) (*PurityStandard, error) {
	var p PurityStandard
	if err := r.db.Where("ROUND(fineness_percent::numeric, 1) = ? AND is_active = ?", finenessPercent, true).First(&p).Error; err != nil {
		return nil, err
	}
	return &p, nil
}
