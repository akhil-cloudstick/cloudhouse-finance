package personalloan

import (
	"time"

	"cloudhouse/backend/internal/platform"
)

// PaymentMethodRenewalRollover marks the synthetic ledger entry RenewLoan
// writes on the OLD loan for its outstanding balance being rolled into the
// new loan — so that loan's ledger shows how it reached zero outstanding
// (and Status=Closed via renewal) instead of jumping there with an
// unexplained gap. No real cash moves for this entry.
const PaymentMethodRenewalRollover = "Renewal Rollover"

// PersonalLoanPayment is one entry in a loan's payment ledger: an actual
// collection recorded by staff (or the rollover entry above), the running
// balance left after it, and a best-effort link to the installment it was
// primarily credited against.
type PersonalLoanPayment struct {
	platform.TenantScoped
	ID             uint `json:"id" gorm:"primaryKey"`
	PersonalLoanID uint `json:"personalLoanId" gorm:"not null;index"`

	Amount float64   `json:"amount" gorm:"not null;type:numeric(16,2)"`
	PaidOn time.Time `json:"paidOn" gorm:"not null"`

	// ReceivedByEmployeeID is nullable per internal/loan's LoanPayment
	// convention, though in this staff-only module it is set on every real
	// collection — nil only for the RenewLoan rollover entry.
	ReceivedByEmployeeID *uint `json:"receivedByEmployeeId"`

	// Method is derived/display-only (platform.DeriveMethod) for a real
	// collection — the single mode's name when exactly one split amount
	// below is non-zero, "Split" when more than one is — but stays
	// PaymentMethodRenewalRollover verbatim for RenewLoan's synthetic
	// no-cash-moved entry, which has no split to derive from.
	Method      string `json:"method" gorm:"size:30"`
	Reference   string `json:"reference" gorm:"size:80"`
	Description string `json:"description" gorm:"size:255"`

	// CashAmount/UpiAmount/BankTransferAmount/ChequeAmount record exactly how
	// much of Amount came through each mode — see LoanPayment's identical
	// fields for the full rationale. All 0 for the RenewLoan rollover entry,
	// which moves no real cash.
	CashAmount         float64 `json:"cashAmount" gorm:"not null;type:numeric(16,2);default:0"`
	UpiAmount          float64 `json:"upiAmount" gorm:"not null;type:numeric(16,2);default:0"`
	BankTransferAmount float64 `json:"bankTransferAmount" gorm:"not null;type:numeric(16,2);default:0"`
	ChequeAmount       float64 `json:"chequeAmount" gorm:"not null;type:numeric(16,2);default:0"`

	// NeedsModeReview — see LoanPayment's identical field.
	NeedsModeReview bool `json:"needsModeReview" gorm:"not null;default:false"`

	// RunningBalance is OutstandingAmount immediately after this entry.
	RunningBalance float64 `json:"runningBalance" gorm:"not null;type:numeric(16,2)"`

	// InstallmentID is a best-effort, display-only link to the installment
	// this payment was primarily allocated against — nil for a payment that
	// didn't fully land on one particular due installment.
	InstallmentID *uint `json:"installmentId"`

	CreatedAt time.Time `json:"createdAt"`
}

func (PersonalLoanPayment) TableName() string { return "personal_loan_payments" }
