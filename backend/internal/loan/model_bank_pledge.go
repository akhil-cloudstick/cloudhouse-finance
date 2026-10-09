package loan

import (
	"cloudhouse/backend/internal/platform"
	"time"
)

// BankPledgeRecord is a lightweight audit record of a loan (or batch of
// loans, tracked one row per loan) being pledged to / released from a bank.
type BankPledgeRecord struct {
	platform.TenantScoped
	ID     uint `json:"id" gorm:"primaryKey"`
	LoanID uint `json:"loanId" gorm:"not null;index"`

	// BankID references the registered bank.Bank resource the caller picked
	// (via the frontend's bank search dropdown). BankName is kept alongside
	// it as a denormalized snapshot so historical pledge records still
	// display the bank name used at the time even if the Bank row is later
	// renamed. BankID is nullable to accommodate pledge rows created before
	// this column existed (see backfillBankPledgeBankID in cmd/migrate) —
	// new pledges always set it.
	BankID        *uint      `json:"bankId"`
	BankName      string     `json:"bankName" gorm:"not null;size:120"`
	PledgedAmount float64    `json:"pledgedAmount" gorm:"not null;type:numeric(16,2)"`
	PledgeDate    time.Time  `json:"pledgeDate" gorm:"not null"`
	ReleaseDate   *time.Time `json:"releaseDate"`

	// BankPledgeDueDate is the date the bank's own loan/pledge term is
	// expected to end — distinct from ReleaseDate, which is only set once
	// the gold is actually reclaimed from the bank. Optional; nil for
	// pledges that don't track a bank-side due date.
	BankPledgeDueDate *time.Time `json:"bankPledgeDueDate"`

	// PledgedGrossWeight/PledgedNetWeight snapshot the loan's ornament
	// totals at the moment of pledge, so the record stays self-contained
	// and auditable even if the loan's ornaments are edited afterwards.
	// Zero for pledges recorded before this field existed.
	PledgedGrossWeight float64 `json:"pledgedGrossWeight"`
	PledgedNetWeight   float64 `json:"pledgedNetWeight"`

	// BankInterestRate/ReferenceNumber are optional descriptive fields the
	// spec calls out for the bank re-pledge record — the annual interest
	// rate the bank charges on the pledge, and the bank's own reference/
	// document number for it. Both blank/zero for pledges recorded before
	// this field existed.
	BankInterestRate float64 `json:"bankInterestRate"`
	ReferenceNumber  string  `json:"referenceNumber" gorm:"size:60"`

	// CashMovementID links to the Cash-in-Hand "in" movement created for this
	// pledge (see loan.CashRecorder). ReleaseBankPledge no longer deletes it
	// — it stays as the historical record of the cash the bank advanced.
	// Nil for pledges recorded before this linkage existed.
	CashMovementID *uint `json:"cashMovementId,omitempty"`

	// ExpenseID is retired and always nil on new pledges: the bank's advance
	// is borrowing, not spending, so pledging books cash in only and writes
	// no expense (see loan.CashRecorder). The column is kept because
	// internal/migrate.purgeBankPledgeMirrorExpenses nulls the old links
	// rather than dropping them, and older pledges may predate that run.
	ExpenseID *uint `json:"expenseId,omitempty"`

	// ReleaseCashMovementID/ReleaseExpenseID link to the cash-out movement
	// and the release expense created when the gold is released from the
	// bank (see loan.CashRecorder.RecordBankPledgeCashOut/
	// RecordBankPledgeReleaseExpense) — that release expense is the only one
	// in the pledge cycle. Both nil until release.
	ReleaseCashMovementID *uint `json:"releaseCashMovementId,omitempty"`
	ReleaseExpenseID      *uint `json:"releaseExpenseId,omitempty"`

	// CashTreatment records whether the bank's advance against this pledge
	// actually entered the branch till ("CashIn") or was only booked as a
	// paperwork record with no cash effect ("RecordOnly"). Chosen per
	// transaction by the operator and IMMUTABLE afterwards — a mis-selected
	// treatment is corrected by voiding the record (see Service.VoidBankPledge)
	// and re-creating it, never by editing this field, because silently
	// rewriting it would falsify already-booked cash history.
	//
	// The column default is 'CashIn' purely so rows that predate this field
	// read back truthfully: unconditional cash-in was the only behavior that
	// ever existed, so that is genuinely what those pledges did. It is NOT the
	// default for new writes — the handler defaults an omitted value to
	// RecordOnly so cash is only ever touched on an explicit opt-in.
	CashTreatment string `json:"cashTreatment" gorm:"not null;size:20;default:'CashIn'"`

	// CashAmount/UpiAmount/BankTransferAmount/ChequeAmount/ReceivedBankID say
	// how the bank's advance reached the branch (CashIn pledges only; all 0 for
	// RecordOnly and for pledges recorded before a mode could be chosen, which
	// were always Cash). Kept so voiding the pledge can reverse the money in the
	// same modes it arrived in.
	CashAmount         float64 `json:"cashAmount" gorm:"not null;type:numeric(16,2);default:0"`
	UpiAmount          float64 `json:"upiAmount" gorm:"not null;type:numeric(16,2);default:0"`
	BankTransferAmount float64 `json:"bankTransferAmount" gorm:"not null;type:numeric(16,2);default:0"`
	ChequeAmount       float64 `json:"chequeAmount" gorm:"not null;type:numeric(16,2);default:0"`
	ReceivedBankID     *uint   `json:"receivedBankId,omitempty"`

	// Status tracks the record's lifecycle so released and voided pledges stay
	// visible in history rather than disappearing from the active list.
	// Voided rows keep every original figure for audit — they are never deleted.
	Status     string     `json:"status" gorm:"not null;size:20;default:'Active'"`
	VoidedAt   *time.Time `json:"voidedAt,omitempty"`
	VoidReason string     `json:"voidReason,omitempty" gorm:"size:255"`
	// VoidCashMovementID links to the compensating cash-out booked when a
	// CashIn-treated pledge is voided. Nil for voided RecordOnly pledges,
	// which never moved cash and so need no reversal.
	VoidCashMovementID *uint `json:"voidCashMovementId,omitempty"`

	// Events is this record's append-only audit trail (pledged/released/
	// voided, with actor and timestamp) — the "re-pledge history" the spec
	// calls for, mirroring how AuctionNotice/AuctionEvent hang off an auction.
	Events []BankPledgeEvent `json:"events,omitempty" gorm:"foreignKey:BankPledgeRecordID"`

	CreatedAt time.Time `json:"createdAt"`
}

func (BankPledgeRecord) TableName() string { return "bank_pledge_records" }

// Cash-treatment values for BankPledgeRecord.CashTreatment.
const (
	// BankPledgeCashTreatmentCashIn books the pledged amount into
	// Cash-in-Hand (plus the mirrored Bank-mode expense) on pledge, and
	// reverses it with a cash-out on release.
	BankPledgeCashTreatmentCashIn = "CashIn"
	// BankPledgeCashTreatmentRecordOnly creates the pledge record with no
	// cash effect at all. Release is symmetrically a no-op: since nothing
	// was booked in, nothing is booked out.
	BankPledgeCashTreatmentRecordOnly = "RecordOnly"
)

// Lifecycle values for BankPledgeRecord.Status.
const (
	BankPledgeStatusRecordActive   = "Active"
	BankPledgeStatusRecordReleased = "Released"
	BankPledgeStatusRecordVoided   = "Voided"
)

// Action values for BankPledgeEvent.Action.
const (
	BankPledgeEventPledged  = "Pledged"
	BankPledgeEventReleased = "Released"
	BankPledgeEventVoided   = "Voided"
)

// BankPledgeEvent is one entry in a re-pledge record's audit trail. Kept
// deliberately lightweight (same shape/rationale as AuctionNotice) because
// no general audit-log facility exists in this codebase. ActorEmployeeID is
// nullable so system-generated entries can be distinguished from staff
// actions.
type BankPledgeEvent struct {
	platform.TenantScoped
	ID                 uint   `json:"id" gorm:"primaryKey"`
	BankPledgeRecordID uint   `json:"bankPledgeRecordId" gorm:"not null;index"`
	Action             string `json:"action" gorm:"not null;size:20"`
	ActorEmployeeID    *uint  `json:"actorEmployeeId,omitempty"`
	ActorRole          string `json:"actorRole,omitempty" gorm:"size:40"`
	// Amount snapshots the pledged amount at the time of the event, so the
	// timeline reads correctly on its own without re-joining the parent row.
	Amount    float64   `json:"amount" gorm:"type:numeric(16,2);default:0"`
	Remarks   string    `json:"remarks,omitempty" gorm:"size:255"`
	CreatedAt time.Time `json:"createdAt"`
}

func (BankPledgeEvent) TableName() string { return "bank_pledge_events" }
