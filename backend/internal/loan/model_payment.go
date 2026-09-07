package loan

import "time"

// Payment type values for LoanPayment.Type. Interest/Principal/Partial/Full
// Settlement all represent cash actually received; Adjustment/Waiver do not
// (an Adjustment corrects the principal ledger, a Waiver forgives owed
// interest/penal interest) — see Service.allocatePayment and
// isCashPaymentType.
const (
	PaymentTypeInterest       = "Interest"
	PaymentTypePrincipal      = "Principal"
	PaymentTypePartial        = "Partial"
	PaymentTypeFullSettlement = "Full Settlement"
	PaymentTypeAdjustment     = "Adjustment"
	PaymentTypeWaiver         = "Waiver"

	// PaymentTypeDiscount is a negotiated reduction of a Release request's
	// final settlement, entered alongside (or instead of) a real Payment on
	// the Manager-stage release review screen — see
	// Service.RecordReleasePayment. Unlike PaymentTypeWaiver (interest/penal
	// only), a release discount can reach principal too: it represents the
	// branch agreeing to let the customer settle for less overall, not just
	// forgiving interest. Like Waiver, it moves no cash.
	PaymentTypeDiscount = "Discount"

	// PaymentTypeAuctionSale records auction proceeds being applied against
	// the loan, so the customer's ledger shows where the money came from
	// instead of the balance silently dropping. It is deliberately EXCLUDED
	// from isCashPaymentType: RecordAuctionSale books the cash-in itself, so
	// treating this as cash-bearing here too would double-count the till.
	PaymentTypeAuctionSale = "Auction Sale"
	// PaymentTypeAuctionWriteOff forgives a post-auction shortfall balance
	// following a Management/Branch Manager decision. Like Waiver it moves no
	// cash — but unlike Waiver it can reach principal, because what is being
	// written off after the gold is gone is principal, not just interest.
	PaymentTypeAuctionWriteOff = "Auction Write-Off"
)

// LoanPayment is one entry in a loan's payment ledger: what was received
// (or adjusted/waived), how it was allocated across the penal-interest/
// interest/principal buckets, the running balance left after it, and the
// free-text details (method/reference/description) the spec's ledger
// calls for.
type LoanPayment struct {
	ID     uint `json:"id" gorm:"primaryKey"`
	LoanID uint `json:"loanId" gorm:"not null;index"`

	Amount float64   `json:"amount" gorm:"not null;type:numeric(16,2)"`
	Type   string    `json:"type" gorm:"not null;size:30"` // see PaymentType* constants
	PaidOn time.Time `json:"paidOn" gorm:"not null"`
	// ReceivedByEmployeeID is nullable: a staff-recorded payment (cash, UPI,
	// etc.) always has one, populated from the acting employee's JWT — but a
	// customer-initiated online (Razorpay) payment has no employee actor at
	// all, so this is left nil rather than routed through a fabricated
	// "system" employee row. NULL cleanly means "no staff involved."
	ReceivedByEmployeeID *uint `json:"receivedByEmployeeId"`

	// Ledger display fields.
	Description string `json:"description" gorm:"size:255"`
	Method      string `json:"method" gorm:"size:30"` // e.g. "Cash" | "UPI" | "Bank Transfer" — free text, mirrors cash.Expense.Mode's convention
	Reference   string `json:"reference" gorm:"size:80"`

	// How Amount was split across the four buckets — lets the ledger show
	// a breakdown per entry instead of just a lump sum. ProcessingFeeApplied
	// is Amount's portion that paid down Loan.OutstandingProcessingFee —
	// first priority in allocatePayment's waterfall, ahead of penal
	// interest/interest/principal.
	ProcessingFeeApplied float64 `json:"processingFeeApplied" gorm:"type:numeric(16,2);default:0"`
	PenalInterestApplied float64 `json:"penalInterestApplied" gorm:"type:numeric(16,2);default:0"`
	InterestApplied      float64 `json:"interestApplied" gorm:"type:numeric(16,2);default:0"`
	PrincipalApplied     float64 `json:"principalApplied" gorm:"type:numeric(16,2);default:0"`

	// RunningBalance is TotalOutstandingBalance immediately after this entry
	// was applied (principal + outstanding interest + outstanding penal
	// interest + outstanding processing fee) — the ledger's required
	// "running balance" column.
	RunningBalance float64 `json:"runningBalance" gorm:"type:numeric(16,2);default:0"`

	// ProcessingFee is an additional charge newly CHARGED alongside this
	// payment (e.g. a documentation/late fee) — added to
	// Loan.OutstandingProcessingFee before this entry's Amount is
	// allocated, so the fee has first claim on the very payment that
	// introduced it (see allocatePayment). Zero for entries that don't add
	// one. Distinct from ProcessingFeeApplied above, which is how much of
	// Amount actually went toward paying down that (possibly
	// pre-existing) fee balance — the two aren't the same figure whenever
	// Amount doesn't fully cover it, or covers more than just this entry's
	// new fee.
	ProcessingFee float64 `json:"processingFee" gorm:"type:numeric(16,2);default:0"`

	CreatedAt time.Time `json:"createdAt"`
}

func (LoanPayment) TableName() string { return "loan_payments" }
