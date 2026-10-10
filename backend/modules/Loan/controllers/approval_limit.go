package controllers

import (
	"cloudhouse/backend/config"
	"time"
)

type ApprovalLimit struct {
	config.TenantScoped
	ID        uint      `json:"id" gorm:"primaryKey"`
	Role      string    `json:"role" gorm:"index;not null;size:40"`
	MaxAmount float64   `json:"max_amount" gorm:"not null"`
	UpdatedAt time.Time `json:"updated_at"`
}
