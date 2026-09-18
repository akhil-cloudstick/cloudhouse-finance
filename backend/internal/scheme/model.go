package scheme

import (
	"time"

	"gorm.io/gorm"

	"cloudhouse/backend/internal/branch"
	"cloudhouse/backend/internal/platform"
)

// Scheme represents a loan scheme/plan that administrators define. Each
// scheme carries the terms (interest rate, LTV, method, conditions) used to
// compute loan eligibility for any loan opened under it, and a fixed tenure
// (DurationMonths) — every loan opened under this scheme runs for that many
// months from its own OpenedDate; there is no scheme-level date window
// anymore (a scheme is a reusable plan, not a time-boxed offer).
// ServiceChargeType* are Scheme.ServiceChargeType's values — "None" is the
// default (and the zero value, so an existing scheme with no charge
// configured reads as "None" without a migration backfill).
const (
	ServiceChargeTypeNone    = "None"
	ServiceChargeTypeFlat    = "Flat"
	ServiceChargeTypePercent = "Percent"
)

// ServiceChargeMode* are Scheme.ServiceChargeMode's values, meaningful only
// when ServiceChargeType != None. WithheldFromPayout deducts the charge
// from what's actually handed to the customer at disbursement while the
// loan still owes interest on the FULL principal; AddedToPrincipal instead
// folds the charge straight into the principal (and what's owed) at
// creation, paid out in full. See loan.Service.applySchemeSnapshot/Create
// for where each mode is actually applied.
const (
	ServiceChargeModeWithheldFromPayout = "WithheldFromPayout"
	ServiceChargeModeAddedToPrincipal   = "AddedToPrincipal"
)

type Scheme struct {
	platform.TenantScoped
	ID             uint           `json:"id" gorm:"primaryKey"`
	BranchID       uint           `json:"branchId" gorm:"not null"`
	Branch         branch.Branch  `json:"branch" gorm:"foreignKey:BranchID"`
	Code           string         `json:"code" gorm:"index;size:20"`
	Name           string         `json:"name" gorm:"not null;size:120"`
	InterestRate   float64        `json:"interestRate" gorm:"not null"`
	DurationMonths int            `json:"durationMonths" gorm:"not null"`
	LTVPercent     float64        `json:"ltvPercent" gorm:"not null"`
	InterestMethod string         `json:"interestMethod" gorm:"size:80"`
	PenalRate      float64        `json:"penalRate"`
	Conditions     string         `json:"conditions"`
	IsActive       bool           `json:"isActive" gorm:"default:false"`

	// ServiceChargeType/Value/Mode configure an optional charge applied to
	// every loan opened under this scheme — see the ServiceChargeType*/
	// ServiceChargeMode* constants above. Value is a flat rupee amount when
	// Type is Flat, or a percentage of the loan's principal when Type is
	// Percent; meaningless (and ignored) when Type is None. Snapshotted
	// onto each loan at creation the same way InterestRate/LTVPercent/etc.
	// already are (loan.Loan.ServiceChargeType/Value/Mode/Amount), so a
	// later edit to the scheme's charge never changes an existing loan's
	// already-computed amount.
	ServiceChargeType  string  `json:"serviceChargeType" gorm:"size:10;not null;default:'None'"`
	ServiceChargeValue float64 `json:"serviceChargeValue" gorm:"type:numeric(16,2);default:0"`
	ServiceChargeMode  string  `json:"serviceChargeMode" gorm:"size:20"`

	CreatedAt time.Time      `json:"createdAt"`
	UpdatedAt time.Time      `json:"updatedAt"`
	DeletedAt gorm.DeletedAt `json:"-" gorm:"index"`
}

// TableName pins the GORM table name explicitly.
func (Scheme) TableName() string {
	return "schemes"
}
