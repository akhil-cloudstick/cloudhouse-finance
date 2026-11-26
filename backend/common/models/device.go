package models

import (
	"cloudhouse/backend/config"
	"time"
)

// Device is a PC running the desktop exe. SecretEncrypted holds the HMAC key the PC signs its replayed
// entries with; it is encrypted at rest and handed to the PC exactly once, when it registers.
type Device struct {
	config.TenantScoped
	ID                     uint       `json:"id" gorm:"primaryKey"`
	Name                   string     `json:"name" gorm:"size:120;not null"`
	MachineID              string     `json:"machine_id" gorm:"size:120;not null"`
	BranchID               *uint      `json:"branch_id"`
	SecretEncrypted        string     `json:"-" gorm:"type:text;not null"`
	Enabled                bool       `json:"enabled" gorm:"not null;default:true"`
	RegisteredByEmployeeID *uint      `json:"registered_by_employee_id"`
	LastSeenAt             *time.Time `json:"last_seen_at"`
	CreatedAt              time.Time  `json:"created_at"`
	UpdatedAt              time.Time  `json:"updated_at"`
}
