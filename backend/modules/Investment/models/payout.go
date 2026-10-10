package models

import (
	"cloudhouse/backend/config"
	"time"
)

type InvestmentPayout struct {
	config.TenantScoped
	ID                 uint       `json:"id" gorm:"primaryKey"`
	InvestmentID       uint       `json:"investment_id" gorm:"not null;index"`
	SequenceNo         int        `json:"sequence_no" gorm:"not null"`
	DueDate            time.Time  `json:"due_date" gorm:"not null"`
	Amount             float64    `json:"amount" gorm:"not null;type:numeric(16,2)"`
	IsPrincipalReturn  bool       `json:"is_principal_return" gorm:"not null;default:false"`
	Status             string     `json:"status" gorm:"not null;size:15;default:'Pending'"`
	CashAmount         float64    `json:"cash_amount" gorm:"not null;type:numeric(16,2);default:0"`
	UpiAmount          float64    `json:"upi_amount" gorm:"not null;type:numeric(16,2);default:0"`
	BankTransferAmount float64    `json:"bank_transfer_amount" gorm:"not null;type:numeric(16,2);default:0"`
	ChequeAmount       float64    `json:"cheque_amount" gorm:"not null;type:numeric(16,2);default:0"`
	PaidAt             *time.Time `json:"paid_at"`
	PaidByEmployeeID   *uint      `json:"paid_by_employee_id"`
	CashMovementID     *uint      `json:"cash_movement_id"`
	CreatedAt          time.Time  `json:"created_at"`
	UpdatedAt          time.Time  `json:"updated_at"`
}
