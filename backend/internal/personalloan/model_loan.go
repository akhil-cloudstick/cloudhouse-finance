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
	LoanNumber string `json:"loanNumber" gorm:"index;size:20"` // unique per TENANT — see migrate.tenantUniqueIndexes

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
	// cash handed to the customer.
	DisbursedAmount float64 `json:"disbursedAmount" gorm:"not null;type:numeric(16,2)"`

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

	Installments []PersonalLoanInstallment `json:"installments,omitempty" gorm:"foreignKey:PersonalLoanID"`
	Payments     []PersonalLoanPayment     `json:"payments,omitempty" gorm:"foreignKey:PersonalLoanID"`

	CreatedAt time.Time      `json:"createdAt"`
	UpdatedAt time.Time      `json:"updatedAt"`
	DeletedAt gorm.DeletedAt `json:"-" gorm:"index"`
}

func (PersonalLoan) TableName() string { return "personal_loans" }
