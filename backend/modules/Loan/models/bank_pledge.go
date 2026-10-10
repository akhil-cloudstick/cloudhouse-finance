package models

import (
	"cloudhouse/backend/config"
	"time"
)

const (
	BankPledgeCashTreatmentCashIn     = "CashIn"
	BankPledgeCashTreatmentRecordOnly = "RecordOnly"
)

const (
	BankPledgeStatusRecordActive = "Active"
)

type BankPledgeRecord struct {
	config.TenantScoped
	ID                    uint              `json:"id" gorm:"primaryKey"`
	LoanID                uint              `json:"loan_id" gorm:"not null;index"`
	BankID                *uint             `json:"bank_id"`
	BankName              string            `json:"bank_name" gorm:"not null;size:120"`
	PledgedAmount         float64           `json:"pledged_amount" gorm:"not null;type:numeric(16,2)"`
	PledgeDate            time.Time         `json:"pledge_date" gorm:"not null"`
	ReleaseDate           *time.Time        `json:"release_date"`
	BankPledgeDueDate     *time.Time        `json:"bank_pledge_due_date"`
	PledgedGrossWeight    float64           `json:"pledged_gross_weight"`
	PledgedNetWeight      float64           `json:"pledged_net_weight"`
	BankInterestRate      float64           `json:"bank_interest_rate"`
	ReferenceNumber       string            `json:"reference_number" gorm:"size:60"`
	CashMovementID        *uint             `json:"cash_movement_id,omitempty"`
	ExpenseID             *uint             `json:"expense_id,omitempty"`
	ReleaseCashMovementID *uint             `json:"release_cash_movement_id,omitempty"`
	ReleaseExpenseID      *uint             `json:"release_expense_id,omitempty"`
	CashTreatment         string            `json:"cash_treatment" gorm:"not null;size:20;default:'CashIn'"`
	CashAmount            float64           `json:"cash_amount" gorm:"not null;type:numeric(16,2);default:0"`
	UpiAmount             float64           `json:"upi_amount" gorm:"not null;type:numeric(16,2);default:0"`
	BankTransferAmount    float64           `json:"bank_transfer_amount" gorm:"not null;type:numeric(16,2);default:0"`
	ChequeAmount          float64           `json:"cheque_amount" gorm:"not null;type:numeric(16,2);default:0"`
	ReceivedBankID        *uint             `json:"received_bank_id,omitempty"`
	Status                string            `json:"status" gorm:"not null;size:20;default:'Active'"`
	VoidedAt              *time.Time        `json:"voided_at,omitempty"`
	VoidReason            string            `json:"void_reason,omitempty" gorm:"size:255"`
	VoidCashMovementID    *uint             `json:"void_cash_movement_id,omitempty"`
	Events                []BankPledgeEvent `json:"events,omitempty" gorm:"foreignKey:BankPledgeRecordID"`
	CreatedAt             time.Time         `json:"created_at"`
}

type BankPledgeEvent struct {
	config.TenantScoped
	ID                 uint      `json:"id" gorm:"primaryKey"`
	BankPledgeRecordID uint      `json:"bank_pledge_record_id" gorm:"not null;index"`
	Action             string    `json:"action" gorm:"not null;size:20"`
	ActorEmployeeID    *uint     `json:"actor_employee_id,omitempty"`
	ActorRole          string    `json:"actor_role,omitempty" gorm:"size:40"`
	Amount             float64   `json:"amount" gorm:"type:numeric(16,2);default:0"`
	Remarks            string    `json:"remarks,omitempty" gorm:"size:255"`
	CreatedAt          time.Time `json:"created_at"`
}
