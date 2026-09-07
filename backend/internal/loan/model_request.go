package loan

import (
	"ambikagold/backend/internal/platform"
	"time"
)

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
