package models

import (
	"cloudhouse/backend/config"
	"time"
)

type Bank struct {
	config.TenantScoped
	ID             uint      `json:"id" gorm:"primaryKey"`
	Name           string    `json:"name" gorm:"index;not null;size:120"`
	BranchID       uint      `json:"branch_id" gorm:"not null;index"`
	BusinessBranch *Branch   `json:"-" gorm:"foreignKey:BranchID"`
	Branch         string    `json:"branch" gorm:"size:120"`
	Ifsc           string    `json:"ifsc" gorm:"size:20"`
	AccountNo      string    `json:"account_no" gorm:"size:40"`
	Phone          string    `json:"phone" gorm:"size:20"`
	CreatedAt      time.Time `json:"created_at"`
	UpdatedAt      time.Time `json:"updated_at"`
}
