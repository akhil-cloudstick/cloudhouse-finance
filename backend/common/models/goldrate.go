package models

import (
	"cloudhouse/backend/config"
	"time"
)

type GoldRate struct {
	config.TenantScoped
	ID        uint      `json:"id" gorm:"primaryKey"`
	Date      time.Time `json:"date" gorm:"not null;index"`
	K24       float64   `json:"k24" gorm:"not null"`
	K22       float64   `json:"k22" gorm:"not null;default:0"`
	K18       float64   `json:"k18" gorm:"not null;default:0"`
	SetBy     string    `json:"set_by" gorm:"not null;size:120"`
	CreatedAt time.Time `json:"created_at"`
}
