// Package cash implements the Cash-in-Hand & Expenses domain
// (frontend/components/Cash.tsx): cash movements (in/out) and the expense
// register. Two related resources on one frontend page, one Go package —
// same grouping the frontend itself uses.
package cash

import (
	"time"

	"cloudhouse/backend/internal/branch"
	"cloudhouse/backend/internal/platform"
)

// CashMovement represents one cash-in or cash-out entry. For a cash-in
// sourced from a loan (Source == "Loan"), Status tracks whether that
// loan has since been marked closed (mirrors legacy's
// setCashLoanStatus/toggleCashLoan).
type CashMovement struct {
	platform.TenantScoped
	ID         uint           `json:"id" gorm:"primaryKey"`
	Type       string         `json:"type" gorm:"not null;size:10"` // "in" | "out"
	Source     string         `json:"source" gorm:"size:20"`        // "Savings" | "Loan" — only for type=in
	Purpose    string         `json:"purpose" gorm:"size:120"`      // only for type=out
	// Mode is how the cash physically arrived — "Cash" | "UPI" | "Bank
	// Transfer" (same free-text convention as Expense.Mode) — required for
	// type=in via AddCashModal.tsx; left blank for cash-out and any other
	// movement that doesn't record one.
	Mode       string         `json:"mode" gorm:"size:20"`
	// Bank names which bank the cash came from — required when Source is
	// "Loan" (regardless of Mode) or when Mode is "UPI"/"Bank Transfer"
	// (regardless of Source): both cases mean the cash didn't just appear as
	// physical notes, so there's a bank of record behind it.
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
	platform.TenantScoped
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
	platform.TenantScoped
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

// GoldSale records the business selling gold it owns (bought stock, NOT a
// customer's pledged loan collateral — that goes through the Auction
// module instead). One row per sale: what was sold, what it cost the
// business to acquire (staff-entered at sale time — no separate purchase-
// inventory tracking exists yet), what it sold for, and the resulting
// profit/loss, computed once and stored rather than left to be
// recalculated (and potentially drift) on every read.
//
// Every sale also books TWO matching CashMovements — see
// MovementService.RecordGoldSaleCashIn/RecordGoldSaleCashOut — so both
// sides of the transaction are reflected in Cash-in-Hand/Expected Cash the
// same way a loan repayment or auction proceeds are, without a special
// case in the summary math:
//   - a cash-IN (Source "GoldSale") for SoldAmount — CashMovementID links
//     back to it.
//   - a cash-OUT (Purpose "Gold purchase cost — <ornamentType>") for
//     CostAmount — what the acquisition actually cost the till — booked
//     only when CostAmount > 0 (a cost of 0 genuinely moved no cash, so
//     nothing is booked); CostCashMovementID links back to it.
type GoldSale struct {
	platform.TenantScoped
	ID uint `json:"id" gorm:"primaryKey"`

	OrnamentType string    `json:"ornamentType" gorm:"not null;size:80"`
	SoldAmount   float64   `json:"soldAmount" gorm:"not null;type:numeric(16,2)"`
	CostAmount   float64   `json:"costAmount" gorm:"not null;type:numeric(16,2)"`
	// Profit is SoldAmount − CostAmount, computed at write time — negative
	// on a loss-making sale, not clamped to zero.
	Profit float64   `json:"profit" gorm:"not null;type:numeric(16,2)"`
	SoldOn time.Time `json:"soldOn" gorm:"not null"`

	BranchID uint          `json:"branchId" gorm:"not null"`
	Branch   branch.Branch `json:"branch" gorm:"foreignKey:BranchID"`

	// CashMovementID is the matching Cash Movements row this sale booked —
	// nullable only so a legacy/manually-fixed row is never blocked by a
	// FK, not because a normal sale can lack one.
	CashMovementID *uint         `json:"cashMovementId"`
	CashMovement   *CashMovement `json:"-" gorm:"foreignKey:CashMovementID"`

	// CostCashMovementID is the matching cash-OUT row for CostAmount — nil
	// when CostAmount is 0 (nothing to book) or for a legacy sale recorded
	// before this existed.
	CostCashMovementID *uint         `json:"costCashMovementId"`
	CostCashMovement   *CashMovement `json:"-" gorm:"foreignKey:CostCashMovementID"`

	Remarks   string    `json:"remarks" gorm:"size:500"`
	CreatedAt time.Time `json:"createdAt"`
}

func (GoldSale) TableName() string {
	return "gold_sales"
}
