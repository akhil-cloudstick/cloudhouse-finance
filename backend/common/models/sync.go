package models

import (
	"cloudhouse/backend/config"
	"time"
)

// SyncReceipt remembers an accepted offline entry so a resend gets the same reply instead of a second record.
type SyncReceipt struct {
	config.TenantScoped
	ClientUUID  string     `json:"client_uuid" gorm:"primaryKey;type:uuid"`
	Method      string     `json:"method" gorm:"size:10;not null"`
	Path        string     `json:"path" gorm:"size:255;not null"`
	Status      int        `json:"status"`
	Response    string     `json:"response"`
	ClaimedAt   time.Time  `json:"claimed_at"`
	CompletedAt *time.Time `json:"completed_at"`
}
