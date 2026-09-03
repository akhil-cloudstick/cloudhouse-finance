package dashboard

import (
	"time"

	"gorm.io/gorm"
)

// SnapshotRepository provides GORM-backed persistence for Snapshot records.
type SnapshotRepository struct {
	db *gorm.DB
}

func NewSnapshotRepository(db *gorm.DB) *SnapshotRepository {
	return &SnapshotRepository{db: db}
}

func (r *SnapshotRepository) Create(s *Snapshot) error {
	return r.db.Create(s).Error
}

// FindByDate returns the snapshot captured for the given calendar day (time
// component ignored), or gorm.ErrRecordNotFound if none exists yet — used to
// guard the nightly capture job against writing a second row for a day
// that's already been captured.
func (r *SnapshotRepository) FindByDate(date time.Time) (*Snapshot, error) {
	day := time.Date(date.Year(), date.Month(), date.Day(), 0, 0, 0, 0, date.Location())
	var s Snapshot
	if err := r.db.Where("date = ?", day).First(&s).Error; err != nil {
		return nil, err
	}
	return &s, nil
}

// FindLatest returns the most recently captured snapshot, or
// gorm.ErrRecordNotFound if none have been captured yet.
func (r *SnapshotRepository) FindLatest() (*Snapshot, error) {
	var s Snapshot
	if err := r.db.Order("date desc, id desc").First(&s).Error; err != nil {
		return nil, err
	}
	return &s, nil
}

// FindAll returns captured snapshots, most recent first — history feed for
// GET /dashboard/snapshots, same shape as goldrate.Repository.FindAll. When
// limit is 0, every row is returned.
func (r *SnapshotRepository) FindAll(limit, offset int) ([]Snapshot, int64, error) {
	var snapshots []Snapshot
	q := r.db.Order("date desc, id desc")
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
