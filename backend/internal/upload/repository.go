package upload

import (
	"context"

	"gorm.io/gorm"
)

type Repository struct {
	db *gorm.DB
}

func NewRepository(db *gorm.DB) *Repository {
	return &Repository{db: db}
}

func (r *Repository) Create(ctx context.Context, f *File) error {
	return r.db.WithContext(ctx).Create(f).Error
}

// FindByStorageKey resolves the key from a /uploads/<key> URL.
//
// The tenant filter does the authorization here: the query runs under the
// requester's own business, so another business's file is simply not found.
// That is deliberately indistinguishable from a file that does not exist —
// a "403 Forbidden" would confirm the file is real and belongs to someone
// else, which is more than a stranger should learn from a URL.
func (r *Repository) FindByStorageKey(ctx context.Context, key string) (*File, error) {
	var f File
	if err := r.db.WithContext(ctx).Where("storage_key = ?", key).First(&f).Error; err != nil {
		return nil, err
	}
	return &f, nil
}
