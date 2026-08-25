package settings

import "gorm.io/gorm"

// Repository provides GORM-backed persistence for ApiKeySetting records.
type Repository struct {
	db *gorm.DB
}

func NewRepository(db *gorm.DB) *Repository {
	return &Repository{db: db}
}

func (r *Repository) FindAll() ([]ApiKeySetting, error) {
	var rows []ApiKeySetting
	err := r.db.Find(&rows).Error
	return rows, err
}

func (r *Repository) FindByCategory(category Category) (*ApiKeySetting, error) {
	var row ApiKeySetting
	err := r.db.Where("category = ?", string(category)).First(&row).Error
	if err != nil {
		return nil, err
	}
	return &row, nil
}

// Upsert creates or updates the single row for a category.
func (r *Repository) Upsert(row *ApiKeySetting) error {
	var existing ApiKeySetting
	err := r.db.Where("category = ?", row.Category).First(&existing).Error
	if err == gorm.ErrRecordNotFound {
		return r.db.Create(row).Error
	}
	if err != nil {
		return err
	}
	existing.Name = row.Name
	existing.EncryptedValue = row.EncryptedValue
	return r.db.Save(&existing).Error
}

func (r *Repository) DeleteByCategory(category Category) error {
	return r.db.Where("category = ?", string(category)).Delete(&ApiKeySetting{}).Error
}
