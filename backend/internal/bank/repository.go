package bank

import "gorm.io/gorm"

// Repository provides GORM-backed persistence for Bank records.
type Repository struct {
	db *gorm.DB
}

func NewRepository(db *gorm.DB) *Repository {
	return &Repository{db: db}
}

func (r *Repository) Create(b *Bank) error {
	return r.db.Create(b).Error
}

func (r *Repository) FindAll(query string) ([]Bank, error) {
	var banks []Bank
	q := r.db.Order("name asc")
	if query != "" {
		q = q.Where("name ILIKE ?", "%"+query+"%")
	}
	err := q.Find(&banks).Error
	return banks, err
}

// FindByName looks up a bank by a case-insensitive exact match on Name.
// Returns gorm.ErrRecordNotFound (via err) when no row matches.
func (r *Repository) FindByName(name string) (*Bank, error) {
	var b Bank
	if err := r.db.Where("name ILIKE ?", name).First(&b).Error; err != nil {
		return nil, err
	}
	return &b, nil
}
