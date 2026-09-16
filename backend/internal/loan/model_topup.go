package loan

import (
	"time"

	"cloudhouse/backend/internal/platform"
)

// Status values for LoanTopUp.Status — append-only ledger per Phase 0.5 §6:
// correcting a mistake means recording a new reversal entry that references
// the original, never editing or deleting it. Building the reversal
// workflow itself is out of scope; these columns exist so a future one
// doesn't need another migration.
const (
	TopUpStatusActive   = "Active"
	TopUpStatusReversed = "Reversed"
)

// LoanTopUp records one instance of a customer drawing additional cash
// against an already-active loan's spare eligible value, without closing/
// reopening it (see Service.TopUpLoan). EligibleAmountAtTopUp snapshots the
// headroom calculation's own EligibleLoanAmount at the moment of approval,
// for audit — the live value on Loan can drift afterwards (more ornaments,
// another top-up) without changing what justified THIS one.
type LoanTopUp struct {
	platform.TenantScoped
	ID     uint `json:"id" gorm:"primaryKey"`
	LoanID uint `json:"loanId" gorm:"not null;index"`

	Amount                float64 `json:"amount" gorm:"not null;type:numeric(16,2)"`
	EligibleAmountAtTopUp float64 `json:"eligibleAmountAtTopUp" gorm:"not null;type:numeric(16,2)"`

	// CashAmount/UpiAmount/BankTransferAmount/ChequeAmount — see
	// LoanPayment's identical fields for the full rationale; must sum to
	// Amount within platform.RoundMoney's tolerance (platform.ValidateSplit).
	CashAmount         float64 `json:"cashAmount" gorm:"not null;type:numeric(16,2);default:0"`
	UpiAmount          float64 `json:"upiAmount" gorm:"not null;type:numeric(16,2);default:0"`
	BankTransferAmount float64 `json:"bankTransferAmount" gorm:"not null;type:numeric(16,2);default:0"`
	ChequeAmount       float64 `json:"chequeAmount" gorm:"not null;type:numeric(16,2);default:0"`

	OccurredOn           time.Time `json:"occurredOn" gorm:"not null"`
	ReceivedByEmployeeID *uint     `json:"receivedByEmployeeId"`
	Reference            string    `json:"reference" gorm:"size:80"`

	Status string `json:"status" gorm:"not null;size:15;default:'Active'"`
	// ReversalOfMovementID is a self-reference (to another LoanTopUp.ID) —
	// see the package-level Status* doc comment.
	ReversalOfMovementID *uint `json:"reversalOfMovementId"`

	CreatedAt time.Time `json:"createdAt"`
}

func (LoanTopUp) TableName() string { return "loan_top_ups" }
