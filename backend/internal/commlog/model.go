// Package commlog logs every outbound customer communication (currently
// WhatsApp only — SMS/Email have no live gateway) so the Reports module's
// Communication History report has something real to read from. It has no
// handler/routes of its own: it's a plain internal package written to by
// loan/reminder/auth at each send site, and read by internal/reports.
package commlog

import "time"

// Trigger-type values for CommunicationLog.TriggerType — what prompted the
// message to be sent. Kept as plain strings (matching this codebase's
// existing status-value convention) rather than a typed enum.
const (
	TriggerLoanSubmission = "loan_submission"
	TriggerLoanApproval   = "loan_approval" // an intermediate sanction-chain stage decision (approved-not-final, or rejected) — TriggerLoanSanction remains the final-disbursement event
	TriggerLoanSanction   = "loan_sanction"
	TriggerPayment        = "payment"
	TriggerClosure        = "closure"
	TriggerAuctionNotice  = "auction_notice"
	TriggerAuctionEvent   = "auction_event"
	TriggerReminder       = "reminder"
	TriggerOTP            = "otp"
	// TriggerLoanDueSoon/TriggerLoanOverdue back the new scheduled due/
	// overdue check (see internal/loan/service.go's CheckDueAndOverdueLoans).
	TriggerLoanDueSoon = "loan_due_soon"
	TriggerLoanOverdue = "loan_overdue"
	// TriggerExtensionRequest/TriggerReleaseRequest cover every stage
	// decision (approved-not-final, final approved, or rejected) on an
	// Extension/Release request's approval chain.
	TriggerExtensionRequest = "extension_request"
	TriggerReleaseRequest   = "release_request"
)

// Channel values for CommunicationLog.Channel.
const (
	ChannelWhatsApp = "WhatsApp"
)

// Status values for CommunicationLog.Status.
const (
	StatusSent   = "sent"
	StatusFailed = "failed"
)

// CommunicationLog is one outbound message attempt — recorded whether it
// succeeded or failed, so the Communication History report can show
// delivery failures too, not just successes.
type CommunicationLog struct {
	ID uint `json:"id" gorm:"primaryKey"`

	RecipientName  string `json:"recipientName" gorm:"size:120"`
	RecipientPhone string `json:"recipientPhone" gorm:"size:20;index"`
	// ChatID is the normalized phone/identifier actually used by the
	// transport (see platform.OpenWASender) — kept alongside
	// RecipientPhone in case the two ever diverge (e.g. country-code
	// normalization).
	ChatID string `json:"chatId" gorm:"size:32"`

	Channel     string `json:"channel" gorm:"not null;size:20;index"` // e.g. "WhatsApp"
	TriggerType string `json:"triggerType" gorm:"not null;size:30;index"`

	MessageBody string `json:"messageBody" gorm:"type:text"`

	// RelatedEntityType/RelatedEntityID point at whatever domain record
	// this message was about (e.g. "loan"/123, "reminder"/45,
	// "employee"/7 for an OTP) — a loose, un-enforced polymorphic
	// reference, mirroring how AuctionEvent/BankPledgeEvent etc. keep
	// their own lightweight audit trails without a generic audit-log
	// facility.
	RelatedEntityType string `json:"relatedEntityType" gorm:"size:30;index"`
	RelatedEntityID   uint   `json:"relatedEntityId" gorm:"index"`

	Status       string `json:"status" gorm:"not null;size:10"` // "sent" | "failed"
	ErrorMessage string `json:"errorMessage,omitempty" gorm:"size:500"`

	// TriggeredByEmployeeID is nil for self-triggered sends (e.g. an OTP
	// the employee requested for themselves) or system-triggered ones —
	// non-nil whenever a specific staff action fired the message.
	TriggeredByEmployeeID *uint `json:"triggeredByEmployeeId,omitempty" gorm:"index"`

	CreatedAt time.Time `json:"createdAt" gorm:"index"`
}

func (CommunicationLog) TableName() string { return "communication_logs" }
