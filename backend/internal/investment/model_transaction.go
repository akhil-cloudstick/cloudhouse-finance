package investment

import (
	"time"

	"cloudhouse/backend/internal/platform"
)

// Type values for InvestmentTransaction.Type.
const (
	TxTypeDeposit    = "Deposit"
	TxTypeWithdrawal = "Withdrawal"
)

// InvestmentTransaction is one append-only ledger row against an
// EngineLive Investment — an Add Cash deposit, or a Withdraw of Interest,
// Principal, or both — mirrors loan.LoanTopUp's append-only ledger shape
// and its four split-mode cash columns. This is the Live-engine
// replacement for EngineSchedule's precomputed InvestmentPayout schedule;
// an EngineSchedule investment never writes this table (see
// Service.AddCash/Withdraw's Engine guard).
type InvestmentTransaction struct {
	platform.TenantScoped
	ID           uint `json:"id" gorm:"primaryKey"`
	InvestmentID uint `json:"investmentId" gorm:"not null;index"`

	Type string `json:"type" gorm:"not null;size:12"` // Deposit | Withdrawal

	// Amount is PrincipalAmount + InterestAmount, kept as its own column for
	// display/reporting parity with every other ledger row in this codebase
	// (LoanTopUp.Amount, InvestmentPayout.Amount).
	//
	// PrincipalAmount/InterestAmount are two EXPLICIT amount fields rather
	// than one Amount + a "withdraw from" enum — this is how a withdrawal's
	// Interest/Principal/Both choice is represented: either can be zero,
	// their sum must equal Amount, and no enum value can silently disagree
	// with the numbers (the same reasoning platform.ValidateSplit already
	// applies to the four payment-mode columns everywhere else in this
	// codebase). A Deposit always has InterestAmount == 0 — depositing only
	// ever adds principal.
	Amount          float64 `json:"amount" gorm:"not null;type:numeric(16,2)"`
	PrincipalAmount float64 `json:"principalAmount" gorm:"not null;type:numeric(16,2);default:0"`
	InterestAmount  float64 `json:"interestAmount" gorm:"not null;type:numeric(16,2);default:0"`

	// CashAmount/UpiAmount/BankTransferAmount/ChequeAmount — same split-mode
	// convention as LoanTopUp/LoanPayment/InvestmentPayout, validated via
	// platform.ValidateSplit against Amount.
	CashAmount         float64 `json:"cashAmount" gorm:"not null;type:numeric(16,2);default:0"`
	UpiAmount          float64 `json:"upiAmount" gorm:"not null;type:numeric(16,2);default:0"`
	BankTransferAmount float64 `json:"bankTransferAmount" gorm:"not null;type:numeric(16,2);default:0"`
	ChequeAmount       float64 `json:"chequeAmount" gorm:"not null;type:numeric(16,2);default:0"`

	// PrincipalBefore/PrincipalAfter/InterestBefore/InterestAfter snapshot
	// the investment's OutstandingPrincipal/OutstandingInterest immediately
	// before and after this transaction was applied — an audit trail that
	// reads correctly on its own even if the investment's live balances
	// later move again.
	PrincipalBefore float64 `json:"principalBefore" gorm:"not null;type:numeric(16,2)"`
	PrincipalAfter  float64 `json:"principalAfter" gorm:"not null;type:numeric(16,2)"`
	InterestBefore  float64 `json:"interestBefore" gorm:"not null;type:numeric(16,2)"`
	InterestAfter   float64 `json:"interestAfter" gorm:"not null;type:numeric(16,2)"`

	OccurredOn           time.Time `json:"occurredOn" gorm:"not null"`
	RecordedByEmployeeID *uint     `json:"recordedByEmployeeId"`
	Reference            string    `json:"reference" gorm:"size:80"`
	CashMovementID       *uint     `json:"cashMovementId"`

	CreatedAt time.Time `json:"createdAt"`
}

func (InvestmentTransaction) TableName() string { return "investment_transactions" }
