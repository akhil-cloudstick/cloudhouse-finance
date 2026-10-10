package models

import (
	"cloudhouse/backend/config"
	"time"

	"gorm.io/gorm"
)

type Employee struct {
	config.TenantScoped
	ID                     uint           `json:"id" gorm:"primaryKey"`
	Code                   string         `json:"code" gorm:"index;size:20"`
	Name                   string         `json:"name" gorm:"not null;size:120"`
	Role                   string         `json:"role" gorm:"not null;size:60"`
	RoleID                 uint           `json:"role_id"`
	IsSystem               bool           `json:"is_system" gorm:"-"`
	BranchID               uint           `json:"branch_id" gorm:"not null"`
	Branch                 Branch         `json:"branch" gorm:"foreignKey:BranchID"`
	Phone                  string         `json:"phone" gorm:"index;size:20"`
	LoansProcessed         int            `json:"loans_processed"`
	Collections            float64        `json:"collections"`
	Followups              int            `json:"followups"`
	Pending                int            `json:"pending"`
	Username               string         `json:"username,omitempty" gorm:"index;size:60"`
	Email                  string         `json:"email,omitempty" gorm:"index;size:120"`
	PasswordHash           string         `json:"-" gorm:"size:255"`
	PasswordResetTokenHash string         `json:"-" gorm:"size:64"`
	PasswordResetExpiresAt *time.Time     `json:"-"`
	PasswordResetAttempts  int            `json:"-" gorm:"not null;default:0"`
	CreatedAt              time.Time      `json:"created_at"`
	UpdatedAt              time.Time      `json:"updated_at"`
	DeletedAt              gorm.DeletedAt `json:"-" gorm:"index"`
}
