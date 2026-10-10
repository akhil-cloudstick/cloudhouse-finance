package models

import (
	"cloudhouse/backend/config"
	"time"

	"gorm.io/gorm"
)

type Branch struct {
	config.TenantScoped
	ID        uint           `json:"id" gorm:"primaryKey"`
	Name      string         `json:"name" gorm:"index;not null;size:120"`
	Code      string         `json:"code" gorm:"index;size:20"`
	Address   string         `json:"address" gorm:"not null;size:255"`
	Phone     string         `json:"phone" gorm:"size:20"`
	IsActive  bool           `json:"is_active" gorm:"not null;default:true"`
	CreatedAt time.Time      `json:"created_at"`
	UpdatedAt time.Time      `json:"updated_at"`
	DeletedAt gorm.DeletedAt `json:"-" gorm:"index"`
}
