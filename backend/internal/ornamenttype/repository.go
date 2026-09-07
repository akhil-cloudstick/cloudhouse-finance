package ornamenttype

import (
	"context"

	"gorm.io/gorm"
)

// Repository provides GORM-backed persistence for OrnamentType records.
type Repository struct {
	db *gorm.DB
}

func NewRepository(db *gorm.DB) *Repository {
	return &Repository{db: db}
}

func (r *Repository) Create(ctx context.Context, o *OrnamentType) error {
	return r.db.WithContext(ctx).Create(o).Error
}

func (r *Repository) FindAll(ctx context.Context, query string) ([]OrnamentType, error) {
	var types []OrnamentType
	q := r.db.WithContext(ctx).Order("name asc")
	if query != "" {
		q = q.Where("name ILIKE ?", "%"+query+"%")
	}
	err := q.Find(&types).Error
	return types, err
}

// FindByName looks up an ornament type by a case-insensitive exact match on
// Name. Returns gorm.ErrRecordNotFound (via err) when no row matches.
func (r *Repository) FindByName(ctx context.Context, name string) (*OrnamentType, error) {
	var o OrnamentType
	if err := r.db.WithContext(ctx).Where("name ILIKE ?", name).First(&o).Error; err != nil {
		return nil, err
	}
	return &o, nil
}
