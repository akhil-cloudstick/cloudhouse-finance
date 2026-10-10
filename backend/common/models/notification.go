package models

import (
	"cloudhouse/backend/config"
	"time"
)

type Notification struct {
	config.TenantScoped
	ID                uint       `json:"id" gorm:"primaryKey"`
	CustomerID        uint       `json:"customer_id" gorm:"not null;index"`
	Type              string     `json:"type" gorm:"not null;size:40;index"`
	Title             string     `json:"title" gorm:"size:120"`
	Body              string     `json:"body" gorm:"type:text"`
	RelatedEntityType string     `json:"related_entity_type" gorm:"size:30;index"`
	RelatedEntityID   uint       `json:"related_entity_id" gorm:"index"`
	Delivered         bool       `json:"delivered" gorm:"not null;default:false;index"`
	DeliveredAt       *time.Time `json:"delivered_at"`
	Attempts          int        `json:"attempts" gorm:"not null;default:0"`
	LastAttemptAt     *time.Time `json:"last_attempt_at"`
	Read              bool       `json:"read" gorm:"not null;default:false;index"`
	ReadAt            *time.Time `json:"read_at"`
	CreatedAt         time.Time  `json:"created_at" gorm:"index"`
}
