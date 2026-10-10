package controllers

import (
	commonModels "cloudhouse/backend/common/models"
	"cloudhouse/backend/config"
	"context"
	"regexp"
	"time"

	"gorm.io/gorm"
)

var nonDigits = regexp.MustCompile(`\D`)

type CommLogFilter struct {
	From              *time.Time
	To                *time.Time
	Channel           string
	TriggerType       string
	RelatedEntityType string
	Status            string
}

func NormalizeChatID(phone string) string {
	digits := nonDigits.ReplaceAllString(phone, "")
	if len(digits) == 11 && digits[0] == '0' {
		digits = digits[1:]
	}
	if len(digits) == 10 {
		digits = "91" + digits
	}
	return digits + "@c.us"
}

func InsertCommLog(ctx context.Context, rec *commonModels.CommunicationLog) error {
	return config.DB.
		WithContext(ctx).Create(rec).Error
}

func CreateBackground(tenantID uint, rec *commonModels.CommunicationLog) error {
	ctx := config.WithTenant(context.Background(), tenantID)
	ctx, release, err := config.PinConn(ctx, config.BaseDB, tenantID)
	if err != nil {
		return err
	}
	defer release()
	return config.NewConnPinner(config.BaseDB).WithContext(ctx).Create(rec).Error
}

func FindCommLogs(ctx context.Context, f CommLogFilter) ([]commonModels.CommunicationLog, error) {
	var rows []commonModels.CommunicationLog
	q := config.DB.
		WithContext(ctx).Model(&commonModels.CommunicationLog{}).Order("created_at desc, id desc")
	q = applyFilter(q, f)
	err := q.Find(&rows).Error
	return rows, err
}

func countCommLogs(ctx context.Context, f CommLogFilter) (int64, error) {
	var count int64
	q := config.DB.
		WithContext(ctx).Model(&commonModels.CommunicationLog{})
	q = applyFilter(q, f)
	err := q.Count(&count).Error
	return count, err
}

func applyFilter(q *gorm.DB, f CommLogFilter) *gorm.DB {
	if f.From != nil {
		q = q.Where("created_at >= ?", *f.From)
	}
	if f.To != nil {
		q = q.Where("created_at <= ?", *f.To)
	}
	if f.Channel != "" {
		q = q.Where("channel = ?", f.Channel)
	}
	if f.TriggerType != "" {
		q = q.Where("trigger_type = ?", f.TriggerType)
	}
	if f.RelatedEntityType != "" {
		q = q.Where("related_entity_type = ?", f.RelatedEntityType)
	}
	if f.Status != "" {
		q = q.Where("status = ?", f.Status)
	}
	return q
}
