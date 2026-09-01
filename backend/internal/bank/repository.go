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

// FindAll returns banks matching query. limit == 0 returns every match
// unpaged (the web bank directory's behaviour); limit > 0 applies
// Limit/Offset (the mobile app's paginated list) — same convention as
// customer/loan/scheme's FindAll.
func (r *Repository) FindAll(query string, limit, offset int) ([]Bank, error) {
	var banks []Bank
	q := r.db.Order("name asc")
	if query != "" {
		q = q.Where("name ILIKE ?", "%"+query+"%")
	}
	if limit > 0 {
		q = q.Limit(limit).Offset(offset)
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
