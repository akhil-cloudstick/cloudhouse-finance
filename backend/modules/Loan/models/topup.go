package models

import (
	"cloudhouse/backend/config"
	"time"
)

const (
	TopUpStatusActive  = "Active"
	TopUpStatusPending = "Pending"
)

type LoanTopUp struct {
	config.TenantScoped
	ID                    uint      `json:"id" gorm:"primaryKey"`
	LoanID                uint      `json:"loan_id" gorm:"not null;index"`
	Amount                float64   `json:"amount" gorm:"not null;type:numeric(16,2)"`
	EligibleAmountAtTopUp float64   `json:"eligible_amount_at_top_up" gorm:"not null;type:numeric(16,2)"`
	CashAmount            float64   `json:"cash_amount" gorm:"not null;type:numeric(16,2);default:0"`
	UpiAmount             float64   `json:"upi_amount" gorm:"not null;type:numeric(16,2);default:0"`
	BankTransferAmount    float64   `json:"bank_transfer_amount" gorm:"not null;type:numeric(16,2);default:0"`
	ChequeAmount          float64   `json:"cheque_amount" gorm:"not null;type:numeric(16,2);default:0"`
	OccurredOn            time.Time `json:"occurred_on" gorm:"not null"`
	ReceivedByEmployeeID  *uint     `json:"received_by_employee_id"`
	Reference             string    `json:"reference" gorm:"size:80"`
	Status                string    `json:"status" gorm:"not null;size:15;default:'Active'"`
	ApprovalStage         string    `json:"approval_stage" gorm:"size:30;default:''"`
	SettleInterest        string    `json:"settle_interest" gorm:"size:10;default:''"`
	BankID                *uint     `json:"bank_id"`
	ReversalOfMovementID  *uint     `json:"reversal_of_movement_id"`
	CreatedAt             time.Time `json:"created_at"`
}
