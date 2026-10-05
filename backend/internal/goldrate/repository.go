package goldrate

import (
	"context"

	"gorm.io/gorm"

	"cloudhouse/backend/internal/platform"
)

// latestOrder ranks rates by calendar day, then by publish order. Ordering by
// the raw timestamp let a row stamped later in the day (e.g. demo seed data
// dated today 12:00) outrank an admin's edit made earlier that same day, so
// customers kept seeing the stale rate. Within a day, the newest publish wins.
const latestOrder = "CAST(date AS DATE) desc, id desc"

// Repository provides GORM-backed persistence for GoldRate records.
type Repository struct {
	db platform.DB
}

func NewRepository(db platform.DB) *Repository {
	return &Repository{db: db}
}

func (r *Repository) Create(ctx context.Context, g *GoldRate) error {
	return r.db.WithContext(ctx).Create(g).Error
}

// FindAll returns published rates, most recent first — this is the
// "Rate History" table on the frontend. When limit is 0, every row is
// returned (backward-compatible with callers that don't paginate).
func (r *Repository) FindAll(ctx context.Context, limit, offset int) ([]GoldRate, int64, error) {
	var rates []GoldRate
	q := r.db.WithContext(ctx).Order(latestOrder)
	var total int64
	if limit > 0 {
		if err := q.Session(&gorm.Session{}).Model(&GoldRate{}).Count(&total).Error; err != nil {
			return nil, 0, err
		}
		q = q.Limit(limit).Offset(offset)
	}
	err := q.Find(&rates).Error
	return rates, total, err
}

// FindLatest returns the most recently published rate, or gorm.ErrRecordNotFound
// if none have been published yet.
func (r *Repository) FindLatest(ctx context.Context) (*GoldRate, error) {
	var g GoldRate
	if err := r.db.WithContext(ctx).Order(latestOrder).First(&g).Error; err != nil {
		return nil, err
	}
	return &g, nil
}

func (r *Repository) FindByID(ctx context.Context, id uint) (*GoldRate, error) {
	var g GoldRate
	if err := r.db.WithContext(ctx).First(&g, id).Error; err != nil {
		return nil, err
	}
	return &g, nil
}
