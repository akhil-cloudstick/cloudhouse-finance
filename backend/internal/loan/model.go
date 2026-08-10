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

// Approval-stage values driving the fixed 3-step sanction chain. No
// role/authority-limit enforcement exists yet (deferred to a future
// access-control middleware) — any employeeId can advance any stage today;
// LoanApproval rows exist so that check can be added later without a schema
// change.
const (
	ApprovalStagePendingManager    = "PendingManager"
	ApprovalStagePendingManagement = "PendingManagement"
	ApprovalStageApproved          = "Approved"
	ApprovalStageRejected          = "Rejected"
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
	PrincipalAmount   float64 `json:"principalAmount" gorm:"not null"`
	OutstandingAmount float64 `json:"outstandingAmount" gorm:"not null"`

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
	Purity string `json:"purity" gorm:"not null;size:10"` // "24K" | "22K" | "18K"

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

	TestedPurity          string    `json:"testedPurity" gorm:"not null;size:10"`
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

// LoanApproval is the audit trail for the fixed 3-step sanction chain.
// ActorEmployeeID is passed explicitly by the caller (no auth/session
// exists) — see the "no authority-limit enforcement yet" note above.
type LoanApproval struct {
	ID     uint `json:"id" gorm:"primaryKey"`
	LoanID uint `json:"loanId" gorm:"not null;index"`

	Stage           string `json:"stage" gorm:"not null;size:30"`  // "Manager" | "Management"
	Action          string `json:"action" gorm:"not null;size:20"` // "Approved" | "Rejected"
	ActorEmployeeID uint   `json:"actorEmployeeId" gorm:"not null"`
	Remarks         string `json:"remarks" gorm:"size:255"`

	CreatedAt time.Time `json:"createdAt"`
}

func (LoanApproval) TableName() string { return "loan_approvals" }

// LoanPayment is a lightweight audit record of one payment received
// against a loan (interest, principal, partial, or full settlement).
type LoanPayment struct {
	ID     uint `json:"id" gorm:"primaryKey"`
	LoanID uint `json:"loanId" gorm:"not null;index"`

	Amount               float64   `json:"amount" gorm:"not null"`
	Type                 string    `json:"type" gorm:"not null;size:30"` // "Interest" | "Principal" | "Partial" | "Full Settlement"
	PaidOn               time.Time `json:"paidOn" gorm:"not null"`
	ReceivedByEmployeeID uint      `json:"receivedByEmployeeId" gorm:"not null"`

	CreatedAt time.Time `json:"createdAt"`
}

func (LoanPayment) TableName() string { return "loan_payments" }

// BankPledgeRecord is a lightweight audit record of a loan (or batch of
// loans, tracked one row per loan) being pledged to / released from a bank.
type BankPledgeRecord struct {
	ID     uint `json:"id" gorm:"primaryKey"`
	LoanID uint `json:"loanId" gorm:"not null;index"`

	BankName      string     `json:"bankName" gorm:"not null;size:120"`
	PledgedAmount float64    `json:"pledgedAmount" gorm:"not null"`
	PledgeDate    time.Time  `json:"pledgeDate" gorm:"not null"`
	ReleaseDate   *time.Time `json:"releaseDate"`

	CreatedAt time.Time `json:"createdAt"`
}

func (BankPledgeRecord) TableName() string { return "bank_pledge_records" }
