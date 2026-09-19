package personalloan

import (
	"time"

	"cloudhouse/backend/internal/platform"
)

// Event* enumerates what PersonalLoanHistory can record — kept a closed set
// (like auditlog.Action*) so the change-history table's possible rows stay
// visible in one place.
const (
	EventLoanCreated  = "loan_created"
	EventPenalApplied = "penal_applied"
	EventLoanRenewed  = "loan_renewed"
)

// PersonalLoanHistory is one line in a personal loan's change-history
// timeline (the Personal Loan detail page's "History" table, switchable with
// the Schedule table): when the loan was opened, each time it went unpaid
// past its installment period and penal interest was folded in, and — if it
// happened — the renewal that replaced it with a new loan. Written
// alongside the mutation it describes (CreateLoan, applyPenalIfDue,
// RenewLoan) rather than derived on read, so a loan that has gone through
// several penal cycles keeps a row per cycle instead of only the latest
// being visible via PersonalLoan.LastPenalAppliedAt.
type PersonalLoanHistory struct {
	platform.TenantScoped
	ID uint `json:"id" gorm:"primaryKey"`

	PersonalLoanID uint `json:"personalLoanId" gorm:"not null;index"`

	Event string `json:"event" gorm:"not null;size:30"`
	// Detail is a short, human-readable line for the row, e.g. "Loan opened"
	// or "Renewed into loan PL-00042" — composed at write time (see
	// service.go/penal.go's logHistory call sites) so the frontend can
	// render it directly with no per-event switch of its own.
	Detail string `json:"detail" gorm:"not null;size:200"`

	// Amount is the event's headline figure where one applies — the
	// principal for loan_created, the penal charge for penal_applied, the
	// new loan's principal for loan_renewed. 0/omitted otherwise.
	Amount float64 `json:"amount" gorm:"not null;type:numeric(16,2);default:0"`

	// RelatedLoanID points at the other loan involved, when any: for
	// loan_renewed on the OLD loan's history, the new loan's ID.
	RelatedLoanID *uint `json:"relatedLoanId"`

	OccurredAt time.Time `json:"occurredAt" gorm:"not null"`
	CreatedAt  time.Time `json:"createdAt"`
}

func (PersonalLoanHistory) TableName() string { return "personal_loan_history" }
