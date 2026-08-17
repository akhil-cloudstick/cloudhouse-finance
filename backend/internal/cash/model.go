// Package cash implements the Cash-in-Hand & Expenses domain
// (frontend/components/Cash.tsx): cash movements (in/out) and the expense
// register. Two related resources on one frontend page, one Go package —
// same grouping the frontend itself uses.
package cash

import (
	"time"

	"ambikagold/backend/internal/branch"
)

// CashMovement represents one cash-in or cash-out entry. For a cash-in
// sourced from a loan (Source == "Loan"), Status tracks whether that
// loan has since been marked closed (mirrors legacy's
// setCashLoanStatus/toggleCashLoan).
type CashMovement struct {
	ID         uint           `json:"id" gorm:"primaryKey"`
	Type       string         `json:"type" gorm:"not null;size:10"` // "in" | "out"
	Source     string         `json:"source" gorm:"size:20"`        // "Savings" | "Loan" — only for type=in
	Purpose    string         `json:"purpose" gorm:"size:120"`      // only for type=out
	Bank       string         `json:"bank" gorm:"size:120"`
	Amount     float64        `json:"amount" gorm:"not null;type:numeric(16,2)"`
	Status     string         `json:"status" gorm:"size:20"` // "Open" | "Closed" — only for loan-sourced cash-in
	BranchID   *uint          `json:"branchId"`              // nullable — not every cash movement is tied to a till yet
	Branch     *branch.Branch `json:"branch,omitempty" gorm:"foreignKey:BranchID"`
	OccurredOn time.Time      `json:"occurredOn" gorm:"not null"`
	CreatedAt  time.Time      `json:"createdAt"`
}

func (CashMovement) TableName() string {
	return "cash_movements"
}

// Expense represents one expense-register entry.
type Expense struct {
	ID           uint          `json:"id" gorm:"primaryKey"`
	OccurredOn   time.Time     `json:"occurredOn" gorm:"not null"`
	Category     string        `json:"category" gorm:"not null;size:80"`
	Amount       float64       `json:"amount" gorm:"not null;type:numeric(16,2)"`
	Mode         string        `json:"mode" gorm:"not null;size:20"`
	Payee        string        `json:"payee" gorm:"not null;size:120"`
	BranchID     uint          `json:"branchId" gorm:"not null"`
	Branch       branch.Branch `json:"branch" gorm:"foreignKey:BranchID"`
	Status       string        `json:"status" gorm:"not null;size:20;default:Pending"` // "Pending" | "Approved" | "Rejected"
	Remarks      string        `json:"remarks" gorm:"size:500"`
	ApprovedBy   *string       `json:"approvedBy,omitempty" gorm:"size:120"`
	ApprovedAt   *time.Time    `json:"approvedAt,omitempty"`
	ReceiptImage string        `json:"receiptImage,omitempty" gorm:"type:text"` // /uploads/... URL from the upload module (see internal/upload)
	CreatedAt    time.Time     `json:"createdAt"`
}

func (Expense) TableName() string {
	return "expenses"
}

// OpeningCashBalance records the opening cash-in-hand figure entered by
// authorized staff at the start of a day, per branch. One row per
// (branch, date) — see OpeningBalanceRepository.Upsert.
type OpeningCashBalance struct {
	ID          uint          `json:"id" gorm:"primaryKey"`
	BranchID    uint          `json:"branchId" gorm:"not null;uniqueIndex:idx_branch_date"`
	Branch      branch.Branch `json:"branch" gorm:"foreignKey:BranchID"`
	BalanceDate time.Time     `json:"balanceDate" gorm:"not null;uniqueIndex:idx_branch_date"`
	Amount      float64       `json:"amount" gorm:"not null;type:numeric(16,2)"`
	CreatedAt   time.Time     `json:"createdAt"`

	// IsSet distinguishes "staff entered an opening balance for this
	// branch/day" from "no entry yet", which Amount alone cannot: a real
	// entry of 0 and a missing entry both read as 0 (Get synthesizes a
	// zero-amount record rather than 404ing). Response-only, never stored.
	IsSet bool `json:"isSet" gorm:"-"`
}

func (OpeningCashBalance) TableName() string {
	return "opening_cash_balances"
}
