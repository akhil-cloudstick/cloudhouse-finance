// Package loan implements the Gold Loan Creation & Ornaments Management
// domain (frontend/components/NewLoan.tsx, LoanDetail.tsx, Loans.tsx): a
// loan pledges one or more ornaments belonging to an existing, KYC-verified
// customer under a scheme, goes through a fixed 3-step sanction-approval
// chain, and is tracked through payments, bank pledge, and eventual
// closure/auction. Several related resources live in this one package
// (Loan, Ornament, OrnamentPurityTest, OrnamentImage, LoanApproval,
// LoanPayment, BankPledgeRecord) — same grouping style as internal/cash's
// CashMovement+Expense. Split across model_*.go files, one per entity/group
// (model_loan.go for Loan itself, model_ornament.go, model_approval.go,
// model_payment.go, model_bank_pledge.go, model_request.go, model_draft.go,
// model_auction.go), mirroring the handler-side split this package already
// has (payment.go, purity.go, indemnitybond.go, etc.).
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

// ApprovalActionVerified is the action value for the LoanOperator sanction
// stage: the operator who made the loan verifies it, which is a
// verification rather than a sanction (the loan is sanctioned further up
// the chain by the Branch Manager and Management). It DOES advance the
// chain — LoanOperator -> BranchManager — exactly like an Approved action
// at any other stage, and is accepted only at the LoanOperator stage. See
// Service.Approve.
const ApprovalActionVerified = "Verified"

// ApprovalStagePendingManager/PendingManagement are the Release-request
// chain's two pending stages ONLY (LoanRequest.ApprovalStage) — unrelated
// to the loan sanction chain below, which has its own 4 pending stages.
const (
	ApprovalStagePendingManager    = "PendingManager"
	ApprovalStagePendingManagement = "PendingManagement"
)

// ApprovalStagePendingLoanOfficer/PendingBranchManager are the Extension-
// request chain's first two pending stages (LoanRequest.ApprovalStage) —
// mirrors the Release chain above, but with an extra checkpoint in front:
// Loan Officer -> Branch Manager -> Management. The final stage reuses
// ApprovalStagePendingManagement (same value as Release's) since it's the
// same role gate either way; only Approved/Rejected are truly shared
// terminals. See Service.ApproveExtensionRequest.
const (
	ApprovalStagePendingLoanOfficer   = "PendingLoanOfficer"
	ApprovalStagePendingBranchManager = "PendingBranchManager"
)

// SanctionStage* values drive the loan sanction chain (Loan.ApprovalStage)
// — 3 checkpoints, in order: the loan is made by a Loan Operator, verified
// by the Loan Operator (LoanOperator), approved by the Branch Manager
// (BranchManager), then finally sanctioned by Management (FinalSanction) ->
// Approved (Status -> Active). Each stage requires an employee with the
// matching role (see employee.ValidRoles) to act, EXCEPT the
// "Administrator" role, which may act at any pending stage (see
// Service.Approve). There is no hard cap enforced on loan amount at any
// stage — sanctionLimits/the Loan Operator approval limit are consulted
// only to surface an advisory warning to the reviewer, never to block the
// decision.
const (
	SanctionStageLoanOperator  = "LoanOperator"
	SanctionStageBranchManager = "BranchManager"
	SanctionStageFinalSanction = "FinalSanction"
)

// SanctionStageAuthorizedManagement is a RETIRED stage. The chain used to
// run LoanOperator -> BranchManager -> AuthorizedManagement ->
// FinalSanction, which made Management sign off twice (and, above the Loan
// Operator's limit, the Branch Manager too). Rows still parked on this
// value are migrated to FinalSanction by MigrateRetiredSanctionStage, and
// normalizeSanctionStage treats any that slip through as FinalSanction so
// such a loan is never stuck at a stage no role can clear.
const SanctionStageAuthorizedManagement = "AuthorizedManagement"

// Bank-pledge status values for Loan.BankPledgeStatus.
//
// BankPledgeStatusReleased means the gold came back FROM the bank, not that
// it went back to the customer (that is Loan.Status = StatusClosed, see
// Service.CompleteRelease). Either way the loan is spent as far as bank
// pledging goes: a bank pledge is ONCE PER LOAN for its lifetime, so only
// BankPledgeStatusNotPledged may start one (see Service.RecordBankPledge and
// LoanFilter.ExcludeBankPledged).
const (
	BankPledgeStatusNotPledged = "Not Pledged"
	BankPledgeStatusPledged    = "Bank Pledged"
	BankPledgeStatusReleased   = "Released"
)

// bankPledgeIneligibleStatuses lists the loan statuses whose gold is no
// longer the branch's to hand to a bank, so a re-pledge must be refused:
//
//   - StatusClosed — gold has been released back to the customer.
//   - StatusClosureRequested — release is approved/in flight and the gold is
//     committed to the customer; pledging it now would deadlock the release
//     (CompleteRelease refuses while a pledge is active).
//   - StatusAuctioned / StatusAuctionedBalanceDue — the gold has been sold.
//   - StatusPendingApproval — not disbursed yet, so never in custody.
//
// Enforced in Service.RecordBankPledge and mirrored by
// LoanFilter.ExcludeBankPledged so the picker never offers what the service
// would reject.
var bankPledgeIneligibleStatuses = []string{
	StatusClosed,
	StatusClosureRequested,
	StatusAuctioned,
	StatusAuctionedBalanceDue,
	StatusPendingApproval,
}

// CanAcceptBankPledge reports whether a loan in this status may be
// re-pledged to a bank (see bankPledgeIneligibleStatuses).
func CanAcceptBankPledge(status string) bool {
	for _, s := range bankPledgeIneligibleStatuses {
		if status == s {
			return false
		}
	}
	return true
}

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

	// AdditionalInfo is free text staff enter at loan creation for anything
	// the standard fields don't capture — carried through onto the printed
	// Statement of Account (see loan/indemnitybond.go's sibling, the
	// Statement-of-Account block in the frontend/mobile print flows).
	// Optional; empty by default.
	AdditionalInfo string `json:"additionalInfo" gorm:"size:2000"`

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

	// DueSoonNotifiedAt/OverdueNotifiedAt dedupe the scheduled due/overdue
	// notification check (Service.CheckDueAndOverdueLoans) — each fires at
	// most once per DueDate value. Reset to nil whenever DueDate changes
	// (see ApproveExtensionRequest's final-stage branch), so an extended
	// loan can be reminded again against its new date.
	DueSoonNotifiedAt *time.Time `json:"-"`
	OverdueNotifiedAt *time.Time `json:"-"`

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

	// Indemnity bond Aadhaar eSign (Setu) — see indemnitybond.go and
	// Service.StartIndemnityBondSign/CheckIndemnityBondSign. Unlike
	// IsDueSoon/IsOverdue above, these ARE persisted: they track a real,
	// stateful external process (a document uploaded to Setu, a signature
	// request in flight), not a value recomputed fresh on every read.
	// IndemnityBondSignStatus is "" until a sign is started, then
	// "sign_initiated" -> "sign_complete" (or "failed"), mirroring Setu's
	// own SignatureStatus.Status values verbatim rather than remapping them.
	IndemnityBondDocumentID    string     `json:"indemnityBondDocumentId" gorm:"size:100"`
	IndemnityBondSignRequestID string     `json:"indemnityBondSignRequestId" gorm:"size:100"`
	IndemnityBondSignStatus    string     `json:"indemnityBondSignStatus" gorm:"size:20"`
	IndemnityBondSignedURL     string     `json:"indemnityBondSignedUrl" gorm:"size:255"`
	IndemnityBondSignedAt      *time.Time `json:"indemnityBondSignedAt"`

	Ornaments []Ornament         `json:"ornaments,omitempty" gorm:"foreignKey:LoanID"`
	Approvals []LoanApproval     `json:"approvals,omitempty" gorm:"foreignKey:LoanID"`
	Payments  []LoanPayment      `json:"payments,omitempty" gorm:"foreignKey:LoanID"`
	Pledges   []BankPledgeRecord `json:"bankPledges,omitempty" gorm:"foreignKey:LoanID"`

	CreatedAt time.Time      `json:"createdAt"`
	UpdatedAt time.Time      `json:"updatedAt"`
	DeletedAt gorm.DeletedAt `json:"-" gorm:"index"`
}

func (Loan) TableName() string { return "loans" }
