package loan

import (
	"time"

	"cloudhouse/backend/internal/platform"
)

// LoanAccrual is one accrual run's interest and penal-interest charge against
// a loan — written whenever accrueAndSave advances the loan's accrued totals,
// so the loan's Payment Ledger can show when interest and penal interest were
// charged, not just that the running totals grew. Append-only.
type LoanAccrual struct {
	platform.TenantScoped
	ID            uint      `json:"id" gorm:"primaryKey"`
	LoanID        uint      `json:"loanId" gorm:"not null;index"`
	AccruedOn     time.Time `json:"accruedOn" gorm:"not null"`
	Interest      float64   `json:"interest" gorm:"not null;type:numeric(16,2);default:0"`
	PenalInterest float64   `json:"penalInterest" gorm:"not null;type:numeric(16,2);default:0"`
	CreatedAt     time.Time `json:"createdAt"`
}
