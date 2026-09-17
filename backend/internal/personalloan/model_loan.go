// Package personalloan implements the Personal Loan product: a small,
// unsecured cash loan (no ornament collateral, no PAN/Aadhaar verification,
// unlike internal/loan's gold loan) issued to an existing Customer. Interest
// is computed once for the whole term and deducted upfront at disbursement —
// the customer receives Principal-Interest in cash but owes the full
// Principal back — repaid on a daily/weekly/monthly schedule the customer
// chooses at creation (frequency + a tenure count of periods). A loan may
// later be "renewed": the old loan is closed and a new, larger loan is
// opened, rolling the old outstanding balance (plus new interest) into the
// new loan's disbursement so only cash actually changes hands.
//
// Split across model_*.go files the way internal/loan is: model_loan.go for
// PersonalLoan itself, model_installment.go for the planned schedule,
// model_payment.go for the payment ledger.
package personalloan

import (
	"time"

	"gorm.io/gorm"

	"cloudhouse/backend/internal/branch"
	"cloudhouse/backend/internal/customer"
	"cloudhouse/backend/internal/platform"
)

// Status values for PersonalLoan.Status. There is no "Pending" stage:
// creation and disbursement happen as one staff action, so a loan is Active
// from the moment it is created.
const (
	StatusActive    = "Active"
	StatusClosed    = "Closed"
	StatusRenewed   = "Renewed"
	StatusDefaulted = "Defaulted"

	// StatusPending marks a loan that has gone through at least one penal
	// interest cycle: its schedule finished, its grace period elapsed, and a
	// balance was still owed, so a penal charge was folded into
	// OutstandingAmount and a new schedule generated (see penal.go). It
	// reverts to StatusActive if the customer pays off THAT new schedule in
	// full before its own grace period also elapses, and flips back to
	// Pending if that cycle also finishes unpaid — see
	// evaluateAndApplyPenal/SweepPenalInterest.
	StatusPending = "Pending"
)

// Interest type values for PersonalLoan.InterestType.
const (
	InterestTypeFlat       = "Flat"
	InterestTypePercentage = "Percentage"
)

// Frequency values for PersonalLoan.Frequency, driving GenerateSchedule's
// due-date stepping.
const (
	FrequencyDaily   = "Daily"
	FrequencyWeekly  = "Weekly"
	FrequencyMonthly = "Monthly"
)

// PersonalLoan is one unsecured personal loan against an existing customer.
type PersonalLoan struct {
	platform.TenantScoped
	ID         uint   `json:"id" gorm:"primaryKey"`
	LoanNumber string `json:"loanNumber" gorm:"uniqueIndex;size:20"`

	BranchID uint          `json:"branchId" gorm:"not null"`
	Branch   branch.Branch `json:"branch" gorm:"foreignKey:BranchID"`

	CustomerID uint              `json:"customerId" gorm:"not null"`
	Customer   customer.Customer `json:"customer" gorm:"foreignKey:CustomerID"`

	CreatedByEmployeeID uint `json:"createdByEmployeeId"`

	// PrincipalAmount is the full amount the customer must repay — never
	// reduced by InterestAmount. Every money column is numeric(16,2); see
	// platform.RoundMoney for why every write goes through it.
	PrincipalAmount float64 `json:"principalAmount" gorm:"not null;type:numeric(16,2)"`

	// InterestType/InterestValue are what staff entered; InterestAmount is
	// the resulting rupee figure, computed once at creation (or renewal) and
	// stored immutably — Flat: InterestValue itself; Percentage:
	// RoundMoney(Principal * InterestValue / 100).
	InterestType   string  `json:"interestType" gorm:"not null;size:20"`
	InterestValue  float64 `json:"interestValue" gorm:"not null;type:numeric(16,2)"`
	InterestAmount float64 `json:"interestAmount" gorm:"not null;type:numeric(16,2)"`

	// DisbursedAmount = Principal - InterestAmount (or, for a renewal,
	// Principal - InterestAmount - rollover from the old loan) — the actual
	// cash handed to the customer. When FullDisbursement is true, interest is
	// not withheld upfront: DisbursedAmount = Principal instead, and the
	// customer's repayment obligation (PrincipalAmount, for schedule/
	// OutstandingAmount purposes below) is Principal + InterestAmount.
	DisbursedAmount float64 `json:"disbursedAmount" gorm:"not null;type:numeric(16,2)"`

	// FullDisbursement, when true, means the full principal was handed to the
	// customer with no interest withheld upfront — the customer owes
	// principal + the full interest back instead of today's default
	// (interest withheld upfront, customer repays principal only). Persisted
	// (not just a creation-time input) so the loan detail page can always
	// show the right note without deriving it ambiguously from
	// DisbursedAmount (which would be indistinguishable from the default
	// path whenever InterestAmount is 0).
	FullDisbursement bool `json:"fullDisbursement" gorm:"not null;default:false"`

	Frequency         string  `json:"frequency" gorm:"not null;size:10"`
	TenureCount       int     `json:"tenureCount" gorm:"not null"`
	InstallmentAmount float64 `json:"installmentAmount" gorm:"not null;type:numeric(16,2)"`

	// OutstandingAmount starts at PrincipalAmount and is decremented by every
	// payment; TotalPaid is the running sum of payments received, kept
	// denormalized (updated transactionally alongside OutstandingAmount in
	// RecordPayment) since there's no accrual to keep in sync with, unlike
	// internal/loan's computed TotalPaid.
	OutstandingAmount float64 `json:"outstandingAmount" gorm:"not null;type:numeric(16,2)"`
	TotalPaid         float64 `json:"totalPaid" gorm:"not null;type:numeric(16,2);default:0"`

	Status string `json:"status" gorm:"not null;size:20"`

	OpenedDate time.Time  `json:"openedDate" gorm:"not null"`
	DisbursedAt time.Time `json:"disbursedAt"`
	ClosedAt   *time.Time `json:"closedAt"`

	// RenewedFromLoanID/RenewedToLoanID form a linked list across a chain of
	// renewals: set on the new loan (points at the loan it replaced) and on
	// the old loan (points at the loan it was replaced by), populated in the
	// same transaction by RenewLoan so either direction is a single lookup.
	RenewedFromLoanID *uint `json:"renewedFromLoanId"`
	RenewedToLoanID   *uint `json:"renewedToLoanId"`

	// PenalInterestRate is a flat PERCENTAGE (not annualized, not prorated by
	// Frequency) charged once per penal cycle directly against
	// OutstandingAmount — e.g. a 10% rate on ₹8000 owed charges ₹800, full
	// stop, however long that cycle's schedule ran. Snapshotted at creation.
	// If a caller doesn't supply one: a Percentage-type loan defaults it to
	// its own InterestValue (its own effective rate); a Flat-type loan has no
	// percentage to default to (its interest is a rupee amount, not a rate),
	// so PenalInterestRate stays 0 for it and PenalFlatAmount (below) is used
	// instead unless staff explicitly overrides with a real
	// PenalInterestRate. See CreateLoan's doc comment.
	//
	// PenalFlatAmount is the rupee amount added to OutstandingAmount per
	// penal cycle for a Flat-type loan with no PenalInterestRate override —
	// defaults to the loan's own InterestAmount (its original flat interest,
	// charged again each missed cycle). Unused (0) for Percentage-type loans
	// or whenever PenalInterestRate > 0 is set; PenalInterestRate always
	// takes precedence when both are set.
	//
	// GracePeriodDays is the number of days after the LAST installment's due
	// date that a fully-repaid loan is allowed before penal interest is
	// first evaluated; defaults to 0 (no grace) when omitted.
	//
	// Penal interest does not accrue continuously the way gold loans'
	// AccruedPenalInterest does. Instead, once the grace period after the
	// final installment elapses with OutstandingAmount still > 0, a single
	// penal charge (OutstandingAmount * PenalInterestRate/100, or
	// PenalFlatAmount when PenalInterestRate is 0) is folded directly into
	// OutstandingAmount, and a brand new TenureCount-length schedule is
	// generated in place for the new balance — see penal.go. If that new
	// cycle also finishes unpaid, the same evaluation repeats indefinitely.
	PenalInterestRate float64 `json:"penalInterestRate" gorm:"not null;type:numeric(16,2);default:0"`
	PenalFlatAmount   float64 `json:"penalFlatAmount" gorm:"not null;type:numeric(16,2);default:0"`
	GracePeriodDays   int     `json:"gracePeriodDays" gorm:"not null;default:0"`

	// PenalCycleCount counts how many times a penal charge + schedule
	// regeneration has fired for this loan (0 = still on the original
	// schedule). TotalPenalInterestCharged is the cumulative rupee amount
	// folded into OutstandingAmount across all cycles so far — display-only,
	// does not affect payment/closure logic (OutstandingAmount already
	// includes it). LastPenalAppliedAt records when the current schedule was
	// last (re)generated by a penal charge, so the sweep can tell whether
	// THIS schedule's grace period has already been evaluated and avoid
	// double-charging within the same overdue window.
	PenalCycleCount           int        `json:"penalCycleCount" gorm:"not null;default:0"`
	TotalPenalInterestCharged float64    `json:"totalPenalInterestCharged" gorm:"not null;type:numeric(16,2);default:0"`
	LastPenalAppliedAt        *time.Time `json:"lastPenalAppliedAt"`

	Installments []PersonalLoanInstallment `json:"installments,omitempty" gorm:"foreignKey:PersonalLoanID"`
	Payments     []PersonalLoanPayment     `json:"payments,omitempty" gorm:"foreignKey:PersonalLoanID"`

	CreatedAt time.Time      `json:"createdAt"`
	UpdatedAt time.Time      `json:"updatedAt"`
	DeletedAt gorm.DeletedAt `json:"-" gorm:"index"`
}

func (PersonalLoan) TableName() string { return "personal_loans" }
