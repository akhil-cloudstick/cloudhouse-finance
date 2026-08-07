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

func (r *Repository) FindAll() ([]Scheme, error) {
	var schemes []Scheme
	err := r.db.Order("id asc").Find(&schemes).Error
	return schemes, err
}

func (r *Repository) FindActive() ([]Scheme, error) {
	var schemes []Scheme
	err := r.db.Where("is_active = ?", true).Order("id asc").Find(&schemes).Error
	return schemes, err
}

func (r *Repository) FindInactive() ([]Scheme, error) {
	var schemes []Scheme
	err := r.db.Where("is_active = ?", false).Order("id asc").Find(&schemes).Error
	return schemes, err
}

func (r *Repository) FindByID(id uint) (*Scheme, error) {
	var s Scheme
	if err := r.db.First(&s, id).Error; err != nil {
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
