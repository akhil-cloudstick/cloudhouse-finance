package models

import (
	commonModels "cloudhouse/backend/common/models"
	"cloudhouse/backend/config"
	"time"

	"gorm.io/gorm"
)

type Locker struct {
	config.TenantScoped
	ID        uint                `json:"id" gorm:"primaryKey"`
	Code      string              `json:"code" gorm:"index;size:20"`
	BranchID  uint                `json:"branch_id" gorm:"not null"`
	Branch    commonModels.Branch `json:"branch" gorm:"foreignKey:BranchID"`
	Capacity  int                 `json:"capacity" gorm:"not null"`
	IsActive  bool                `json:"is_active" gorm:"not null;default:true"`
	CreatedAt time.Time           `json:"created_at"`
	UpdatedAt time.Time           `json:"updated_at"`
	DeletedAt gorm.DeletedAt      `json:"-" gorm:"index"`
}
