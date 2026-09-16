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
	InvestmentNumber string `json:"investmentNumber" gorm:"uniqueIndex;size:20"`

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

	// Engine is snapshotted from Plan.Engine at creation time — see the
	// Engine* consts' doc comment in model_plan.go. Every field below this
	// point is meaningful only for Engine == EngineLive; an EngineSchedule
	// investment never writes them and they stay at their zero-value
	// defaults for its entire life.
	Engine string `json:"engine" gorm:"not null;size:10;default:'Schedule'"`

	// OutstandingPrincipal is the investor's live principal balance for a
	// Live-engine investment — starts at PrincipalAmount (see
	// Service.CreateInvestment) and moves only via Service.AddCash (+) and
	// Service.Withdraw's principal component (-). PrincipalAmount itself is
	// kept in step with it (see AddCash/Withdraw) so the headline "principal
	// invested" figure stays meaningful; for an EngineSchedule investment
	// PrincipalAmount is fixed for life exactly as before and this field is
	// simply unused.
	OutstandingPrincipal float64 `json:"outstandingPrincipal" gorm:"not null;type:numeric(16,2);default:0"`

	// AccruedInterest is the cumulative interest ever settled up to
	// LastAccrualDate — mirrors loan.Loan.AccruedInterest exactly (see
	// accrual.go's projectAccrual/settleAndSave).
	AccruedInterest float64 `json:"accruedInterest" gorm:"not null;type:numeric(16,2);default:0"`

	// InterestWithdrawn is the cumulative interest ever withdrawn via
	// Service.Withdraw's InterestAmount component. Deliberately a separate
	// field from TotalInterestPaid below rather than a reuse of it:
	// TotalInterestPaid is documented as strictly the sum of paid
	// InvestmentPayout rows (a concept a Live-engine investment has none
	// of — it never generates payout rows), and must stay untouched so
	// EngineSchedule's existing MarkPayoutPaid code path is never at risk of
	// a Live-engine regression.
	InterestWithdrawn float64 `json:"interestWithdrawn" gorm:"not null;type:numeric(16,2);default:0"`

	// LastAccrualDate is the accrual anchor projectAccrual/settleAndSave
	// advance forward from — no gorm tag, same bare style as
	// loan.Loan.LastAccrualDate's identical field (a zero value is a safe,
	// meaningful "nothing settled yet" default; projectAccrual falls back to
	// StartDate for it).
	LastAccrualDate time.Time `json:"lastAccrualDate"`

	// OutstandingInterest is computed at read time (AccruedInterest -
	// InterestWithdrawn, clamped at 0) — never persisted, mirrors
	// loan.Loan.OutstandingInterest. See Service.Get/List.
	OutstandingInterest float64 `json:"outstandingInterest" gorm:"-"`

	StartDate    time.Time `json:"startDate" gorm:"not null"`
	MaturityDate time.Time `json:"maturityDate" gorm:"not null"`

	Status string `json:"status" gorm:"not null;size:20"`

	// TotalInterestPaid is the running sum of paid InvestmentPayout rows,
	// kept denormalized (updated transactionally alongside each payout's
	// Status change in MarkPayoutPaid) — mirrors PersonalLoan.TotalPaid.
	// EngineSchedule only; see InterestWithdrawn above for the Live-engine
	// equivalent.
	TotalInterestPaid float64 `json:"totalInterestPaid" gorm:"not null;type:numeric(16,2);default:0"`

	ClosedAt *time.Time `json:"closedAt"`

	// RenewedFromInvestmentID/RenewedToInvestmentID form a linked list
	// across a chain of renewals: set on the new investment (points at the
	// investment it replaced) and on the old investment (points at the
	// investment it was replaced by), populated in the same transaction by
	// RenewInvestment — mirrors PersonalLoan's identical renewal linkage.
	RenewedFromInvestmentID *uint `json:"renewedFromInvestmentId"`
	RenewedToInvestmentID   *uint `json:"renewedToInvestmentId"`

	Payouts      []InvestmentPayout      `json:"payouts,omitempty" gorm:"foreignKey:InvestmentID"`
	Transactions []InvestmentTransaction `json:"transactions,omitempty" gorm:"foreignKey:InvestmentID"`

	CreatedAt time.Time      `json:"createdAt"`
	UpdatedAt time.Time      `json:"updatedAt"`
	DeletedAt gorm.DeletedAt `json:"-" gorm:"index"`
}

func (Investment) TableName() string { return "investments" }
