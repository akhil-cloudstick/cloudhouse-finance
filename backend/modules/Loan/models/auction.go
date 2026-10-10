package models

import (
	"cloudhouse/backend/config"
	"time"
)

const (
	AuctionStageEligible  = "AuctionEligible"
	AuctionStageNotice    = "NoticeIssued"
	AuctionStageScheduled = "AuctionScheduled"
	AuctionStageAuctioned = "Auctioned"
	AuctionStageSettled   = "Settled"
	AuctionStageWithdrawn = "Withdrawn"
)

type AuctionRecord struct {
	config.TenantScoped
	ID                       uint                     `json:"id" gorm:"primaryKey"`
	LoanID                   uint                     `json:"loan_id" gorm:"not null;index"`
	Stage                    string                   `json:"stage" gorm:"not null;size:20"`
	AuctionEligibleDate      time.Time                `json:"auction_eligible_date" gorm:"not null"`
	AuctionDate              *time.Time               `json:"auction_date,omitempty"`
	AuctionReferenceNumber   string                   `json:"auction_reference_number" gorm:"size:60"`
	SaleAmount               float64                  `json:"sale_amount" gorm:"type:numeric(16,2);default:0"`
	AuctionExpenses          float64                  `json:"auction_expenses" gorm:"type:numeric(16,2);default:0"`
	SurplusShortfall         float64                  `json:"surplus_shortfall" gorm:"type:numeric(16,2);default:0"`
	FinalSettlementStatus    string                   `json:"final_settlement_status" gorm:"not null;size:24;default:'Pending'"`
	SurplusPayableAmount     float64                  `json:"surplus_payable_amount" gorm:"type:numeric(16,2);default:0"`
	SurplusDisposition       string                   `json:"surplus_disposition,omitempty" gorm:"size:24"`
	SurplusPaidOutMovementID *uint                    `json:"surplus_paid_out_movement_id,omitempty"`
	Notices                  []AuctionNotice          `json:"notices,omitempty" gorm:"foreignKey:AuctionRecordID"`
	Events                   []AuctionEvent           `json:"events,omitempty" gorm:"foreignKey:AuctionRecordID"`
	DecisionRequests         []AuctionDecisionRequest `json:"decision_requests,omitempty" gorm:"foreignKey:AuctionRecordID"`
	CreatedAt                time.Time                `json:"created_at"`
	UpdatedAt                time.Time                `json:"updated_at"`
}

type AuctionEvent struct {
	config.TenantScoped
	ID              uint      `json:"id" gorm:"primaryKey"`
	AuctionRecordID uint      `json:"auction_record_id" gorm:"not null;index"`
	Action          string    `json:"action" gorm:"not null;size:30"`
	ActorEmployeeID *uint     `json:"actor_employee_id,omitempty"`
	ActorRole       string    `json:"actor_role,omitempty" gorm:"size:40"`
	Remarks         string    `json:"remarks,omitempty" gorm:"size:255"`
	CreatedAt       time.Time `json:"created_at"`
}

type AuctionDecisionRequest struct {
	config.TenantScoped
	ID                   uint       `json:"id" gorm:"primaryKey"`
	AuctionRecordID      uint       `json:"auction_record_id" gorm:"not null;index"`
	LoanID               uint       `json:"loan_id" gorm:"not null;index"`
	Kind                 string     `json:"kind" gorm:"not null;size:20"`
	TriggeredByPaymentID *uint      `json:"triggered_by_payment_id,omitempty"`
	AmountPaid           float64    `json:"amount_paid" gorm:"type:numeric(16,2);default:0"`
	OutstandingAtRequest float64    `json:"outstanding_at_request" gorm:"type:numeric(16,2);default:0"`
	Status               string     `json:"status" gorm:"not null;size:24;default:'Pending'"`
	DecidedByEmployeeID  *uint      `json:"decided_by_employee_id,omitempty"`
	DecidedByRole        string     `json:"decided_by_role,omitempty" gorm:"size:40"`
	DecisionRemarks      string     `json:"decision_remarks,omitempty" gorm:"size:255"`
	DecidedAt            *time.Time `json:"decided_at,omitempty"`
	CreatedAt            time.Time  `json:"created_at"`
	UpdatedAt            time.Time  `json:"updated_at"`
}

type AuctionNotice struct {
	config.TenantScoped
	ID              uint      `json:"id" gorm:"primaryKey"`
	AuctionRecordID uint      `json:"auction_record_id" gorm:"not null;index"`
	IssuedAt        time.Time `json:"issued_at" gorm:"not null"`
	Method          string    `json:"method" gorm:"size:40"`
	Remarks         string    `json:"remarks" gorm:"size:255"`
	CreatedAt       time.Time `json:"created_at"`
}
