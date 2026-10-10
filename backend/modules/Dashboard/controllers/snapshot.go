package controllers

import (
	"cloudhouse/backend/config"
	"cloudhouse/backend/modules/Dashboard/models"
	"context"
	"time"

	"gorm.io/gorm"
)

func insertSnapshot(ctx context.Context, s *models.Snapshot) error {
	return config.DB.
		WithContext(ctx).Create(s).Error
}

func findByDate(ctx context.Context, date time.Time) (*models.Snapshot, error) {
	day := time.Date(date.Year(), date.Month(), date.Day(), 0, 0, 0, 0, date.Location())
	var s models.Snapshot
	if err := config.DB.
		WithContext(ctx).Where("date = ?", day).First(&s).Error; err != nil {
		return nil, err
	}
	return &s, nil
}

func findLatest(ctx context.Context) (*models.Snapshot, error) {
	var s models.Snapshot
	if err := config.DB.
		WithContext(ctx).Order("date desc, id desc").First(&s).Error; err != nil {
		return nil, err
	}
	return &s, nil
}

func findSnapshots(ctx context.Context, limit, offset int) ([]models.Snapshot, int64, error) {
	var snapshots []models.Snapshot
	q := config.DB.
		WithContext(ctx).Order("date desc, id desc")
	var total int64
	if limit > 0 {
		if err := q.Session(&gorm.Session{}).Model(&models.Snapshot{}).Count(&total).Error; err != nil {
			return nil, 0, err
		}
		q = q.Limit(limit).Offset(offset)
	}
	err := q.Find(&snapshots).Error
	return snapshots, total, err
}
