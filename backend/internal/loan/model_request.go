package loan

import (
	"cloudhouse/backend/internal/platform"
	"time"
)

// Loan-request type/status values for LoanRequest.
const (
	RequestTypeExtension = "Extension"
	RequestTypeRelease   = "Release"
	// RequestTypeWaiver/Adjustment are staff requests to forgive owed
	// interest/penal interest (Waiver) or correct the principal
	// (Adjustment), posted as the matching non-cash payment type once the
	// tenant's waiver approval chain (workflow.FlowLoanWaiver) clears them —
	// see Service.CreateWaiverRequest.
	RequestTypeWaiver     = "Waiver"
	RequestTypeAdjustment = "Adjustment"

	RequestStatusPending  = "Pending"
	RequestStatusApproved = "Approved"
	RequestStatusRejected = "Rejected"

	RequestedByCustomer = "Customer" // submitted through the Android app (not built yet)
	RequestedByStaff    = "Staff"    // logged by a branch employee on the customer's behalf
)

// LoanRequest is an ask — logged by staff in person, or submitted directly
// by a customer through the Android app — to either extend a loan's due
// date or release/close it. Both request types go through a fixed,
// role-gated approval chain (ApprovalStage below): Extension runs Loan
// Officer -> Branch Manager -> Management (Service.ApproveExtensionRequest);
// Release runs the same Manager->Management chain used for loan sanctioning
// (Service.ApproveReleaseRequest), gated by the verification checklist.
// Service.DecideRequest, the old single-step decision path, now only
// rejects Extension requests with an error pointing at the staged endpoint.
type LoanRequest struct {
	platform.TenantScoped
	ID     uint `json:"id" gorm:"primaryKey"`
	LoanID uint `json:"loanId" gorm:"not null;index"`
	Loan   Loan `json:"loan" gorm:"foreignKey:LoanID"`

	Type        string `json:"type" gorm:"not null;size:20"`   // "Extension" | "Release"
	Status      string `json:"status" gorm:"not null;size:20"` // "Pending" | "Approved" | "Rejected"
	RequestedBy string `json:"requestedBy" gorm:"not null;size:20"`
	Detail      string `json:"detail" gorm:"size:255"`

	// Amount only applies to Type == Waiver/Adjustment: how much to forgive
	// or correct.
	Amount float64 `json:"amount" gorm:"type:numeric(16,2);default:0"`

	// RequestedExtensionMonths/NewDueDate only apply to Type == Extension.
	RequestedExtensionMonths *int       `json:"requestedExtensionMonths,omitempty"`
	NewDueDate               *time.Time `json:"newDueDate,omitempty"`

	// ApprovalStage applies to both Type == Release (PendingManager ->
	// PendingManagement -> Approved/Rejected, decided via
	// Service.ApproveReleaseRequest) and Type == Extension (PendingLoanOfficer
	// -> PendingBranchManager -> PendingManagement -> Approved/Rejected,
	// decided via Service.ApproveExtensionRequest) — both reuse the same
	// terminal ApprovalStageApproved/ApprovalStageRejected values.
	ApprovalStage string `json:"approvalStage,omitempty" gorm:"size:30"`

	// IsPartial marks a Release request that hands back only SOME of the
	// loan's ornaments (see OrnamentIDs below / LoanRequestOrnament) rather
	// than every ornament and the whole loan. Always computed server-side
	// in CreateReleaseRequest — never client-supplied directly — because
	// selecting every currently-pledged ornament (or omitting the
	// selection entirely) is forced back to a plain full release regardless
	// of what the caller asked for; see CreateReleaseRequest's own comment.
	IsPartial bool `json:"isPartial"`

	// PaymentVerified/PacketVerified/BankPledgeVerified/CustomerConfirmed
	// are the RETIRED 4-item checklist. Left on the model (rather than
	// dropped) only so the one-time migration backfill in
	// migrate_release.go has somewhere to read the pre-existing values
	// from — nothing in Service writes or reads these any more. See
	// CustomerSawGold/PaymentRecorded/Locked below, their replacement.
	PaymentVerified    bool   `json:"paymentVerified"`
	PacketVerified     bool   `json:"packetVerified"`
	BankPledgeVerified bool   `json:"bankPledgeVerified"`
	CustomerConfirmed  bool   `json:"customerConfirmed"`
	VerificationNotes  string `json:"verificationNotes" gorm:"size:255"`

	// CustomerSawGold/PaymentRecorded/Locked are the reworked 2-item
	// release checklist (see VerifyReleaseChecklist):
	//
	//   - CustomerSawGold is a plain staff attestation, settable freely while
	//     the request is Pending and not yet Locked — there is no manual
	//     "packet verified" checkbox any more (dropped along with
	//     PacketVerified above) and no packet-status gate either; the
	//     packet's own stage is tracked and enforced separately in
	//     internal/packet, not duplicated here.
	//   - PaymentRecorded flips true the moment a payment is recorded
	//     against this request via the general RecordPayment path (see
	//     Service.RecordPayment's release-context hook), not through a
	//     separate bespoke payment screen.
	//   - Locked flips true at the same moment as PaymentRecorded and never
	//     clears. While Locked: CustomerSawGold can no longer be changed,
	//     and ApproveReleaseRequest refuses a Rejected action
	//     (ErrRequestLocked) — once real money has moved against the
	//     release, walking it back by simply unchecking a box or rejecting
	//     outright is no longer a safe undo. RecordPayment itself is NOT
	//     blocked by Locked — the later drift/top-up payment (see
	//     ApproveReleaseRequest's ErrDriftPaymentRequired) must still be
	//     postable while the request sits Locked.
	//
	// "No active bank pledge" is deliberately NOT a field here any more
	// either — it stays enforced automatically inside CompleteRelease via
	// pledgeRepo.HasActive, rather than a manual tickbox staff could get
	// out of sync with reality.
	CustomerSawGold bool `json:"customerSawGold"`
	PaymentRecorded bool `json:"paymentRecorded"`
	Locked          bool `json:"locked"`

	// RecordedDiscount/RecordedPayment/PaymentDueDate back the "Record
	// Payment" step on the Manager-stage release review screen (see
	// Service.RecordReleasePayment) — separate from the plain
	// PaymentVerified attestation above. Discount/Payment amounts entered
	// there are posted as real LoanPayment ledger entries (Discount/Partial)
	// and accumulate here just so the review screen can show what has been
	// recorded so far; PaymentDueDate is set only when they fall short of
	// the final settlement, and is what flags an overdue release red on the
	// Requests list once it passes with the balance still outstanding.
	RecordedDiscount float64    `json:"recordedDiscount" gorm:"type:numeric(16,2);default:0"`
	RecordedPayment  float64    `json:"recordedPayment" gorm:"type:numeric(16,2);default:0"`
	PaymentDueDate   *time.Time `json:"paymentDueDate,omitempty"`

	// Charges is a single staff-entered override amount (e.g. statutory/
	// valuation charges), Release only, added into SettlementAmount below.
	Charges float64 `json:"charges" gorm:"type:numeric(16,2);default:0"`

	// ChargesApplied is how much of Charges has already been posted onto
	// the loan itself (as a real LoanPayment, folded into
	// Loan.OutstandingProcessingFee then immediately collected — see
	// Service.RecordReleasePayment). Charges can be edited any number of
	// times before the balance clears (staff correcting the figure via the
	// Charges input's onBlur save); tracking what has already been charged,
	// separately from RecordedDiscount/RecordedPayment above, lets each
	// RecordReleasePayment call post only the DELTA since the last one —
	// never the same charge twice, and never missing a later increase.
	ChargesApplied float64 `json:"chargesApplied" gorm:"type:numeric(16,2);default:0"`

	// SettlementAmount is a snapshot of Loan.TotalOutstandingBalance +
	// Charges taken the moment the release approval chain reaches its final
	// "Approved" — the live figure on Loan keeps moving as payments come in,
	// this freezes what was actually approved for release.
	SettlementAmount float64 `json:"settlementAmount" gorm:"type:numeric(16,2);default:0"`

	Remarks             string     `json:"remarks" gorm:"size:255"`
	RequestedAt         time.Time  `json:"requestedAt" gorm:"not null"`
	DecidedAt           *time.Time `json:"decidedAt,omitempty"`
	DecidedByEmployeeID *uint      `json:"decidedByEmployeeId,omitempty"`

	// OrnamentSelections is the Partial Release's selected-ornament set,
	// loaded via LoanRequestOrnament — see that type's own doc comment for
	// why it is a real join table rather than a JSON column. Empty for
	// every Extension request and for a plain full Release request.
	OrnamentSelections []LoanRequestOrnament `json:"ornamentSelections,omitempty" gorm:"foreignKey:RequestID"`

	CreatedAt time.Time `json:"createdAt"`
	UpdatedAt time.Time `json:"updatedAt"`
}

func (LoanRequest) TableName() string { return "loan_requests" }

// LoanRequestOrnament is one ornament selected for release on a Partial
// Ornament Release request — mirrors RequestApproval being its own table
// (rather than a JSON/comma-separated column) precisely so the selection is
// queryable: CompleteRelease needs "which Ornament rows does this request
// touch" as a real join, not a blob it has to parse.
type LoanRequestOrnament struct {
	platform.TenantScoped
	ID         uint `json:"id" gorm:"primaryKey"`
	RequestID  uint `json:"requestId" gorm:"not null;index"`
	OrnamentID uint `json:"ornamentId" gorm:"not null;index"`

	CreatedAt time.Time `json:"createdAt"`
}

func (LoanRequestOrnament) TableName() string { return "loan_request_ornaments" }

// RequestApproval is the audit trail for a Release LoanRequest's
// Manager→Management approval chain — mirrors LoanApproval exactly, kept as
// a separate table since the subject is a request, not a loan.
type RequestApproval struct {
	platform.TenantScoped
	ID        uint `json:"id" gorm:"primaryKey"`
	RequestID uint `json:"requestId" gorm:"not null;index"`

	Stage           string `json:"stage" gorm:"not null;size:30"`  // "Manager" | "Management"
	Action          string `json:"action" gorm:"not null;size:20"` // "Approved" | "Rejected"
	ActorEmployeeID uint   `json:"actorEmployeeId" gorm:"not null"`
	Remarks         string `json:"remarks" gorm:"size:255"`

	CreatedAt time.Time `json:"createdAt"`
}

func (RequestApproval) TableName() string { return "request_approvals" }
