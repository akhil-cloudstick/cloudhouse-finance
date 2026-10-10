package models

import (
	"cloudhouse/backend/config"
	"time"
)

type LoanAccrual struct {
	config.TenantScoped
	ID            uint      `json:"id" gorm:"primaryKey"`
	LoanID        uint      `json:"loan_id" gorm:"not null;index"`
	AccruedOn     time.Time `json:"accrued_on" gorm:"not null"`
	Interest      float64   `json:"interest" gorm:"not null;type:numeric(16,2);default:0"`
	PenalInterest float64   `json:"penal_interest" gorm:"not null;type:numeric(16,2);default:0"`
	CreatedAt     time.Time `json:"created_at"`
}
