// Package reminder implements the Reminder Calendar
// (frontend/components/Calendar.tsx, Dashboard.tsx's "Upcoming Reminders"):
// a manually-logged Customer Follow-Up / Promise-to-Pay / Custom reminder,
// plus a read-only aggregation endpoint that merges those manual rows with
// events derived live from loan.Loan/loan.AuctionRecord (loan due dates,
// overdue loans, a scheduled auction date, and a monthly "interest payment"
// reminder on each open loan's opened-date anniversary — see service.go's
// GetCalendarEvents). Only the manual rows are persisted here; due-date/
// overdue/interest/auction events are computed fresh on every request from
// internal/loan, never duplicated into this table.
package reminder

import (
	"time"

	"gorm.io/gorm"

	"cloudhouse/backend/internal/customer"
	"cloudhouse/backend/internal/platform"
)

// Reminder type values.
const (
	TypeFollowUp     = "Follow-Up"
	TypePromiseToPay = "Promise-to-Pay"
	TypeCustom       = "Custom"
)

// Reminder status values.
const (
	StatusPending   = "Pending"
	StatusDone      = "Done"
	StatusCancelled = "Cancelled"
)

// Reminder is a manually-logged calendar entry — a Customer Follow-Up, a
// Promise-to-Pay date, or a free-form Custom reminder. Optionally tied to a
// specific loan (e.g. "follow up on GL-1004's overdue balance"), but always
// tied to a customer.
type Reminder struct {
	platform.TenantScoped
	ID uint `json:"id" gorm:"primaryKey"`

	CustomerID uint              `json:"customerId" gorm:"not null;index"`
	Customer   customer.Customer `json:"customer" gorm:"foreignKey:CustomerID"`

	// LoanID is optional — a reminder can be about a customer in general
	// (e.g. a KYC follow-up) with no specific loan attached.
	LoanID *uint `json:"loanId,omitempty" gorm:"index"`

	Type    string    `json:"type" gorm:"not null;size:20"` // Follow-Up | Promise-to-Pay | Custom
	DueDate time.Time `json:"dueDate" gorm:"not null;index"`
	Note    string    `json:"note" gorm:"size:255"`
	Status  string    `json:"status" gorm:"not null;size:20;default:'Pending'"`

	CreatedByEmployeeID uint `json:"createdByEmployeeId" gorm:"not null"`

	CreatedAt time.Time      `json:"createdAt"`
	UpdatedAt time.Time      `json:"updatedAt"`
	DeletedAt gorm.DeletedAt `json:"-" gorm:"index"`
}

func (Reminder) TableName() string { return "reminders" }

// CalendarEvent is the unified, read-only shape returned by GET
// /reminders/calendar — one row per event on the calendar, whether it comes
// from a persisted Reminder or is computed live from loan.Loan/
// loan.AuctionRecord. Type distinguishes the seven categories: InterestDue,
// LoanDue, Overdue, AuctionScheduled, FollowUp, PromiseToPay, Custom.
type CalendarEvent struct {
	Date   string `json:"date"` // "YYYY-MM-DD"
	Type   string `json:"type"` // InterestDue | LoanDue | Overdue | PersonalLoanDue | PersonalLoanOverdue | AuctionScheduled | FollowUp | PromiseToPay | Custom
	Title  string `json:"title"`
	Detail string `json:"detail"`

	LoanID     *uint  `json:"loanId,omitempty"`
	LoanNumber string `json:"loanNumber,omitempty"`

	// PersonalLoanID is set instead of LoanID for PersonalLoanDue/
	// PersonalLoanOverdue events — kept separate (not reusing LoanID) so the
	// frontend never mistakes a personal loan's numeric ID for a gold loan's
	// and links `#loan/...` when it means `#personalloan/...`.
	PersonalLoanID *uint `json:"personalLoanId,omitempty"`

	CustomerID   *uint  `json:"customerId,omitempty"`
	CustomerName string `json:"customerName,omitempty"`

	// ReminderID/Status are only set for manual (persisted) events — lets
	// the frontend offer edit/complete actions on those specifically.
	ReminderID *uint  `json:"reminderId,omitempty"`
	Status     string `json:"status,omitempty"`
}
