package investment

import (
	"time"

	"ambikagold/backend/internal/platform"
)

// Payout status values. Unlike PersonalLoanInstallment's Pending/Paid/
// PartiallyPaid (best-effort against free-form payments), an
// InvestmentPayout is the authoritative record of what the system owes the
// investor on that date — it only ever moves Pending -> Paid, via one
// explicit staff action (Service.MarkPayoutPaid).
const (
	PayoutStatusPending = "Pending"
	PayoutStatusPaid    = "Paid"
)

// InvestmentPayout is one planned interest (or, for the final row, interest
// + principal-return) due date in an investment's payout schedule,
// generated in full at creation — see Service.generatePayoutSchedule. This
// is the inverse of PersonalLoanInstallment: there the customer owes the
// system; here the system owes the investor.
type InvestmentPayout struct {
	platform.TenantScoped
	ID           uint `json:"id" gorm:"primaryKey"`
	InvestmentID uint `json:"investmentId" gorm:"not null;index"`

	SequenceNo int       `json:"sequenceNo" gorm:"not null"`
	DueDate    time.Time `json:"dueDate" gorm:"not null"`

	// Amount is the interest due for this period. IsPrincipalReturn marks
	// the final row of a Closed investment's schedule where Amount also
	// carries the returned PrincipalAmount (added by
	// Service.MatureInvestment's Close path) — kept as a flag rather than a
	// separate PrincipalAmount column so every other payout row stays a
	// plain interest figure.
	Amount            float64 `json:"amount" gorm:"not null;type:numeric(16,2)"`
	IsPrincipalReturn bool    `json:"isPrincipalReturn" gorm:"not null;default:false"`

	Status string `json:"status" gorm:"not null;size:15;default:'Pending'"`

	PaidAt           *time.Time `json:"paidAt"`
	PaidByEmployeeID *uint      `json:"paidByEmployeeId"`
	CashMovementID   *uint      `json:"cashMovementId"`

	CreatedAt time.Time `json:"createdAt"`
	UpdatedAt time.Time `json:"updatedAt"`
}

func (InvestmentPayout) TableName() string { return "investment_payouts" }
