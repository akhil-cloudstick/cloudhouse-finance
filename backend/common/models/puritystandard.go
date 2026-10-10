package models

import (
	"cloudhouse/backend/config"
	"time"
)

type PurityStandard struct {
	config.TenantScoped
	ID              uint      `json:"id" gorm:"primaryKey"`
	Karat           *int      `json:"karat"`
	FinenessPercent *float64  `json:"fineness_percent"`
	Label           string    `json:"label" gorm:"not null;size:40"`
	IsActive        bool      `json:"is_active" gorm:"not null;default:true"`
	CreatedAt       time.Time `json:"created_at"`
	UpdatedAt       time.Time `json:"updated_at"`
}
