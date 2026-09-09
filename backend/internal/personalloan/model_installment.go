package personalloan

import (
	"time"

	"cloudhouse/backend/internal/platform"
)

// Installment status values — display/tracking only. Payments are not
// strictly constrained to the schedule (a partial or extra payment just
// reduces PersonalLoan.OutstandingAmount), so these are best-effort,
// derived from allocating payments across installments in due-date order —
// never authoritative over what is actually owed.
const (
	InstallmentStatusPending       = "Pending"
	InstallmentStatusPaid          = "Paid"
	InstallmentStatusPartiallyPaid = "PartiallyPaid"
)

// PersonalLoanInstallment is one planned due date in a loan's repayment
// schedule, generated in full at creation (see Service.generateSchedule):
// TenureCount rows of InstallmentAmount each, except the last, which is
// capped to whatever principal remains so the schedule sums to exactly
// PrincipalAmount.
type PersonalLoanInstallment struct {
	platform.TenantScoped
	ID             uint `json:"id" gorm:"primaryKey"`
	PersonalLoanID uint `json:"personalLoanId" gorm:"not null;index"`

	SequenceNo int       `json:"sequenceNo" gorm:"not null"`
	DueDate    time.Time `json:"dueDate" gorm:"not null"`
	Amount     float64   `json:"amount" gorm:"not null;type:numeric(16,2)"`

	Status     string  `json:"status" gorm:"not null;size:15;default:'Pending'"`
	PaidAmount float64 `json:"paidAmount" gorm:"not null;type:numeric(16,2);default:0"`

	CreatedAt time.Time `json:"createdAt"`
	UpdatedAt time.Time `json:"updatedAt"`
}

func (PersonalLoanInstallment) TableName() string { return "personal_loan_installments" }
