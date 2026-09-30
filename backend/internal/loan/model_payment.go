package loan

import (
	"cloudhouse/backend/internal/bank"
	"cloudhouse/backend/internal/platform"
	"time"
)

// Payment type values for LoanPayment.Type. Interest/Principal/Partial/Full
// Settlement all represent cash actually received; Adjustment/Waiver do not
// (an Adjustment corrects the principal ledger, a Waiver forgives owed
// interest/penal interest) — see Service.allocatePayment and
// isCashPaymentType.
const (
	PaymentTypeInterest = "Interest"
	// PaymentTypePenalInterest stops one bucket earlier than
	// PaymentTypeInterest: processing fee, then penal interest, and nothing
	// else. Interest already pays penal FIRST (penal is interest too), so
	// this exists only for staff who need to clear the late-payment charge
	// on its own and leave the regular interest standing.
	PaymentTypePenalInterest  = "Penal Interest"
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

	// PaymentTypeDisbursement records the loan's own principal payout at
	// final sanction (see Service.Decide's `disbursing` branch) as a ledger
	// entry, the same way every other cash-moving event on the loan gets
	// one — without it, GetLoanLedger (which reads only from LoanPayment
	// rows) has no row at all for the disbursement, so its Bank/Method never
	// surface in the loan's own Transactions tab even though the cash-out
	// movement itself is recorded correctly. Deliberately EXCLUDED from both
	// ledgerCreditTypes (money going OUT increases what's owed, so this
	// stays a debit — the same "not yet paid back" direction as the loan
	// opening) and isCashPaymentType (Service.Decide books the cash-out
	// movement itself via cashRecorder, so isCashPaymentType including this
	// too would double-count the till).
	PaymentTypeDisbursement = "Disbursement"
)

// LoanPayment is one entry in a loan's payment ledger: what was received
// (or adjusted/waived), how it was allocated across the penal-interest/
// interest/principal buckets, the running balance left after it, and the
// free-text details (method/reference/description) the spec's ledger
// calls for.
type LoanPayment struct {
	platform.TenantScoped
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
	// Method is now derived/display-only (platform.DeriveMethod), computed
	// from the four split amounts below rather than accepted as free-text
	// input: the single mode's name when exactly one is non-zero, "Split"
	// when more than one is. Kept as a real stored column so every existing
	// reader (ledger tables, PDF receipts/statements) keeps working
	// unchanged.
	Method    string `json:"method" gorm:"size:30"`
	Reference string `json:"reference" gorm:"size:80"`

	// CashAmount/UpiAmount/BankTransferAmount/ChequeAmount record exactly how
	// much of Amount came through each mode — Amount stays the authoritative
	// total (everything downstream that reads Amount is unaffected); these
	// four are purely an added breakdown, NOT NULL DEFAULT 0 like every
	// other allocation-bucket column on this struct. Their sum must equal
	// Amount within platform.RoundMoney's tolerance — see
	// platform.ValidateSplit, called from Service.RecordPayment/Approve
	// before persisting.
	CashAmount         float64 `json:"cashAmount" gorm:"not null;type:numeric(16,2);default:0"`
	UpiAmount          float64 `json:"upiAmount" gorm:"not null;type:numeric(16,2);default:0"`
	BankTransferAmount float64 `json:"bankTransferAmount" gorm:"not null;type:numeric(16,2);default:0"`
	ChequeAmount       float64 `json:"chequeAmount" gorm:"not null;type:numeric(16,2);default:0"`

	// BankID is which bank the UPI/Bank Transfer/Cheque portion of this
	// payment landed in — mirrors CashMovement.BankID/BankRef. Nullable:
	// blank for a Cash-only payment, and for historical rows recorded before
	// this field existed. One payment event stores exactly one bank today
	// (matches the one-row-per-collection-event shape above), even though
	// the split can span multiple non-cash lines — staff pick the bank the
	// non-cash portion(s) actually went through.
	BankID  *uint      `json:"bankId"`
	BankRef *bank.Bank `json:"bankRef,omitempty" gorm:"foreignKey:BankID"`

	// NeedsModeReview flags a row the one-time Method backfill migration
	// could not map to exactly one of Cash/UPI/Bank Transfer/Cheque (blank,
	// a typo, an unrecognized string) — left with all four split amounts at
	// 0 rather than silently guessed as Cash. Staff reconcile these
	// manually; new rows going forward never set this (the split is always
	// known at entry time).
	NeedsModeReview bool `json:"needsModeReview" gorm:"not null;default:false"`

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

	// CashTransactionGroupID links this payment back to the CashMovement
	// row(s) it produced (cash.MovementService.RecordLoanPaymentCashIn) —
	// one row per non-zero mode among CashAmount/UpiAmount/
	// BankTransferAmount/ChequeAmount above, all sharing this same group id
	// (see CashMovement.TransactionGroupID). Previously the only link back
	// from a payment to its ledger entries was an indirect match on
	// Purpose text / PartyCustomerID — this is the direct one. Set in a
	// best-effort follow-up update after the cash movement is recorded
	// (RecordPayment creates the LoanPayment row first, since the movement
	// can't be booked until the payment/allocation succeeds), so it can be
	// blank on a payment whose cash-recording failed or was skipped
	// (isCashPaymentType false, e.g. a Waiver).
	CashTransactionGroupID string `json:"cashTransactionGroupId,omitempty" gorm:"size:40;index"`

	CreatedAt time.Time `json:"createdAt"`
}

func (LoanPayment) TableName() string { return "loan_payments" }
