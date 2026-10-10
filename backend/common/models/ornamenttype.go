package models

import (
	"cloudhouse/backend/config"
	"time"
)

type OrnamentType struct {
	config.TenantScoped
	ID        uint      `json:"id" gorm:"primaryKey"`
	Name      string    `json:"name" gorm:"index;not null"`
	CreatedAt time.Time `json:"created_at"`
	UpdatedAt time.Time `json:"updated_at"`
}
