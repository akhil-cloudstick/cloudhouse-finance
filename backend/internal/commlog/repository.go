package commlog

import (
	"regexp"
	"time"

	"gorm.io/gorm"
)

var nonDigits = regexp.MustCompile(`\D`)

// NormalizeChatID mirrors platform.MetaCloudSender's own (unexported) phone
// -> E.164-digits normalization, duplicated here in miniature so commlog
// doesn't need to import internal/platform just for this. Only used for
// display/audit purposes — the actual send always goes through the real
// sender. The "ChatID" name and this file predate the Meta Cloud API
// migration (it used to be an OpenWA "<digits>@c.us" chat id) — kept as-is
// rather than renamed, since it's a stored/serialized field name
// (commlog.CommunicationLog.ChatID) across existing rows.
func NormalizeChatID(phone string) string {
	digits := nonDigits.ReplaceAllString(phone, "")
	if len(digits) == 11 && digits[0] == '0' {
		digits = digits[1:]
	}
	if len(digits) == 10 {
		digits = "91" + digits
	}
	return digits
}

// Repository provides GORM-backed persistence for CommunicationLog records.
type Repository struct {
	db *gorm.DB
}

func NewRepository(db *gorm.DB) *Repository {
	return &Repository{db: db}
}

func (r *Repository) Create(rec *CommunicationLog) error {
	return r.db.Create(rec).Error
}

// Filter mirrors the query params the Communication History report accepts
// (internal/reports). All fields optional/zero-value-means-"don't filter".
type Filter struct {
	From              *time.Time
	To                *time.Time
	Channel           string
	TriggerType       string
	RelatedEntityType string
	Status            string
}

// List returns matching communication log rows, newest first.
func (r *Repository) List(f Filter) ([]CommunicationLog, error) {
	var rows []CommunicationLog
	q := r.db.Model(&CommunicationLog{}).Order("created_at desc, id desc")
	q = applyFilter(q, f)
	err := q.Find(&rows).Error
	return rows, err
}

// Count returns how many rows match f — used by the reports handler to
// report total_count alongside a paginated slice.
func (r *Repository) Count(f Filter) (int64, error) {
	var count int64
	q := r.db.Model(&CommunicationLog{})
	q = applyFilter(q, f)
	err := q.Count(&count).Error
	return count, err
}

func applyFilter(q *gorm.DB, f Filter) *gorm.DB {
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
