package goldrate

import "gorm.io/gorm"

// Repository provides GORM-backed persistence for GoldRate records.
type Repository struct {
	db *gorm.DB
}

func NewRepository(db *gorm.DB) *Repository {
	return &Repository{db: db}
}

func (r *Repository) Create(g *GoldRate) error {
	return r.db.Create(g).Error
}

// FindAll returns every published rate, most recent first — this is the
// "Rate History" table on the frontend.
func (r *Repository) FindAll() ([]GoldRate, error) {
	var rates []GoldRate
	err := r.db.Order("date desc, id desc").Find(&rates).Error
	return rates, err
}

// FindLatest returns the most recently published rate, or gorm.ErrRecordNotFound
// if none have been published yet.
func (r *Repository) FindLatest() (*GoldRate, error) {
	var g GoldRate
	if err := r.db.Order("date desc, id desc").First(&g).Error; err != nil {
		return nil, err
	}
	return &g, nil
}

func (r *Repository) FindByID(id uint) (*GoldRate, error) {
	var g GoldRate
	if err := r.db.First(&g, id).Error; err != nil {
		return nil, err
	}
	return &g, nil
}
