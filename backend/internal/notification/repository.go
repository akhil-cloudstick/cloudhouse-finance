package notification

import (
	"time"

	"gorm.io/gorm"
)

// Repository provides GORM-backed persistence for Notification records.
type Repository struct {
	db *gorm.DB
}

func NewRepository(db *gorm.DB) *Repository {
	return &Repository{db: db}
}

func (r *Repository) Create(n *Notification) error {
	return r.db.Create(n).Error
}

func (r *Repository) FindByID(id uint) (*Notification, error) {
	var n Notification
	if err := r.db.First(&n, id).Error; err != nil {
		return nil, err
	}
	return &n, nil
}

// FindByCustomerID returns one customer's notifications, newest first. When
// limit > 0 it applies Limit/Offset (paginated bell-list backfill); limit
// == 0 returns every row unpaged — same convention as customer.Repository's
// FindAll.
func (r *Repository) FindByCustomerID(customerID uint, limit, offset int) ([]Notification, error) {
	var items []Notification
	q := r.db.Where("customer_id = ?", customerID).Order("created_at desc")
	if limit > 0 {
		q = q.Limit(limit).Offset(offset)
	}
	err := q.Find(&items).Error
	return items, err
}

// FindPendingResend returns every undelivered notification that hasn't yet
// hit maxAttempts — the resend ticker's work queue (internal/realtime's
// caller, via Service.ResendPending).
func (r *Repository) FindPendingResend(maxAttempts int) ([]Notification, error) {
	var items []Notification
	err := r.db.Where("delivered = ? AND attempts < ?", false, maxAttempts).Order("created_at asc").Find(&items).Error
	return items, err
}

func (r *Repository) MarkDelivered(id uint) error {
	now := time.Now()
	return r.db.Model(&Notification{}).Where("id = ?", id).Updates(map[string]any{
		"delivered":    true,
		"delivered_at": now,
	}).Error
}

// MarkRead flips Read once the customer actually opens this notification in
// the app — see Service.Read.
func (r *Repository) MarkRead(id uint) error {
	now := time.Now()
	return r.db.Model(&Notification{}).Where("id = ?", id).Updates(map[string]any{
		"read":    true,
		"read_at": now,
	}).Error
}

// IncrementAttempt records one more live-push attempt (delivered or not —
// Attempts counts pushes made, not just failures, per the "retry every 10
// minutes for a maximum of 10 times" rule).
func (r *Repository) IncrementAttempt(id uint) error {
	now := time.Now()
	return r.db.Model(&Notification{}).Where("id = ?", id).Updates(map[string]any{
		"attempts":        gorm.Expr("attempts + 1"),
		"last_attempt_at": now,
	}).Error
}
