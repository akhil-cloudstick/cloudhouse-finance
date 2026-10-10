package models

import "time"

type UsageCounter struct {
	TenantID uint      `gorm:"primaryKey"`
	Category string    `gorm:"primaryKey;size:40"`
	Day      time.Time `gorm:"primaryKey"`
	Count    uint      `gorm:"not null;default:0"`
}
