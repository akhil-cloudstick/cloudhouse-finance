package loan

import (
	"cloudhouse/backend/internal/platform"
	"time"
)

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
	platform.TenantScoped
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
	platform.TenantScoped
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
	platform.TenantScoped
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
	platform.TenantScoped
	ID              uint      `json:"id" gorm:"primaryKey"`
	AuctionRecordID uint      `json:"auctionRecordId" gorm:"not null;index"`
	IssuedAt        time.Time `json:"issuedAt" gorm:"not null"`
	Method          string    `json:"method" gorm:"size:40"` // "WhatsApp" today — see auctionNoticeChannels in service.go
	Remarks         string    `json:"remarks" gorm:"size:255"`
	CreatedAt       time.Time `json:"createdAt"`
}

func (AuctionNotice) TableName() string { return "auction_notices" }
