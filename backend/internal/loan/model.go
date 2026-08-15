// Package loan implements the Gold Loan Creation & Ornaments Management
// domain (frontend/components/NewLoan.tsx, LoanDetail.tsx, Loans.tsx): a
// loan pledges one or more ornaments belonging to an existing, KYC-verified
// customer under a scheme, goes through a fixed 3-step sanction-approval
// chain, and is tracked through payments, bank pledge, and eventual
// closure/auction. Several related resources live in this one package
// (Loan, Ornament, OrnamentPurityTest, OrnamentImage, LoanApproval,
// LoanPayment, BankPledgeRecord) — same grouping style as internal/cash's
// CashMovement+Expense.
package loan

import (
	"time"

	"gorm.io/gorm"

	"ambikagold/backend/internal/branch"
	"ambikagold/backend/internal/customer"
	"ambikagold/backend/internal/scheme"
)

// Loan status values (matches the compliance doc's category list exactly;
// used verbatim, not as a typed Go enum, per the rest of the codebase's
// plain-string-status convention).
const (
	StatusPendingApproval  = "Pending Approval"
	StatusActive           = "Active"
	StatusDueSoon          = "Due Soon"
	StatusOverdue          = "Overdue"
	StatusClosureRequested = "Closure Requested"
	StatusClosed           = "Closed"
	StatusDefaulted        = "Defaulted"
	StatusAuctionEligible  = "Auction Eligible"
	StatusAuctioned        = "Auctioned"

	// StatusAuctionedBalanceDue means the gold was sold but the proceeds did
	// not cover everything owed, so a real balance remains. The loan is NOT
	// closed and the amount stays collectible, pending a Branch Manager/
	// Management decision to write it off or pursue it (see
	// AuctionDecisionKindShortfall).
	//
	// Interest deliberately does NOT accrue in this state: projectAccrual only
	// accrues for Active/DueSoon/Overdue, so the balance stays frozen at the
	// post-sale figure while the decision is outstanding — the manager judges a
	// stable number. Choosing PursueBalance moves the loan back to Overdue,
	// which resumes normal accrual through the existing path.
	StatusAuctionedBalanceDue = "Auctioned - Balance Due"
)

// ApprovalStageApproved/Rejected are the two terminal values shared by
// BOTH approval chains in this package: the loan sanction chain below
// (Loan.ApprovalStage) and the Release-request chain (LoanRequest.
// ApprovalStage, decided via Service.ApproveReleaseRequest) — kept as one
// shared pair of constants so both chains render identically in the UI.
const (
	ApprovalStageApproved = "Approved"
	ApprovalStageRejected = "Rejected"
)

// ApprovalActionVerified is a third, non-terminal action value for
// LoanApproval.Action — valid ONLY for a Loan Operator's own decision at
// the LoanOperator sanction stage when the principal exceeds their
// hard-enforced approval limit (see Service.loanOperatorLimit). It records
// that the operator reviewed the loan without granting them approval
// authority they don't have: the sanction chain doesn't advance on
// Verified alone — Branch Manager/Management must still clear the stage
// with a normal Approved (or Rejected) action afterward. See
// Service.Approve and Service.operatorVerified.
const ApprovalActionVerified = "Verified"

// ApprovalStagePendingManager/PendingManagement are the Release-request
// chain's two pending stages ONLY (LoanRequest.ApprovalStage) — unrelated
// to the loan sanction chain below, which has its own 4 pending stages.
const (
	ApprovalStagePendingManager    = "PendingManager"
	ApprovalStagePendingManagement = "PendingManagement"
)

// SanctionStage* values drive the loan sanction chain (Loan.ApprovalStage)
// — 4 checkpoints per the spec, in order: Loan Operator -> Branch Manager
// -> Authorized Management -> Final Sanction -> Approved (Status ->
// Active). Each stage requires an employee with the matching role (see
// employee.ValidRoles) to act, EXCEPT the "Administrator" role, which may
// act at any pending stage (see Service.Approve). There is no hard cap
// enforced on loan amount at any stage — SanctionLimits (in service.go) is
// consulted only to surface an advisory warning to the reviewer, never to
// block the decision.
const (
	SanctionStageLoanOperator         = "LoanOperator"
	SanctionStageBranchManager        = "BranchManager"
	SanctionStageAuthorizedManagement = "AuthorizedManagement"
	SanctionStageFinalSanction        = "FinalSanction"
)

// Bank-pledge status values for Loan.BankPledgeStatus.
const (
	BankPledgeStatusNotPledged = "Not Pledged"
	BankPledgeStatusPledged    = "Bank Pledged"
	BankPledgeStatusReleased   = "Released"
)

// Loan represents one gold loan: a customer's pledged ornaments, sanctioned
// under a scheme, tracked from creation through closure/auction.
type Loan struct {
	ID         uint   `json:"id" gorm:"primaryKey"`
	LoanNumber string `json:"loanNumber" gorm:"uniqueIndex;size:20"`

	BranchID uint          `json:"branchId" gorm:"not null"`
	Branch   branch.Branch `json:"branch" gorm:"foreignKey:BranchID"`

	CustomerID uint              `json:"customerId" gorm:"not null"`
	Customer   customer.Customer `json:"customer" gorm:"foreignKey:CustomerID"`

	SchemeID uint          `json:"schemeId" gorm:"not null"`
	Scheme   scheme.Scheme `json:"scheme" gorm:"foreignKey:SchemeID"`

	OpenedDate time.Time `json:"openedDate" gorm:"not null"`
	DueDate    time.Time `json:"dueDate" gorm:"not null"`

	// TotalNetWeight/TotalGoldValue/EligibleLoanAmount are computed from the
	// loan's ornaments (see service.go's recalculate) and kept denormalized
	// here so listing/filtering doesn't need to re-sum ornaments every time.
	// Weights stay double precision (grams want more than 2 decimals);
	// every rupee column below is numeric(16,2) so stored balances are exact
	// decimals — see platform.RoundMoney for why.
	TotalNetWeight     float64 `json:"totalNetWeight"`
	TotalGoldValue     float64 `json:"totalGoldValue" gorm:"type:numeric(16,2);default:0"`
	EligibleLoanAmount float64 `json:"eligibleLoanAmount" gorm:"type:numeric(16,2);default:0"`

	// PrincipalAmount is operator-chosen, capped at EligibleLoanAmount.
	// OutstandingAmount tracks *principal* only — interest/penal interest
	// owed are tracked separately below so each can be paid down (or
	// waived) independently, per the ledger requirements in the interest &
	// payment management spec.
	PrincipalAmount   float64 `json:"principalAmount" gorm:"not null;type:numeric(16,2)"`
	OutstandingAmount float64 `json:"outstandingAmount" gorm:"not null;type:numeric(16,2)"`

	// OutstandingProcessingFee is a running balance of processing fees
	// charged (via a payment's ProcessingFee) but not yet paid off. Charging
	// a fee adds to this balance immediately; it then has first priority in
	// allocatePayment's waterfall — the very next rupee paid in goes toward
	// clearing it before penal interest/interest/principal — and it's
	// folded into TotalOutstandingBalance/SettlementAmount (see enrich)
	// so "what's owed" always reflects any unpaid fee.
	OutstandingProcessingFee float64 `json:"outstandingProcessingFee" gorm:"type:numeric(16,2);default:0"`

	// Interest/penal-interest accrual (see service.go's accrueInterest).
	// AccruedInterest/AccruedPenalInterest are cumulative totals-ever-owed,
	// advanced up to LastAccrualDate each time the loan is fetched or paid
	// against; InterestPaid/PenalInterestPaid are cumulative totals-ever-
	// paid-or-waived. Outstanding interest/penal interest (accrued − paid)
	// is a computed, not stored, figure — see Service.enrich.
	AccruedInterest      float64   `json:"accruedInterest" gorm:"type:numeric(16,2);default:0"`
	InterestPaid         float64   `json:"interestPaid" gorm:"type:numeric(16,2);default:0"`
	AccruedPenalInterest float64   `json:"accruedPenalInterest" gorm:"type:numeric(16,2);default:0"`
	PenalInterestPaid    float64   `json:"penalInterestPaid" gorm:"type:numeric(16,2);default:0"`
	LastAccrualDate      time.Time `json:"lastAccrualDate"`

	// Computed, request-scoped fields — never persisted (gorm:"-"),
	// populated by Service.enrich before a Loan is returned from Get/List/
	// Create/Approve/RecordPayment/etc. so every API response carries the
	// same live "what's owed today" figures without duplicating the
	// accrual math in every handler.
	OutstandingInterest      float64 `json:"outstandingInterest" gorm:"-"`
	OutstandingPenalInterest float64 `json:"outstandingPenalInterest" gorm:"-"`
	TotalOutstandingBalance  float64 `json:"totalOutstandingBalance" gorm:"-"`
	SettlementAmount         float64 `json:"settlementAmount" gorm:"-"`
	TotalPaid                float64 `json:"totalPaid" gorm:"-"`

	// IsDueSoon/IsOverdue/IsDefaulted/DaysOverdue are display flags,
	// recomputed on every read (see enrichStatusFlags in accrual.go) — they
	// do NOT drive interest/penal-interest accrual (which already runs off
	// DueDate directly, see projectAccrual) and do NOT auto-transition the
	// persisted Status field. IsDueSoon/IsOverdue/DaysOverdue are pure
	// date-vs-DueDate math; IsDefaulted additionally requires genuine
	// payment arrears (OutstandingInterest and/or OutstandingPenalInterest
	// still owed) on top of being overdue by more than 90 days — a loan
	// kept current on interest/penal interest past its due date is overdue
	// but not Defaulted. IsDefaulted only unlocks the staff-triggered "Mark
	// Auction Eligible" action — it never fires that transition
	// automatically.
	IsDueSoon   bool `json:"isDueSoon" gorm:"-"`
	IsOverdue   bool `json:"isOverdue" gorm:"-"`
	IsDefaulted bool `json:"isDefaulted" gorm:"-"`
	DaysOverdue int  `json:"daysOverdue" gorm:"-"`

	// ApprovalWarning is a non-blocking, advisory note shown to whoever is
	// reviewing the loan's current pending sanction stage, when the
	// principal exceeds that stage's role's typical SanctionLimit (see
	// service.go). Empty when there's nothing to flag, or once the loan
	// has left the sanction chain (Approved/Rejected). Never prevents the
	// approve/reject action from going through.
	ApprovalWarning string `json:"approvalWarning" gorm:"-"`

	Status        string `json:"status" gorm:"not null;size:30"`
	ApprovalStage string `json:"approvalStage" gorm:"not null;size:30"`

	BankPledgeStatus string `json:"bankPledgeStatus" gorm:"not null;size:20;default:'Not Pledged'"`

	AuctionDate   *time.Time `json:"auctionDate"`
	AuctionAmount *float64   `json:"auctionAmount" gorm:"type:numeric(16,2)"`

	Ornaments []Ornament         `json:"ornaments,omitempty" gorm:"foreignKey:LoanID"`
	Approvals []LoanApproval     `json:"approvals,omitempty" gorm:"foreignKey:LoanID"`
	Payments  []LoanPayment      `json:"payments,omitempty" gorm:"foreignKey:LoanID"`
	Pledges   []BankPledgeRecord `json:"bankPledges,omitempty" gorm:"foreignKey:LoanID"`

	CreatedAt time.Time      `json:"createdAt"`
	UpdatedAt time.Time      `json:"updatedAt"`
	DeletedAt gorm.DeletedAt `json:"-" gorm:"index"`
}

func (Loan) TableName() string { return "loans" }

// Ornament represents one pledged gold item declared at intake time
// (name/type, purity, weights, deductions, computed value). Purity-test
// results captured later by staff live separately in OrnamentPurityTest —
// this row is never overwritten by a later test.
type Ornament struct {
	ID     uint `json:"id" gorm:"primaryKey"`
	LoanID uint `json:"loanId" gorm:"not null;index"`

	Name   string `json:"name" gorm:"not null;size:80"`   // e.g. "Chain", "Bangle", "Ring", "Necklace", "Earrings"
	Purity string `json:"purity" gorm:"not null;size:10"` // unit-suffixed, e.g. "22K" or "91.6%" — see loan/purity.go's ParsePurity

	GrossWeight     float64 `json:"grossWeight" gorm:"not null"`
	DeductionWeight float64 `json:"deductionWeight"`
	NetWeight       float64 `json:"netWeight"` // computed = GrossWeight - DeductionWeight
	Quantity        int     `json:"quantity" gorm:"not null;default:1"`

	GoldValue float64 `json:"goldValue" gorm:"type:numeric(16,2);default:0"` // computed = NetWeight × purity-matched gold rate
	Remarks   string  `json:"remarks" gorm:"size:255"`

	PurityTest *OrnamentPurityTest `json:"purityTest,omitempty" gorm:"foreignKey:OrnamentID"`
	Images     []OrnamentImage     `json:"images,omitempty" gorm:"foreignKey:OrnamentID"`

	CreatedAt time.Time `json:"createdAt"`
	UpdatedAt time.Time `json:"updatedAt"`
}

func (Ornament) TableName() string { return "ornaments" }

// OrnamentPurityTest records the staff-verified re-test of an ornament,
// entered manually sometime after pledge. One-to-one with Ornament.
type OrnamentPurityTest struct {
	ID         uint `json:"id" gorm:"primaryKey"`
	OrnamentID uint `json:"ornamentId" gorm:"uniqueIndex;not null"`

	TestedPurity          string    `json:"testedPurity" gorm:"not null;size:10"` // unit-suffixed, e.g. "22K" or "91.6%" — see loan/purity.go's ParsePurity
	TestedGrossWeight     float64   `json:"testedGrossWeight" gorm:"not null"`
	TestedDeductionWeight float64   `json:"testedDeductionWeight"`
	TestedNetWeight       float64   `json:"testedNetWeight"`
	TestingRemarks        string    `json:"testingRemarks" gorm:"size:255"`
	TestedBy              string    `json:"testedBy" gorm:"not null;size:120"`
	TestedAt              time.Time `json:"testedAt" gorm:"not null"`

	CreatedAt time.Time `json:"createdAt"`
}

func (OrnamentPurityTest) TableName() string { return "ornament_purity_tests" }

// OrnamentImage is one photo of a pledged ornament. An ornament can have
// any number of these. ImageURL points at the shared upload endpoint
// (internal/upload) — files are stored on disk, not base64-in-DB.
type OrnamentImage struct {
	ID         uint      `json:"id" gorm:"primaryKey"`
	OrnamentID uint      `json:"ornamentId" gorm:"not null;index"`
	ImageURL   string    `json:"imageUrl" gorm:"not null;size:255"`
	CreatedAt  time.Time `json:"createdAt"`
}

func (OrnamentImage) TableName() string { return "ornament_images" }

// LoanApproval is the audit trail for the loan's 4-step sanction chain —
// one row per decision (approve/reject) taken at a stage. ActorEmployeeID/
// ActorRole are passed explicitly by the caller (no auth/session exists
// yet); ActorRole records which role actually acted (relevant now that
// "Administrator" may act on behalf of any pending stage).
type LoanApproval struct {
	ID     uint `json:"id" gorm:"primaryKey"`
	LoanID uint `json:"loanId" gorm:"not null;index"`

	Stage           string `json:"stage" gorm:"not null;size:30"`  // one of SanctionStage*
	Action          string `json:"action" gorm:"not null;size:20"` // "Approved" | "Rejected" | "Verified" (LoanOperator stage only, see ApprovalActionVerified)
	ActorEmployeeID uint   `json:"actorEmployeeId" gorm:"not null"`
	ActorRole       string `json:"actorRole" gorm:"size:40"`
	Remarks         string `json:"remarks" gorm:"size:255"`

	CreatedAt time.Time `json:"createdAt"`
}

func (LoanApproval) TableName() string { return "loan_approvals" }

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

	Amount               float64   `json:"amount" gorm:"not null;type:numeric(16,2)"`
	Type                 string    `json:"type" gorm:"not null;size:30"` // see PaymentType* constants
	PaidOn               time.Time `json:"paidOn" gorm:"not null"`
	ReceivedByEmployeeID uint      `json:"receivedByEmployeeId" gorm:"not null"`

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

// BankPledgeRecord is a lightweight audit record of a loan (or batch of
// loans, tracked one row per loan) being pledged to / released from a bank.
type BankPledgeRecord struct {
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

	// ExpenseID links to the auto-approved Expense entry mirroring this
	// pledge's cash-in, so the amount also shows up in the Expenses/reports
	// view. Nil for pledges recorded before this linkage existed.
	ExpenseID *uint `json:"expenseId,omitempty"`

	// ReleaseCashMovementID/ReleaseExpenseID link to the cash-out movement
	// and mirrored expense entry created when the gold is released from the
	// bank (see loan.CashRecorder.RecordBankPledgeCashOut/
	// RecordBankPledgeReleaseExpense). Both nil until release.
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

// Loan-request type/status values for LoanRequest.
const (
	RequestTypeExtension = "Extension"
	RequestTypeRelease   = "Release"

	RequestStatusPending  = "Pending"
	RequestStatusApproved = "Approved"
	RequestStatusRejected = "Rejected"

	RequestedByCustomer = "Customer" // submitted through the Android app (not built yet)
	RequestedByStaff    = "Staff"    // logged by a branch employee on the customer's behalf
)

// LoanRequest is a staff-logged ask — in person, on the customer's behalf —
// to either extend a loan's due date or release/close it. Extension
// requests go through a single staff decision (Service.DecideRequest).
// Release requests go through the same fixed Manager→Management approval
// chain used for loan sanctioning (ApprovalStage below, decided via
// Service.ApproveReleaseRequest), gated by the verification checklist.
type LoanRequest struct {
	ID     uint `json:"id" gorm:"primaryKey"`
	LoanID uint `json:"loanId" gorm:"not null;index"`
	Loan   Loan `json:"loan" gorm:"foreignKey:LoanID"`

	Type        string `json:"type" gorm:"not null;size:20"`   // "Extension" | "Release"
	Status      string `json:"status" gorm:"not null;size:20"` // "Pending" | "Approved" | "Rejected"
	RequestedBy string `json:"requestedBy" gorm:"not null;size:20"`
	Detail      string `json:"detail" gorm:"size:255"`

	// RequestedExtensionMonths/NewDueDate only apply to Type == Extension.
	RequestedExtensionMonths *int       `json:"requestedExtensionMonths,omitempty"`
	NewDueDate               *time.Time `json:"newDueDate,omitempty"`

	// ApprovalStage only applies to Type == Release — reuses the same
	// ApprovalStage* constants as Loan's sanction chain (PendingManager ->
	// PendingManagement -> Approved/Rejected). Extension requests are
	// decided in one step and never set this.
	ApprovalStage string `json:"approvalStage,omitempty" gorm:"size:30"`

	// Verification checklist, Release only — all four must be true before
	// the first approval stage can be submitted (see
	// Service.ApproveReleaseRequest). Staff tick these one at a time via
	// Service.VerifyReleaseChecklist as they confirm each item in person.
	PaymentVerified    bool   `json:"paymentVerified"`
	PacketVerified     bool   `json:"packetVerified"`
	BankPledgeVerified bool   `json:"bankPledgeVerified"`
	CustomerConfirmed  bool   `json:"customerConfirmed"`
	VerificationNotes  string `json:"verificationNotes" gorm:"size:255"`

	// Charges is a single staff-entered override amount (e.g. statutory/
	// valuation charges), Release only, added into SettlementAmount below.
	Charges float64 `json:"charges" gorm:"type:numeric(16,2);default:0"`

	// SettlementAmount is a snapshot of Loan.TotalOutstandingBalance +
	// Charges taken the moment the release approval chain reaches its final
	// "Approved" — the live figure on Loan keeps moving as payments come in,
	// this freezes what was actually approved for release.
	SettlementAmount float64 `json:"settlementAmount" gorm:"type:numeric(16,2);default:0"`

	Remarks             string     `json:"remarks" gorm:"size:255"`
	RequestedAt         time.Time  `json:"requestedAt" gorm:"not null"`
	DecidedAt           *time.Time `json:"decidedAt,omitempty"`
	DecidedByEmployeeID *uint      `json:"decidedByEmployeeId,omitempty"`

	CreatedAt time.Time `json:"createdAt"`
	UpdatedAt time.Time `json:"updatedAt"`
}

func (LoanRequest) TableName() string { return "loan_requests" }

// RequestApproval is the audit trail for a Release LoanRequest's
// Manager→Management approval chain — mirrors LoanApproval exactly, kept as
// a separate table since the subject is a request, not a loan.
type RequestApproval struct {
	ID        uint `json:"id" gorm:"primaryKey"`
	RequestID uint `json:"requestId" gorm:"not null;index"`

	Stage           string `json:"stage" gorm:"not null;size:30"`  // "Manager" | "Management"
	Action          string `json:"action" gorm:"not null;size:20"` // "Approved" | "Rejected"
	ActorEmployeeID uint   `json:"actorEmployeeId" gorm:"not null"`
	Remarks         string `json:"remarks" gorm:"size:255"`

	CreatedAt time.Time `json:"createdAt"`
}

func (RequestApproval) TableName() string { return "request_approvals" }

// Auction stage values driving AuctionRecord.Stage — the full 7-step
// workflow the spec calls for: Overdue -> Defaulted (both handled
// upstream, see Loan.IsOverdue/IsDefaulted — no AuctionRecord exists yet
// at that point) -> AuctionEligible -> NoticeIssued -> AuctionScheduled ->
// Auctioned -> Settled.
// Withdrawn is a second terminal stage alongside Settled, reached when a
// customer's repayment causes the case to be pulled out of the auction
// pipeline by management decision (see Service.ResolveAuctionDecision).
const (
	AuctionStageEligible  = "AuctionEligible"
	AuctionStageNotice    = "NoticeIssued"
	AuctionStageScheduled = "AuctionScheduled"
	AuctionStageAuctioned = "Auctioned"
	AuctionStageSettled   = "Settled"
	AuctionStageWithdrawn = "Withdrawn"
)

// IsActiveAuctionStage reports whether a stage is still live — i.e. not one
// of the two terminal stages. A loan may have at most one auction record in
// an active stage at a time (enforced by a partial unique index, see
// cmd/migrate), but any number of concluded ones, which is what lets a
// re-defaulted loan start a fresh auction while its history stays intact.
func IsActiveAuctionStage(stage string) bool {
	return stage != AuctionStageSettled && stage != AuctionStageWithdrawn
}

// Auction final-settlement status values for AuctionRecord.
// FinalSettlementStatus.
const (
	AuctionSettlementPending = "Pending"
	// AuctionSettlementSettledByRepayment marks a case the customer rescued
	// by clearing the loan in full before the gold was sold — set
	// automatically by RecordPayment, never by staff action.
	AuctionSettlementSettledByRepayment = "SettledByRepayment"
	// AuctionSettlementWrittenOff marks a post-auction shortfall that
	// management chose to forgive rather than pursue.
	AuctionSettlementWrittenOff = "WrittenOff"

	AuctionSettlementSettledToCustomer = "SettledToCustomer"
	AuctionSettlementSettledToLoanCo   = "SettledToLoanCo"
)

// Surplus-disposition values for AuctionRecord.SurplusDisposition — what was
// done with money left over after an auction cleared the debt. Staff must
// choose explicitly; there is no default.
const (
	AuctionSurplusRefundedToCustomer = "RefundedToCustomer"
	AuctionSurplusRecordedAsIncome   = "RecordedAsIncome"
)

// AuctionRecord is the real, trackable case record created the moment a
// defaulted loan is marked auction-eligible (Service.MarkAuctionEligible)
// — replaces the old one-shot RecordAuction() that used to jump a loan
// straight from any status to "Auctioned" with no intermediate stages.
// A loan has at most one AuctionRecord in an *active* stage at a time, but
// may accumulate several concluded ones over its life: a case withdrawn
// after the customer caught up can be started again if they default afresh.
// That "one active, many concluded" rule is enforced by a partial unique
// index on (loan_id) WHERE stage NOT IN ('Settled','Withdrawn') — created in
// cmd/migrate, since GORM struct tags cannot express partial indexes. A plain
// non-unique index is declared here for lookup performance.
type AuctionRecord struct {
	ID     uint `json:"id" gorm:"primaryKey"`
	LoanID uint `json:"loanId" gorm:"not null;index"`

	Stage string `json:"stage" gorm:"not null;size:20"`

	AuctionEligibleDate    time.Time  `json:"auctionEligibleDate" gorm:"not null"`
	AuctionDate            *time.Time `json:"auctionDate,omitempty"`
	AuctionReferenceNumber string     `json:"auctionReferenceNumber" gorm:"size:60"`

	SaleAmount      float64 `json:"saleAmount" gorm:"type:numeric(16,2);default:0"`
	AuctionExpenses float64 `json:"auctionExpenses" gorm:"type:numeric(16,2);default:0"`
	// SurplusShortfall is a snapshot taken at sale time: SaleAmount -
	// AuctionExpenses - the loan's TotalOutstandingBalance at that moment.
	// Positive = surplus owed back to the customer, negative = shortfall
	// still recoverable from them.
	SurplusShortfall float64 `json:"surplusShortfall" gorm:"type:numeric(16,2);default:0"`

	FinalSettlementStatus string `json:"finalSettlementStatus" gorm:"not null;size:24;default:'Pending'"`

	// SurplusPayableAmount is the money owed BACK to the customer when the
	// sale more than cleared the debt: max(0, netProceeds - totalDebt),
	// snapshotted at sale time. The full net proceeds are booked as cash-in
	// (the branch really did receive them), so this field is what stops the
	// customer's share from being quietly absorbed into branch cash — it stays
	// visible as an obligation until disposed of.
	//
	// This app has no general ledger, so the payable is tracked here on the
	// case record rather than in a liability account.
	SurplusPayableAmount float64 `json:"surplusPayableAmount" gorm:"type:numeric(16,2);default:0"`

	// SurplusDisposition records what was decided about the surplus —
	// RefundedToCustomer (a real cash-out is booked) or RecordedAsIncome (the
	// money stays in the till and is labelled as income). Empty until decided;
	// once set it cannot be changed, so a surplus can never be paid out twice.
	SurplusDisposition       string `json:"surplusDisposition,omitempty" gorm:"size:24"`
	SurplusPaidOutMovementID *uint  `json:"surplusPaidOutMovementId,omitempty"`

	Notices []AuctionNotice `json:"notices,omitempty" gorm:"foreignKey:AuctionRecordID"`
	// Events is the who-did-what audit trail for stage transitions. Notices
	// already cover customer communication; this covers staff action, which
	// previously left no trace at all.
	Events []AuctionEvent `json:"events,omitempty" gorm:"foreignKey:AuctionRecordID"`
	// DecisionRequests are the escalations raised against this case — a
	// partial repayment needing a keep/remove call, or a post-auction
	// shortfall needing a write-off/pursue call.
	DecisionRequests []AuctionDecisionRequest `json:"decisionRequests,omitempty" gorm:"foreignKey:AuctionRecordID"`

	CreatedAt time.Time `json:"createdAt"`
	UpdatedAt time.Time `json:"updatedAt"`
}

func (AuctionRecord) TableName() string { return "auction_records" }

// Action values for AuctionEvent.Action.
const (
	AuctionEventEligible               = "Eligible"
	AuctionEventNoticeIssued           = "NoticeIssued"
	AuctionEventScheduled              = "Scheduled"
	AuctionEventSaleRecorded           = "SaleRecorded"
	AuctionEventSettled                = "Settled"
	AuctionEventSettledByRepaymentAuto = "SettledByRepaymentAuto"
	AuctionEventDecisionRequested      = "DecisionRequested"
	AuctionEventShortfallEscalated     = "ShortfallEscalated"
	AuctionEventDecisionKeep           = "DecisionKeep"
	AuctionEventDecisionRemove         = "DecisionRemove"
	AuctionEventDecisionWriteOff       = "DecisionWriteOff"
	AuctionEventDecisionPursue         = "DecisionPursue"
)

// AuctionEvent is one entry in an auction case's staff-action audit trail.
// Deliberately lightweight, mirroring AuctionNotice, because this codebase
// has no general audit-log facility. ActorEmployeeID is nil for entries the
// system generates on its own (e.g. an auction auto-settled by a repayment).
type AuctionEvent struct {
	ID              uint      `json:"id" gorm:"primaryKey"`
	AuctionRecordID uint      `json:"auctionRecordId" gorm:"not null;index"`
	Action          string    `json:"action" gorm:"not null;size:30"`
	ActorEmployeeID *uint     `json:"actorEmployeeId,omitempty"`
	ActorRole       string    `json:"actorRole,omitempty" gorm:"size:40"`
	Remarks         string    `json:"remarks,omitempty" gorm:"size:255"`
	CreatedAt       time.Time `json:"createdAt"`
}

func (AuctionEvent) TableName() string { return "auction_events" }

// Kinds of escalation an AuctionDecisionRequest can represent. One table
// serves both because the shape and lifecycle are identical — only the legal
// outcomes differ, which the service validates per kind.
const (
	// AuctionDecisionKindPartialRepayment is raised automatically when a
	// customer part-pays a loan whose gold is still in the auction pipeline:
	// somebody must decide whether to keep pursuing the auction or pull the
	// gold out. The auction is FROZEN while this is pending.
	AuctionDecisionKindPartialRepayment = "PartialRepayment"
	// AuctionDecisionKindShortfall is raised automatically when an auction
	// sale failed to cover the debt: only Branch Manager/Management/
	// Administrator may decide whether to write the balance off or pursue it.
	// The Auction Administrator raises this but may not decide it.
	AuctionDecisionKindShortfall = "Shortfall"
)

// Status values for AuctionDecisionRequest.Status. Which terminal values are
// legal depends on Kind — see Service.ResolveAuctionDecision.
const (
	AuctionDecisionPending = "Pending"

	// Valid outcomes for a PartialRepayment request.
	AuctionDecisionKeepInAuction      = "KeepInAuction"
	AuctionDecisionRemovedFromAuction = "RemovedFromAuction"

	// Valid outcomes for a Shortfall request.
	AuctionDecisionWriteOff      = "WriteOff"
	AuctionDecisionPursueBalance = "PursueBalance"
)

// AuctionDecisionRequest is an escalation asking a human to decide an
// auction's direction. Both kinds are raised by the system, never by staff,
// so the decision cannot be quietly skipped.
//
// Only one Pending request per (auction record, kind) may exist — enforced by
// a partial unique index created in cmd/migrate. A further payment arriving
// while one is already pending updates it in place rather than piling up
// duplicates.
type AuctionDecisionRequest struct {
	ID              uint   `json:"id" gorm:"primaryKey"`
	AuctionRecordID uint   `json:"auctionRecordId" gorm:"not null;index"`
	LoanID          uint   `json:"loanId" gorm:"not null;index"`
	Kind            string `json:"kind" gorm:"not null;size:20"`

	// TriggeredByPaymentID points at the payment that caused a
	// PartialRepayment escalation. Nil for Shortfall requests, which are
	// triggered by a sale rather than a payment.
	TriggeredByPaymentID *uint `json:"triggeredByPaymentId,omitempty"`

	// AmountPaid is the payment that triggered the escalation
	// (PartialRepayment), or the net auction proceeds applied (Shortfall).
	// OutstandingAtRequest is what remained owed at that moment — the figure
	// the decision-maker is judging.
	AmountPaid           float64 `json:"amountPaid" gorm:"type:numeric(16,2);default:0"`
	OutstandingAtRequest float64 `json:"outstandingAtRequest" gorm:"type:numeric(16,2);default:0"`

	Status              string     `json:"status" gorm:"not null;size:24;default:'Pending'"`
	DecidedByEmployeeID *uint      `json:"decidedByEmployeeId,omitempty"`
	DecidedByRole       string     `json:"decidedByRole,omitempty" gorm:"size:40"`
	DecisionRemarks     string     `json:"decisionRemarks,omitempty" gorm:"size:255"`
	DecidedAt           *time.Time `json:"decidedAt,omitempty"`

	CreatedAt time.Time `json:"createdAt"`
	UpdatedAt time.Time `json:"updatedAt"`
}

func (AuctionDecisionRequest) TableName() string { return "auction_decision_requests" }

// AuctionNotice is one customer notice logged against an AuctionRecord —
// multiple can be issued over time (the spec's "customer notice history").
type AuctionNotice struct {
	ID              uint      `json:"id" gorm:"primaryKey"`
	AuctionRecordID uint      `json:"auctionRecordId" gorm:"not null;index"`
	IssuedAt        time.Time `json:"issuedAt" gorm:"not null"`
	Method          string    `json:"method" gorm:"size:40"` // e.g. "Registered Post" | "SMS" | "In Person"
	Remarks         string    `json:"remarks" gorm:"size:255"`
	CreatedAt       time.Time `json:"createdAt"`
}

func (AuctionNotice) TableName() string { return "auction_notices" }
