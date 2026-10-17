package models

import "time"

// DevToolsAccess is a single platform-wide row gating desktop DevTools.
// EncryptedPin is reversible (config.SettingsCipher), not hashed, so
// superadmin can view it.
type DevToolsAccess struct {
	ID           uint      `json:"-" gorm:"primaryKey"`
	EncryptedPin string    `json:"-" gorm:"column:encrypted_pin;not null"`
	UpdatedAt    time.Time `json:"updated_at"`
}

func (DevToolsAccess) TableName() string { return "devtools_access" }
