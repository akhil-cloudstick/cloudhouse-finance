package customer

import "gorm.io/gorm"

// Repository provides GORM-backed persistence for Customer records.
type Repository struct {
	db *gorm.DB
}

func NewRepository(db *gorm.DB) *Repository {
	return &Repository{db: db}
}

func (r *Repository) Create(c *Customer) error {
	return r.db.Create(c).Error
}

// FindAll returns customers matching query, ordered by id. When limit > 0
// it applies Limit/Offset (used by the paginated SearchableSelect-backed
// search — see Service.List); limit == 0 returns every match, unpaged, for
// callers like the full Customers & KYC list page.
func (r *Repository) FindAll(query string, limit, offset int) ([]Customer, error) {
	var customers []Customer
	q := r.db.Preload("Branch").Order("id asc")
	if query != "" {
		like := "%" + query + "%"
		q = q.Where("name ILIKE ? OR code ILIKE ? OR phone ILIKE ?", like, like, like)
	}
	if limit > 0 {
		q = q.Limit(limit).Offset(offset)
	}
	err := q.Find(&customers).Error
	return customers, err
}

func (r *Repository) FindByID(id uint) (*Customer, error) {
	var c Customer
	if err := r.db.Preload("Branch").First(&c, id).Error; err != nil {
		return nil, err
	}
	return &c, nil
}

func (r *Repository) Update(c *Customer) error {
	return r.db.Save(c).Error
}

func (r *Repository) Delete(id uint) error {
	return r.db.Delete(&Customer{}, id).Error
}

// CountAll returns the total number of customers ever created (including
// soft-deleted ones), used to generate sequential Code values.
func (r *Repository) CountAll() (int64, error) {
	var count int64
	err := r.db.Unscoped().Model(&Customer{}).Count(&count).Error
	return count, err
}
