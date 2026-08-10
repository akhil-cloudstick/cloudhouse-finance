package employee

import "gorm.io/gorm"

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
