package models

import "time"

type Sequence struct {
	TenantID  uint      `gorm:"primaryKey"`
	Kind      string    `gorm:"primaryKey;size:24"`
	LastValue uint64    `gorm:"not null;default:0"`
	UpdatedAt time.Time `gorm:"autoUpdateTime"`
}
