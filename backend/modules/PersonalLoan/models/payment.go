package models

import (
	commonModels "cloudhouse/backend/common/models"
	"cloudhouse/backend/config"
	"time"
)

type PersonalLoanPayment struct {
	config.TenantScoped
	ID                   uint               `json:"id" gorm:"primaryKey"`
	PersonalLoanID       uint               `json:"personal_loan_id" gorm:"not null;index"`
	Amount               float64            `json:"amount" gorm:"not null;type:numeric(16,2)"`
	PaidOn               time.Time          `json:"paid_on" gorm:"not null"`
	ReceivedByEmployeeID *uint              `json:"received_by_employee_id"`
	Method               string             `json:"method" gorm:"size:30"`
	Reference            string             `json:"reference" gorm:"size:80"`
	Description          string             `json:"description" gorm:"size:255"`
	CashAmount           float64            `json:"cash_amount" gorm:"not null;type:numeric(16,2);default:0"`
	UpiAmount            float64            `json:"upi_amount" gorm:"not null;type:numeric(16,2);default:0"`
	BankTransferAmount   float64            `json:"bank_transfer_amount" gorm:"not null;type:numeric(16,2);default:0"`
	ChequeAmount         float64            `json:"cheque_amount" gorm:"not null;type:numeric(16,2);default:0"`
	BankID               *uint              `json:"bank_id"`
	BankRef              *commonModels.Bank `json:"bank_ref,omitempty" gorm:"foreignKey:BankID"`
	NeedsModeReview      bool               `json:"needs_mode_review" gorm:"not null;default:false"`
	RunningBalance       float64            `json:"running_balance" gorm:"not null;type:numeric(16,2)"`
	InstallmentID        *uint              `json:"installment_id"`
	CreatedAt            time.Time          `json:"created_at"`
}
