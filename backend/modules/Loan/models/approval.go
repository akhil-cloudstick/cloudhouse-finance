package models

import (
	"cloudhouse/backend/config"
	"time"
)

type LoanApproval struct {
	config.TenantScoped
	ID              uint      `json:"id" gorm:"primaryKey"`
	LoanID          uint      `json:"loan_id" gorm:"not null;index"`
	Stage           string    `json:"stage" gorm:"not null;size:30"`
	Action          string    `json:"action" gorm:"not null;size:20"`
	ActorEmployeeID uint      `json:"actor_employee_id" gorm:"not null"`
	ActorRole       string    `json:"actor_role" gorm:"size:40"`
	Remarks         string    `json:"remarks" gorm:"size:255"`
	CreatedAt       time.Time `json:"created_at"`
}
