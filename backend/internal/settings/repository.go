package settings

import (
	"context"

	"gorm.io/gorm"
)

// Repository provides GORM-backed persistence for ApiKeySetting records.
type Repository struct {
	db *gorm.DB
}

func NewRepository(db *gorm.DB) *Repository {
	return &Repository{db: db}
}

func (r *Repository) FindAll(ctx context.Context) ([]ApiKeySetting, error) {
	var rows []ApiKeySetting
	err := r.db.WithContext(ctx).Find(&rows).Error
	return rows, err
}

func (r *Repository) FindByCategory(ctx context.Context, category Category) (*ApiKeySetting, error) {
	var row ApiKeySetting
	err := r.db.WithContext(ctx).Where("category = ?", string(category)).First(&row).Error
	if err != nil {
		return nil, err
	}
	return &row, nil
}

// Upsert creates or updates the single row for a category.
func (r *Repository) Upsert(ctx context.Context, row *ApiKeySetting) error {
	var existing ApiKeySetting
	err := r.db.WithContext(ctx).Where("category = ?", row.Category).First(&existing).Error
	if err == gorm.ErrRecordNotFound {
		return r.db.WithContext(ctx).Create(row).Error
	}
	if err != nil {
		return err
	}
	existing.Name = row.Name
	existing.EncryptedValue = row.EncryptedValue
	return r.db.WithContext(ctx).Save(&existing).Error
}

func (r *Repository) DeleteByCategory(ctx context.Context, category Category) error {
	return r.db.WithContext(ctx).Where("category = ?", string(category)).Delete(&ApiKeySetting{}).Error
}
