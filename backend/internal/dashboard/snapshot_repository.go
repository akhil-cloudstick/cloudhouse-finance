package dashboard

import (
	"context"
	"time"

	"gorm.io/gorm"

	"cloudhouse/backend/internal/platform"
)

// SnapshotRepository provides GORM-backed persistence for Snapshot records.
//
// Every method takes a context and passes it to GORM. That is not a style
// choice: platform.RegisterTenantScope reads the tenant off the statement's
// context, so a query issued without one is invisible to the filter. These
// four methods previously used a bare r.db with no WithContext at all, which
// is why dashboard_snapshots stayed unfiltered even for callers that had a
// tenant — the filter had nothing to read.
type SnapshotRepository struct {
	db platform.DB
}

func NewSnapshotRepository(db platform.DB) *SnapshotRepository {
	return &SnapshotRepository{db: db}
}

func (r *SnapshotRepository) Create(ctx context.Context, s *Snapshot) error {
	return r.db.WithContext(ctx).Create(s).Error
}

// FindByDate returns the snapshot captured for the given calendar day (time
// component ignored), or gorm.ErrRecordNotFound if none exists yet — used to
// guard the nightly capture job against writing a second row for a day
// that's already been captured. Scoped to the caller's business, so one
// business having captured a day says nothing about whether another has.
func (r *SnapshotRepository) FindByDate(ctx context.Context, date time.Time) (*Snapshot, error) {
	day := time.Date(date.Year(), date.Month(), date.Day(), 0, 0, 0, 0, date.Location())
	var s Snapshot
	if err := r.db.WithContext(ctx).Where("date = ?", day).First(&s).Error; err != nil {
		return nil, err
	}
	return &s, nil
}

// FindLatest returns the most recently captured snapshot, or
// gorm.ErrRecordNotFound if none have been captured yet.
func (r *SnapshotRepository) FindLatest(ctx context.Context) (*Snapshot, error) {
	var s Snapshot
	if err := r.db.WithContext(ctx).Order("date desc, id desc").First(&s).Error; err != nil {
		return nil, err
	}
	return &s, nil
}

// FindAll returns captured snapshots, most recent first — history feed for
// GET /dashboard/snapshots, same shape as goldrate.Repository.FindAll. When
// limit is 0, every row is returned.
func (r *SnapshotRepository) FindAll(ctx context.Context, limit, offset int) ([]Snapshot, int64, error) {
	var snapshots []Snapshot
	q := r.db.WithContext(ctx).Order("date desc, id desc")
	var total int64
	if limit > 0 {
		if err := q.Session(&gorm.Session{}).Model(&Snapshot{}).Count(&total).Error; err != nil {
			return nil, 0, err
		}
		q = q.Limit(limit).Offset(offset)
	}
	err := q.Find(&snapshots).Error
	return snapshots, total, err
}
