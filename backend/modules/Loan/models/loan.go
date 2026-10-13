package models

import (
	commonModels "cloudhouse/backend/common/models"
	"cloudhouse/backend/config"
	"time"

	"gorm.io/gorm"
)

const (
	StatusPendingApproval     = "Pending Approval"
	StatusActive              = "Active"
	StatusDueSoon             = "Due Soon"
	StatusOverdue             = "Overdue"
	StatusClosureRequested    = "Closure Requested"
	StatusClosed              = "Closed"
	StatusAuctionEligible     = "Auction Eligible"
	StatusAuctioned           = "Auctioned"
	StatusRejected            = "Rejected"
	StatusAuctionedBalanceDue = "Auctioned - Balance Due"
)

const (
	ApprovalStageApproved = "Approved"
	ApprovalStageRejected = "Rejected"
)

const (
	ApprovalStagePendingManager = "PendingManager"
)

const (
	BankPledgeStatusPledged = "Bank Pledged"
)

var BankPledgeIneligibleStatuses = []string{
	StatusClosed,
	StatusRejected,
	StatusClosureRequested,
	StatusAuctioned,
	StatusAuctionedBalanceDue,
	StatusPendingApproval,
}

type Loan struct {
	config.TenantScoped
	ID                         uint                    `json:"id" gorm:"primaryKey"`
	LoanNumber                 string                  `json:"loan_number" gorm:"index;size:20"`
	BranchID                   uint                    `json:"branch_id" gorm:"not null"`
	Branch                     commonModels.Branch     `json:"branch" gorm:"foreignKey:BranchID"`
	CustomerID                 uint                    `json:"customer_id" gorm:"not null"`
	Customer                   commonModels.Customer   `json:"customer" gorm:"foreignKey:CustomerID"`
	SchemeID                   uint                    `json:"scheme_id" gorm:"not null"`
	Scheme                     commonModels.Scheme     `json:"scheme" gorm:"foreignKey:SchemeID"`
	SchemeCode                 string                  `json:"scheme_code" gorm:"size:20"`
	SchemeInterestRate         float64                 `json:"scheme_interest_rate"`
	SchemeDurationMonths       int                     `json:"scheme_duration_months"`
	SchemeLTVPercent           float64                 `json:"scheme_ltv_percent"`
	SchemeInterestMethod       string                  `json:"scheme_interest_method" gorm:"size:80"`
	SchemePenalRate            float64                 `json:"scheme_penal_rate"`
	SchemeRateTiers            []commonModels.RateTier `json:"scheme_rate_tiers" gorm:"serializer:json;type:text"`
	SchemeMinimumDays          int                     `json:"scheme_minimum_days" gorm:"not null;default:0"`
	RateTierLevel              int                     `json:"rate_tier_level" gorm:"not null;default:0"`
	ArrearsSince               *time.Time              `json:"arrears_since"`
	ServiceChargeType          string                  `json:"service_charge_type" gorm:"size:10"`
	ServiceChargeValue         float64                 `json:"service_charge_value" gorm:"type:numeric(16,2);default:0"`
	ServiceChargeMode          string                  `json:"service_charge_mode" gorm:"size:20"`
	ServiceChargeAmount        float64                 `json:"service_charge_amount" gorm:"type:numeric(16,2);default:0"`
	OpenedDate                 time.Time               `json:"opened_date" gorm:"not null"`
	DueDate                    time.Time               `json:"due_date" gorm:"not null"`
	AdditionalInfo             string                  `json:"additional_info" gorm:"size:2000"`
	OverallPhotoURL            string                  `json:"overall_photo_url" gorm:"size:512"`
	TotalNetWeight             float64                 `json:"total_net_weight"`
	TotalGoldValue             float64                 `json:"total_gold_value" gorm:"type:numeric(16,2);default:0"`
	EligibleLoanAmount         float64                 `json:"eligible_loan_amount" gorm:"type:numeric(16,2);default:0"`
	PrincipalAmount            float64                 `json:"principal_amount" gorm:"not null;type:numeric(16,2)"`
	OutstandingAmount          float64                 `json:"outstanding_amount" gorm:"not null;type:numeric(16,2)"`
	OutstandingProcessingFee   float64                 `json:"outstanding_processing_fee" gorm:"type:numeric(16,2);default:0"`
	AccruedInterest            float64                 `json:"accrued_interest" gorm:"type:numeric(16,2);default:0"`
	InterestPaid               float64                 `json:"interest_paid" gorm:"type:numeric(16,2);default:0"`
	AccruedPenalInterest       float64                 `json:"accrued_penal_interest" gorm:"type:numeric(16,2);default:0"`
	PenalInterestPaid          float64                 `json:"penal_interest_paid" gorm:"type:numeric(16,2);default:0"`
	LastAccrualDate            time.Time               `json:"last_accrual_date"`
	OutstandingInterest        float64                 `json:"outstanding_interest" gorm:"-"`
	OutstandingPenalInterest   float64                 `json:"outstanding_penal_interest" gorm:"-"`
	TotalOutstandingBalance    float64                 `json:"total_outstanding_balance" gorm:"-"`
	SettlementAmount           float64                 `json:"settlement_amount" gorm:"-"`
	TotalPaid                  float64                 `json:"total_paid" gorm:"-"`
	IsDueSoon                  bool                    `json:"is_due_soon" gorm:"-"`
	IsOverdue                  bool                    `json:"is_overdue" gorm:"-"`
	IsDefaulted                bool                    `json:"is_defaulted" gorm:"-"`
	DaysOverdue                int                     `json:"days_overdue" gorm:"-"`
	DueSoonNotifiedAt          *time.Time              `json:"-"`
	OverdueNotifiedAt          *time.Time              `json:"-"`
	InterestRemindedAt         *time.Time              `json:"-"`
	ApprovalWarning            string                  `json:"approval_warning" gorm:"-"`
	Status                     string                  `json:"status" gorm:"not null;size:30"`
	ApprovalStage              string                  `json:"approval_stage" gorm:"not null;size:30"`
	RejectedByEmployeeID       *uint                   `json:"rejected_by_employee_id"`
	RejectedByName             string                  `json:"rejected_by_name" gorm:"size:120"`
	RejectedAt                 *time.Time              `json:"rejected_at"`
	RejectionRemarks           string                  `json:"rejection_remarks" gorm:"size:255"`
	SanctionedAmount           float64                 `json:"sanctioned_amount" gorm:"type:numeric(16,2);default:0"`
	DisbursedAmount            float64                 `json:"disbursed_amount" gorm:"type:numeric(16,2);default:0"`
	DisbursementDate           *time.Time              `json:"disbursement_date"`
	BankPledgeStatus           string                  `json:"bank_pledge_status" gorm:"not null;size:20;default:'Not Pledged'"`
	AuctionDate                *time.Time              `json:"auction_date"`
	AuctionAmount              *float64                `json:"auction_amount" gorm:"type:numeric(16,2)"`
	IndemnityBondDocumentID    string                  `json:"indemnity_bond_document_id" gorm:"size:100"`
	IndemnityBondSignRequestID string                  `json:"indemnity_bond_sign_request_id" gorm:"size:100"`
	IndemnityBondSignStatus    string                  `json:"indemnity_bond_sign_status" gorm:"size:20"`
	IndemnityBondSignedURL     string                  `json:"indemnity_bond_signed_url" gorm:"size:255"`
	IndemnityBondSignedAt      *time.Time              `json:"indemnity_bond_signed_at"`
	Ornaments                  []Ornament              `json:"ornaments,omitempty" gorm:"foreignKey:LoanID"`
	Approvals                  []LoanApproval          `json:"approvals,omitempty" gorm:"foreignKey:LoanID"`
	Payments                   []LoanPayment           `json:"payments,omitempty" gorm:"foreignKey:LoanID"`
	Pledges                    []BankPledgeRecord      `json:"bank_pledges,omitempty" gorm:"foreignKey:LoanID"`
	CreatedAt                  time.Time               `json:"created_at"`
	UpdatedAt                  time.Time               `json:"updated_at"`
	DeletedAt                  gorm.DeletedAt          `json:"-" gorm:"index"`
}
