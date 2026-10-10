package models

import (
	commonModels "cloudhouse/backend/common/models"
	"cloudhouse/backend/config"
	"time"

	"gorm.io/gorm"
)

const (
	StatusActive          = "Active"
	StatusClosed          = "Closed"
	StatusPending         = "Pending"
	StatusPendingApproval = "Pending Approval"
)

var NotDisbursedStatuses = []string{StatusPendingApproval, "Rejected"}

const (
	InterestTypePercentage = "Percentage"
)

const (
	FrequencyDaily = "Daily"
)

type PersonalLoan struct {
	config.TenantScoped
	ID                             uint                      `json:"id" gorm:"primaryKey"`
	LoanNumber                     string                    `json:"loan_number" gorm:"index;size:20"`
	BranchID                       uint                      `json:"branch_id" gorm:"not null"`
	Branch                         commonModels.Branch       `json:"branch" gorm:"foreignKey:BranchID"`
	CustomerID                     uint                      `json:"customer_id" gorm:"not null"`
	Customer                       commonModels.Customer     `json:"customer" gorm:"foreignKey:CustomerID"`
	CreatedByEmployeeID            uint                      `json:"created_by_employee_id"`
	PrincipalAmount                float64                   `json:"principal_amount" gorm:"not null;type:numeric(16,2)"`
	InterestType                   string                    `json:"interest_type" gorm:"not null;size:20"`
	InterestValue                  float64                   `json:"interest_value" gorm:"not null;type:numeric(16,2)"`
	InterestAmount                 float64                   `json:"interest_amount" gorm:"not null;type:numeric(16,2)"`
	DisbursedAmount                float64                   `json:"disbursed_amount" gorm:"not null;type:numeric(16,2)"`
	DisbursementCashAmount         float64                   `json:"disbursement_cash_amount" gorm:"not null;type:numeric(16,2);default:0"`
	DisbursementUpiAmount          float64                   `json:"disbursement_upi_amount" gorm:"not null;type:numeric(16,2);default:0"`
	DisbursementBankTransferAmount float64                   `json:"disbursement_bank_transfer_amount" gorm:"not null;type:numeric(16,2);default:0"`
	DisbursementChequeAmount       float64                   `json:"disbursement_cheque_amount" gorm:"not null;type:numeric(16,2);default:0"`
	DisbursementBankID             *uint                     `json:"disbursement_bank_id,omitempty"`
	FullDisbursement               bool                      `json:"full_disbursement" gorm:"not null;default:false"`
	Frequency                      string                    `json:"frequency" gorm:"not null;size:10"`
	TenureCount                    int                       `json:"tenure_count" gorm:"not null"`
	InstallmentAmount              float64                   `json:"installment_amount" gorm:"not null;type:numeric(16,2)"`
	OutstandingAmount              float64                   `json:"outstanding_amount" gorm:"not null;type:numeric(16,2)"`
	TotalPaid                      float64                   `json:"total_paid" gorm:"not null;type:numeric(16,2);default:0"`
	Status                         string                    `json:"status" gorm:"not null;size:20"`
	ApprovalStage                  string                    `json:"approval_stage" gorm:"size:30;default:''"`
	OpenedDate                     time.Time                 `json:"opened_date" gorm:"not null"`
	DisbursedAt                    time.Time                 `json:"disbursed_at"`
	ClosedAt                       *time.Time                `json:"closed_at"`
	RenewedFromLoanID              *uint                     `json:"renewed_from_loan_id"`
	RenewedToLoanID                *uint                     `json:"renewed_to_loan_id"`
	PenalInterestRate              float64                   `json:"penal_interest_rate" gorm:"not null;type:numeric(16,2);default:0"`
	PenalFlatAmount                float64                   `json:"penal_flat_amount" gorm:"not null;type:numeric(16,2);default:0"`
	GracePeriodDays                int                       `json:"grace_period_days" gorm:"not null;default:0"`
	PenalCycleCount                int                       `json:"penal_cycle_count" gorm:"not null;default:0"`
	TotalPenalInterestCharged      float64                   `json:"total_penal_interest_charged" gorm:"not null;type:numeric(16,2);default:0"`
	LastPenalAppliedAt             *time.Time                `json:"last_penal_applied_at"`
	Installments                   []PersonalLoanInstallment `json:"installments,omitempty" gorm:"foreignKey:PersonalLoanID"`
	Payments                       []PersonalLoanPayment     `json:"payments,omitempty" gorm:"foreignKey:PersonalLoanID"`
	CreatedAt                      time.Time                 `json:"created_at"`
	UpdatedAt                      time.Time                 `json:"updated_at"`
	DeletedAt                      gorm.DeletedAt            `json:"-" gorm:"index"`
}
