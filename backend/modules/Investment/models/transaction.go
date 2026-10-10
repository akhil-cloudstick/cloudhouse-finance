package models

import (
	"cloudhouse/backend/config"
	"time"
)

type InvestmentTransaction struct {
	config.TenantScoped
	ID                   uint      `json:"id" gorm:"primaryKey"`
	InvestmentID         uint      `json:"investment_id" gorm:"not null;index"`
	Type                 string    `json:"type" gorm:"not null;size:12"`
	Amount               float64   `json:"amount" gorm:"not null;type:numeric(16,2)"`
	PrincipalAmount      float64   `json:"principal_amount" gorm:"not null;type:numeric(16,2);default:0"`
	InterestAmount       float64   `json:"interest_amount" gorm:"not null;type:numeric(16,2);default:0"`
	CashAmount           float64   `json:"cash_amount" gorm:"not null;type:numeric(16,2);default:0"`
	UpiAmount            float64   `json:"upi_amount" gorm:"not null;type:numeric(16,2);default:0"`
	BankTransferAmount   float64   `json:"bank_transfer_amount" gorm:"not null;type:numeric(16,2);default:0"`
	ChequeAmount         float64   `json:"cheque_amount" gorm:"not null;type:numeric(16,2);default:0"`
	PrincipalBefore      float64   `json:"principal_before" gorm:"not null;type:numeric(16,2)"`
	PrincipalAfter       float64   `json:"principal_after" gorm:"not null;type:numeric(16,2)"`
	InterestBefore       float64   `json:"interest_before" gorm:"not null;type:numeric(16,2)"`
	InterestAfter        float64   `json:"interest_after" gorm:"not null;type:numeric(16,2)"`
	OccurredOn           time.Time `json:"occurred_on" gorm:"not null"`
	RecordedByEmployeeID *uint     `json:"recorded_by_employee_id"`
	Reference            string    `json:"reference" gorm:"size:80"`
	CashMovementID       *uint     `json:"cash_movement_id"`
	CreatedAt            time.Time `json:"created_at"`
}
