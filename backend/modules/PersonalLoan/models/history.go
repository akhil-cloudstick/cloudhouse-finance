package models

import (
	"cloudhouse/backend/config"
	"time"
)

const (
	EventPenalApplied = "penal_applied"
)

type PersonalLoanHistory struct {
	config.TenantScoped
	ID             uint      `json:"id" gorm:"primaryKey"`
	PersonalLoanID uint      `json:"personal_loan_id" gorm:"not null;index"`
	Event          string    `json:"event" gorm:"not null;size:30"`
	Detail         string    `json:"detail" gorm:"not null;size:200"`
	Amount         float64   `json:"amount" gorm:"not null;type:numeric(16,2);default:0"`
	RelatedLoanID  *uint     `json:"related_loan_id"`
	OccurredAt     time.Time `json:"occurred_at" gorm:"not null"`
	CreatedAt      time.Time `json:"created_at"`
}

func (PersonalLoanHistory) TableName() string { return "personal_loan_history" }
