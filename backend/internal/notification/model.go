// Package notification is the durable store + WebSocket delivery front-end
// for real-time customer notifications. It is deliberately independent of
// commlog: commlog is a log of outbound WhatsApp attempts for the
// Communication History report, whereas Notification is a queryable,
// ack-tracked in-app inbox — the same event may write to both (see
// internal/loan/service.go's notifyCustomer), but they answer different
// questions ("was a WhatsApp sent?" vs "did the customer's app receive
// this?").
package notification

import "time"

// Notification is one in-app notification for one customer. Delivered only
// flips true once the customer's app acknowledges receipt over the
// WebSocket (or via the REST ack fallback) — not merely "the server
// attempted a push." Attempts counts live-push attempts made by the resend
// ticker (internal/realtime), capped at maxResendAttempts (service.go) —
// after the cap, the row is left Delivered=false permanently but remains
// visible via List (the REST history endpoint), never deleted.
type Notification struct {
	ID         uint   `json:"id" gorm:"primaryKey"`
	CustomerID uint   `json:"customerId" gorm:"not null;index"`
	Type       string `json:"type" gorm:"not null;size:40;index"` // e.g. "LoanSanctioned", "PaymentRecorded" — see loan/service.go call sites for the full set
	Title      string `json:"title" gorm:"size:120"`
	Body       string `json:"body" gorm:"type:text"`

	// RelatedEntityType/RelatedEntityID mirror commlog.CommunicationLog's
	// loose polymorphic reference convention — "loan"/"auction_record"/
	// "loan_request" + the row's id, not FK-enforced.
	RelatedEntityType string `json:"relatedEntityType" gorm:"size:30;index"`
	RelatedEntityID   uint   `json:"relatedEntityId" gorm:"index"`

	Delivered     bool       `json:"delivered" gorm:"not null;default:false;index"`
	DeliveredAt   *time.Time `json:"deliveredAt"`
	Attempts      int        `json:"attempts" gorm:"not null;default:0"`
	LastAttemptAt *time.Time `json:"lastAttemptAt"`

	CreatedAt time.Time `json:"createdAt" gorm:"index"`
}

func (Notification) TableName() string { return "notifications" }
