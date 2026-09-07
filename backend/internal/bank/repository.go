package bank

import (
	"context"

	"gorm.io/gorm"
)

// Repository provides GORM-backed persistence for Bank records.
type Repository struct {
	db *gorm.DB
}

func NewRepository(db *gorm.DB) *Repository {
	return &Repository{db: db}
}

func (r *Repository) Create(ctx context.Context, b *Bank) error {
	return r.db.WithContext(ctx).Create(b).Error
}

// FindAll returns banks matching query, plus the TOTAL row count for that
// query (Limit/Offset ignored, 0 when limit <= 0). limit == 0 returns every
// match unpaged (the web bank directory's behaviour); limit > 0 applies
// Limit/Offset (the mobile app's paginated list) — same convention as
// customer/loan/scheme's FindAll.
func (r *Repository) FindAll(ctx context.Context, query string, limit, offset int) ([]Bank, int64, error) {
	var banks []Bank
	q := r.db.WithContext(ctx).Order("name asc")
	if query != "" {
		q = q.Where("name ILIKE ?", "%"+query+"%")
	}
	var total int64
	if limit > 0 {
		if err := q.Session(&gorm.Session{}).Model(&Bank{}).Count(&total).Error; err != nil {
			return nil, 0, err
		}
		q = q.Limit(limit).Offset(offset)
	}
	err := q.Find(&banks).Error
	return banks, total, err
}

// FindByName looks up a bank by a case-insensitive exact match on Name.
// Returns gorm.ErrRecordNotFound (via err) when no row matches.
func (r *Repository) FindByName(ctx context.Context, name string) (*Bank, error) {
	var b Bank
	if err := r.db.WithContext(ctx).Where("name ILIKE ?", name).First(&b).Error; err != nil {
		return nil, err
	}
	return &b, nil
}
