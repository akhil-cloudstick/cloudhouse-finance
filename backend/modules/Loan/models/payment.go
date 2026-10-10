package models

import (
	commonModels "cloudhouse/backend/common/models"
	"cloudhouse/backend/config"
	"time"
)

const (
	PaymentTypeInterest        = "Interest"
	PaymentTypePenalInterest   = "Penal Interest"
	PaymentTypePrincipal       = "Principal"
	PaymentTypePartial         = "Partial"
	PaymentTypeFullSettlement  = "Full Settlement"
	PaymentTypeWaiver          = "Waiver"
	PaymentTypeDiscount        = "Discount"
	PaymentTypeAuctionSale     = "Auction Sale"
	PaymentTypeAuctionWriteOff = "Auction Write-Off"
	PaymentTypeDisbursement    = "Disbursement"
)

type LoanPayment struct {
	config.TenantScoped
	ID                     uint               `json:"id" gorm:"primaryKey"`
	LoanID                 uint               `json:"loan_id" gorm:"not null;index"`
	Amount                 float64            `json:"amount" gorm:"not null;type:numeric(16,2)"`
	Type                   string             `json:"type" gorm:"not null;size:30"`
	PaidOn                 time.Time          `json:"paid_on" gorm:"not null"`
	ReceivedByEmployeeID   *uint              `json:"received_by_employee_id"`
	Description            string             `json:"description" gorm:"size:255"`
	Method                 string             `json:"method" gorm:"size:30"`
	Reference              string             `json:"reference" gorm:"size:80"`
	CashAmount             float64            `json:"cash_amount" gorm:"not null;type:numeric(16,2);default:0"`
	UpiAmount              float64            `json:"upi_amount" gorm:"not null;type:numeric(16,2);default:0"`
	BankTransferAmount     float64            `json:"bank_transfer_amount" gorm:"not null;type:numeric(16,2);default:0"`
	ChequeAmount           float64            `json:"cheque_amount" gorm:"not null;type:numeric(16,2);default:0"`
	BankID                 *uint              `json:"bank_id"`
	BankRef                *commonModels.Bank `json:"bank_ref,omitempty" gorm:"foreignKey:BankID"`
	NeedsModeReview        bool               `json:"needs_mode_review" gorm:"not null;default:false"`
	ProcessingFeeApplied   float64            `json:"processing_fee_applied" gorm:"type:numeric(16,2);default:0"`
	PenalInterestApplied   float64            `json:"penal_interest_applied" gorm:"type:numeric(16,2);default:0"`
	InterestApplied        float64            `json:"interest_applied" gorm:"type:numeric(16,2);default:0"`
	PrincipalApplied       float64            `json:"principal_applied" gorm:"type:numeric(16,2);default:0"`
	RunningBalance         float64            `json:"running_balance" gorm:"type:numeric(16,2);default:0"`
	ProcessingFee          float64            `json:"processing_fee" gorm:"type:numeric(16,2);default:0"`
	CashTransactionGroupID string             `json:"cash_transaction_group_id,omitempty" gorm:"size:40;index"`
	CreatedAt              time.Time          `json:"created_at"`
}
