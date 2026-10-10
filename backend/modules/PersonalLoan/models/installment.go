package models

import (
	"cloudhouse/backend/config"
	"time"
)

type PersonalLoanInstallment struct {
	config.TenantScoped
	ID             uint      `json:"id" gorm:"primaryKey"`
	PersonalLoanID uint      `json:"personal_loan_id" gorm:"not null;index"`
	SequenceNo     int       `json:"sequence_no" gorm:"not null"`
	DueDate        time.Time `json:"due_date" gorm:"not null"`
	Amount         float64   `json:"amount" gorm:"not null;type:numeric(16,2)"`
	Status         string    `json:"status" gorm:"not null;size:15;default:'Pending'"`
	PaidAmount     float64   `json:"paid_amount" gorm:"not null;type:numeric(16,2);default:0"`
	CreatedAt      time.Time `json:"created_at"`
	UpdatedAt      time.Time `json:"updated_at"`
}
