package models

import (
	"cloudhouse/backend/config"
	"time"
)

const (
	RequestTypeExtension  = "Extension"
	RequestTypeRelease    = "Release"
	RequestStatusPending  = "Pending"
	RequestStatusApproved = "Approved"
	RequestedByStaff      = "Staff"
)

type LoanRequest struct {
	config.TenantScoped
	ID                       uint                  `json:"id" gorm:"primaryKey"`
	LoanID                   uint                  `json:"loan_id" gorm:"not null;index"`
	Loan                     Loan                  `json:"loan" gorm:"foreignKey:LoanID"`
	Type                     string                `json:"type" gorm:"not null;size:20"`
	Status                   string                `json:"status" gorm:"not null;size:20"`
	RequestedBy              string                `json:"requested_by" gorm:"not null;size:20"`
	Detail                   string                `json:"detail" gorm:"size:255"`
	Amount                   float64               `json:"amount" gorm:"type:numeric(16,2);default:0"`
	RequestedExtensionMonths *int                  `json:"requested_extension_months,omitempty"`
	NewDueDate               *time.Time            `json:"new_due_date,omitempty"`
	ApprovalStage            string                `json:"approval_stage,omitempty" gorm:"size:30"`
	IsPartial                bool                  `json:"is_partial"`
	PaymentVerified          bool                  `json:"payment_verified"`
	PacketVerified           bool                  `json:"packet_verified"`
	BankPledgeVerified       bool                  `json:"bank_pledge_verified"`
	CustomerConfirmed        bool                  `json:"customer_confirmed"`
	VerificationNotes        string                `json:"verification_notes" gorm:"size:255"`
	CustomerSawGold          bool                  `json:"customer_saw_gold"`
	PaymentRecorded          bool                  `json:"payment_recorded"`
	Locked                   bool                  `json:"locked"`
	RecordedDiscount         float64               `json:"recorded_discount" gorm:"type:numeric(16,2);default:0"`
	RecordedPayment          float64               `json:"recorded_payment" gorm:"type:numeric(16,2);default:0"`
	PaymentDueDate           *time.Time            `json:"payment_due_date,omitempty"`
	Charges                  float64               `json:"charges" gorm:"type:numeric(16,2);default:0"`
	ChargesApplied           float64               `json:"charges_applied" gorm:"type:numeric(16,2);default:0"`
	SettlementAmount         float64               `json:"settlement_amount" gorm:"type:numeric(16,2);default:0"`
	Remarks                  string                `json:"remarks" gorm:"size:255"`
	RequestedAt              time.Time             `json:"requested_at" gorm:"not null"`
	DecidedAt                *time.Time            `json:"decided_at,omitempty"`
	DecidedByEmployeeID      *uint                 `json:"decided_by_employee_id,omitempty"`
	OrnamentSelections       []LoanRequestOrnament `json:"ornament_selections,omitempty" gorm:"foreignKey:RequestID"`
	CreatedAt                time.Time             `json:"created_at"`
	UpdatedAt                time.Time             `json:"updated_at"`
}

type LoanRequestOrnament struct {
	config.TenantScoped
	ID         uint      `json:"id" gorm:"primaryKey"`
	RequestID  uint      `json:"request_id" gorm:"not null;index"`
	OrnamentID uint      `json:"ornament_id" gorm:"not null;index"`
	CreatedAt  time.Time `json:"created_at"`
}

type RequestApproval struct {
	config.TenantScoped
	ID              uint      `json:"id" gorm:"primaryKey"`
	RequestID       uint      `json:"request_id" gorm:"not null;index"`
	Stage           string    `json:"stage" gorm:"not null;size:30"`
	Action          string    `json:"action" gorm:"not null;size:20"`
	ActorEmployeeID uint      `json:"actor_employee_id" gorm:"not null"`
	Remarks         string    `json:"remarks" gorm:"size:255"`
	CreatedAt       time.Time `json:"created_at"`
}
