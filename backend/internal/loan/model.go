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
	TotalNetWeight     float64 `json:"totalNetWeight"`
	TotalGoldValue     float64 `json:"totalGoldValue"`
	EligibleLoanAmount float64 `json:"eligibleLoanAmount"`

	// PrincipalAmount is operator-chosen, capped at EligibleLoanAmount.
	// OutstandingAmount tracks *principal* only — interest/penal interest
	// owed are tracked separately below so each can be paid down (or
	// waived) independently, per the ledger requirements in the interest &
	// payment management spec.
	PrincipalAmount   float64 `json:"principalAmount" gorm:"not null"`
	OutstandingAmount float64 `json:"outstandingAmount" gorm:"not null"`

	// OutstandingProcessingFee is a running balance of processing fees
	// charged (via a payment's ProcessingFee) but not yet paid off. Charging
	// a fee adds to this balance immediately; it then has first priority in
	// allocatePayment's waterfall — the very next rupee paid in goes toward
	// clearing it before penal interest/interest/principal — and it's
	// folded into TotalOutstandingBalance/SettlementAmount (see enrich)
	// so "what's owed" always reflects any unpaid fee.
	OutstandingProcessingFee float64 `json:"outstandingProcessingFee"`

	// Interest/penal-interest accrual (see service.go's accrueInterest).
	// AccruedInterest/AccruedPenalInterest are cumulative totals-ever-owed,
	// advanced up to LastAccrualDate each time the loan is fetched or paid
	// against; InterestPaid/PenalInterestPaid are cumulative totals-ever-
	// paid-or-waived. Outstanding interest/penal interest (accrued − paid)
	// is a computed, not stored, figure — see Service.enrich.
	AccruedInterest      float64   `json:"accruedInterest"`
	InterestPaid         float64   `json:"interestPaid"`
	AccruedPenalInterest float64   `json:"accruedPenalInterest"`
	PenalInterestPaid    float64   `json:"penalInterestPaid"`
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

	// IsDueSoon/IsOverdue/IsDefaulted/DaysOverdue are pure date-vs-DueDate
	// display flags, recomputed on every read (see enrichStatusFlags in
	// accrual.go) — they do NOT drive interest/penal-interest accrual
	// (which already runs off DueDate directly, see projectAccrual) and do
	// NOT auto-transition the persisted Status field. IsDefaulted (overdue
	// by more than 90 days) only unlocks the staff-triggered "Mark Auction
	// Eligible" action — it never fires that transition automatically.
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
	AuctionAmount *float64   `json:"auctionAmount"`

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

	GoldValue float64 `json:"goldValue"` // computed = NetWeight × purity-matched gold rate
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
	Action          string `json:"action" gorm:"not null;size:20"` // "Approved" | "Rejected"
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
)

// LoanPayment is one entry in a loan's payment ledger: what was received
// (or adjusted/waived), how it was allocated across the penal-interest/
// interest/principal buckets, the running balance left after it, and the
// free-text details (method/reference/description) the spec's ledger
// calls for.
type LoanPayment struct {
	ID     uint `json:"id" gorm:"primaryKey"`
	LoanID uint `json:"loanId" gorm:"not null;index"`

	Amount               float64   `json:"amount" gorm:"not null"`
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
	ProcessingFeeApplied float64 `json:"processingFeeApplied"`
	PenalInterestApplied float64 `json:"penalInterestApplied"`
	InterestApplied      float64 `json:"interestApplied"`
	PrincipalApplied     float64 `json:"principalApplied"`

	// RunningBalance is TotalOutstandingBalance immediately after this entry
	// was applied (principal + outstanding interest + outstanding penal
	// interest + outstanding processing fee) — the ledger's required
	// "running balance" column.
	RunningBalance float64 `json:"runningBalance"`

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
	ProcessingFee float64 `json:"processingFee"`

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
	PledgedAmount float64    `json:"pledgedAmount" gorm:"not null"`
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

	// CashMovementID links to the Cash-in-Hand movement created for this
	// pledge (see loan.CashRecorder) so ReleaseBankPledge can remove it
	// again. Nil for pledges recorded before this linkage existed.
	CashMovementID *uint `json:"cashMovementId,omitempty"`

	CreatedAt time.Time `json:"createdAt"`
}

func (BankPledgeRecord) TableName() string { return "bank_pledge_records" }

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
	Charges float64 `json:"charges"`

	// SettlementAmount is a snapshot of Loan.TotalOutstandingBalance +
	// Charges taken the moment the release approval chain reaches its final
	// "Approved" — the live figure on Loan keeps moving as payments come in,
	// this freezes what was actually approved for release.
	SettlementAmount float64 `json:"settlementAmount"`

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
const (
	AuctionStageEligible  = "AuctionEligible"
	AuctionStageNotice    = "NoticeIssued"
	AuctionStageScheduled = "AuctionScheduled"
	AuctionStageAuctioned = "Auctioned"
	AuctionStageSettled   = "Settled"
)

// Auction final-settlement status values for AuctionRecord.
// FinalSettlementStatus.
const (
	AuctionSettlementPending           = "Pending"
	AuctionSettlementSettledToCustomer = "SettledToCustomer"
	AuctionSettlementSettledToLoanCo   = "SettledToLoanCo"
)

// AuctionRecord is the real, trackable case record created the moment a
// defaulted loan is marked auction-eligible (Service.MarkAuctionEligible)
// — replaces the old one-shot RecordAuction() that used to jump a loan
// straight from any status to "Auctioned" with no intermediate stages.
// One loan has at most one AuctionRecord (a defaulted loan can only be in
// the auction pipeline once at a time).
type AuctionRecord struct {
	ID     uint `json:"id" gorm:"primaryKey"`
	LoanID uint `json:"loanId" gorm:"not null;uniqueIndex"`

	Stage string `json:"stage" gorm:"not null;size:20"`

	AuctionEligibleDate    time.Time  `json:"auctionEligibleDate" gorm:"not null"`
	AuctionDate            *time.Time `json:"auctionDate,omitempty"`
	AuctionReferenceNumber string     `json:"auctionReferenceNumber" gorm:"size:60"`

	SaleAmount      float64 `json:"saleAmount"`
	AuctionExpenses float64 `json:"auctionExpenses"`
	// SurplusShortfall is a snapshot taken at sale time: SaleAmount -
	// AuctionExpenses - the loan's TotalOutstandingBalance at that moment.
	// Positive = surplus owed back to the customer, negative = shortfall
	// still recoverable from them.
	SurplusShortfall float64 `json:"surplusShortfall"`

	FinalSettlementStatus string `json:"finalSettlementStatus" gorm:"not null;size:20;default:'Pending'"`

	Notices []AuctionNotice `json:"notices,omitempty" gorm:"foreignKey:AuctionRecordID"`

	CreatedAt time.Time `json:"createdAt"`
	UpdatedAt time.Time `json:"updatedAt"`
}

func (AuctionRecord) TableName() string { return "auction_records" }

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
