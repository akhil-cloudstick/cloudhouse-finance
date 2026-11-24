package models

import (
	"cloudhouse/backend/config"
	"time"
)

type GoldRate struct {
	config.TenantScoped
	ID   uint      `json:"id" gorm:"primaryKey"`
	Date time.Time `json:"date" gorm:"not null;index"`
	K24  float64   `json:"k24" gorm:"not null"`
	K22  float64   `json:"k22" gorm:"not null;default:0"`
	K18  float64   `json:"k18" gorm:"not null;default:0"`
	// Fineness22/Fineness18 are the 22K/18K fineness % last set in Auto mode (0 = never set), carried forward.
	Fineness22 float64 `json:"fineness22" gorm:"type:numeric(5,2);not null;default:0"`
	Fineness18 float64 `json:"fineness18" gorm:"type:numeric(5,2);not null;default:0"`
	SetBy      string  `json:"set_by" gorm:"not null;size:120"`
	// SetByDesignation is the setter's role, stamped server-side from the token.
	SetByDesignation string    `json:"set_by_designation" gorm:"not null;size:60;default:''"`
	CreatedAt        time.Time `json:"created_at"`
}
