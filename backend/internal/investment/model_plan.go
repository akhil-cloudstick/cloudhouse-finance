// Package investment implements the Investment (Deposit) product: a
// different kind of customer — an investor — hands the system a lump sum
// (the principal) and the system pays them interest back on a schedule
// (Monthly or Yearly) for a fixed tenure, defined by an admin-managed
// InvestmentPlan. Unlike internal/personalloan (customer owes the system),
// here the system owes the investor: a deposit is cash IN at creation, each
// interest payout and the eventual principal return are cash OUT.
//
// Split across model_*.go files the way internal/personalloan is:
// model_plan.go for the admin-defined plan catalogue, model_investment.go
// for one investor's deposit against a plan, model_payout.go for the
// generated interest-payout schedule.
package investment

import (
	"time"

	"gorm.io/gorm"

	"cloudhouse/backend/internal/platform"
)

// InterestRateType values for InvestmentPlan.InterestRateType.
const (
	InterestRateTypeSimple   = "Simple"
	InterestRateTypeCompound = "Compound"
)

// PayoutFrequency values for InvestmentPlan.PayoutFrequency and
// Investment.PayoutFrequency. For an EngineSchedule plan/investment this
// drives generatePayoutSchedule's due-date stepping exactly as before, and
// stays restricted to Monthly/Yearly (see validateFrequency). For an
// EngineLive plan/investment it is instead the accrual period consumed by
// projectAccrual (accrual.go), and all five values are legal — Daily/
// Weekly/Quarterly only make sense for the new live engine, so they were
// never offered to the old one.
const (
	PayoutFrequencyDaily     = "Daily"
	PayoutFrequencyWeekly    = "Weekly"
	PayoutFrequencyMonthly   = "Monthly"
	PayoutFrequencyQuarterly = "Quarterly"
	PayoutFrequencyYearly    = "Yearly"
)

// Engine values — the discriminator between the original product (a fixed
// interest-payout schedule precomputed in full at creation, see
// generatePayoutSchedule) and the new live-accrual product (Outstanding
// Principal/Interest that move via Service.AddCash/Withdraw and accrue
// day-by-day, see accrual.go). EngineSchedule is the default so every plan
// and investment that predates this feature backfills to it and is never
// touched by any Live-engine code path (settleAndSave, AddCash, Withdraw,
// projectAccrual all no-op or refuse outright for it) — see migrate.go's
// BackfillEngineColumn. An Investment snapshots its Plan's Engine at
// creation time, same as every other plan term, so retiring/editing a plan
// afterwards never changes what an existing investment already is.
const (
	EngineSchedule = "Schedule"
	EngineLive     = "Live"
)

// InvestmentPlan is an admin-defined product an investor can put money
// into — e.g. "Gold Saver 12mo @ 8%". Editing a plan only affects
// investments created after the edit: every Investment snapshots the
// plan's rate/frequency/tenure at creation time (see Investment's own
// field comments), so a rate change here never retroactively changes an
// existing investor's terms.
type InvestmentPlan struct {
	platform.TenantScoped
	ID   uint   `json:"id" gorm:"primaryKey"`
	Name string `json:"name" gorm:"not null;size:120"`

	InterestRateType    string  `json:"interestRateType" gorm:"not null;size:10"`
	InterestRatePercent float64 `json:"interestRatePercent" gorm:"not null;type:numeric(6,3)"`
	PayoutFrequency     string  `json:"payoutFrequency" gorm:"not null;size:10"`
	TenureMonths        int     `json:"tenureMonths" gorm:"not null"`

	// Engine selects which product a new investment created against this
	// plan gets — see the Engine* consts' doc comment above.
	Engine string `json:"engine" gorm:"not null;size:10;default:'Schedule'"`

	// MinPrincipal is the smallest deposit this plan accepts; zero means no
	// floor.
	MinPrincipal float64 `json:"minPrincipal" gorm:"not null;type:numeric(16,2);default:0"`

	// IsActive gates whether the plan can be picked for a NEW investment —
	// existing investments already created against it are unaffected (see
	// Investment's snapshot fields), so retiring a plan never disrupts a
	// live investor.
	IsActive bool `json:"isActive" gorm:"not null;default:true"`

	CreatedAt time.Time      `json:"createdAt"`
	UpdatedAt time.Time      `json:"updatedAt"`
	DeletedAt gorm.DeletedAt `json:"-" gorm:"index"`
}

func (InvestmentPlan) TableName() string { return "investment_plans" }
