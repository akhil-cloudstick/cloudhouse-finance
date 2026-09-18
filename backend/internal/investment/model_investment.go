package investment

import (
	"time"

	"gorm.io/gorm"

	"cloudhouse/backend/internal/branch"
	"cloudhouse/backend/internal/customer"
	"cloudhouse/backend/internal/platform"
)

// Status values for Investment.Status. There is no "Pending" stage —
// creation and the deposit happen as one staff action, so an investment is
// Active from the moment it is created. Matured is a flag only (set by the
// background sweep once MaturityDate passes) — it never transitions to
// Closed/Renewed on its own; that always requires an explicit staff
// decision (see Service.MatureInvestment).
const (
	StatusActive  = "Active"
	StatusMatured = "Matured"
	StatusClosed  = "Closed"
	StatusRenewed = "Renewed"
)

// Investment is one investor's deposit against an InvestmentPlan.
type Investment struct {
	platform.TenantScoped
	ID               uint   `json:"id" gorm:"primaryKey"`
	InvestmentNumber string `json:"investmentNumber" gorm:"index;size:20"` // unique per TENANT — see migrate.tenantUniqueIndexes

	BranchID uint          `json:"branchId" gorm:"not null"`
	Branch   branch.Branch `json:"branch" gorm:"foreignKey:BranchID"`

	CustomerID uint              `json:"customerId" gorm:"not null"`
	Customer   customer.Customer `json:"customer" gorm:"foreignKey:CustomerID"`

	PlanID uint           `json:"planId" gorm:"not null"`
	Plan   InvestmentPlan `json:"plan" gorm:"foreignKey:PlanID"`

	CreatedByEmployeeID uint `json:"createdByEmployeeId"`

	// PrincipalAmount is the lump sum the investor deposited. Every money
	// column is numeric(16,2); see platform.RoundMoney for why every write
	// goes through it.
	PrincipalAmount float64 `json:"principalAmount" gorm:"not null;type:numeric(16,2)"`

	// InterestRateType/InterestRatePercent/PayoutFrequency/TenureMonths are
	// snapshotted from Plan at creation time — deliberately duplicated
	// rather than read live off Plan, so a later edit to the plan (or even
	// its deletion) never changes what an existing investor was promised.
	InterestRateType    string  `json:"interestRateType" gorm:"not null;size:10"`
	InterestRatePercent float64 `json:"interestRatePercent" gorm:"not null;type:numeric(6,3)"`
	PayoutFrequency     string  `json:"payoutFrequency" gorm:"not null;size:10"`
	TenureMonths        int     `json:"tenureMonths" gorm:"not null"`

	StartDate    time.Time `json:"startDate" gorm:"not null"`
	MaturityDate time.Time `json:"maturityDate" gorm:"not null"`

	Status string `json:"status" gorm:"not null;size:20"`

	// TotalInterestPaid is the running sum of paid InvestmentPayout rows,
	// kept denormalized (updated transactionally alongside each payout's
	// Status change in MarkPayoutPaid) — mirrors PersonalLoan.TotalPaid.
	TotalInterestPaid float64 `json:"totalInterestPaid" gorm:"not null;type:numeric(16,2);default:0"`

	ClosedAt *time.Time `json:"closedAt"`

	// RenewedFromInvestmentID/RenewedToInvestmentID form a linked list
	// across a chain of renewals: set on the new investment (points at the
	// investment it replaced) and on the old investment (points at the
	// investment it was replaced by), populated in the same transaction by
	// RenewInvestment — mirrors PersonalLoan's identical renewal linkage.
	RenewedFromInvestmentID *uint `json:"renewedFromInvestmentId"`
	RenewedToInvestmentID   *uint `json:"renewedToInvestmentId"`

	Payouts []InvestmentPayout `json:"payouts,omitempty" gorm:"foreignKey:InvestmentID"`

	CreatedAt time.Time      `json:"createdAt"`
	UpdatedAt time.Time      `json:"updatedAt"`
	DeletedAt gorm.DeletedAt `json:"-" gorm:"index"`
}

func (Investment) TableName() string { return "investments" }
