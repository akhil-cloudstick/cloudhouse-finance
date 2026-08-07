// Package cash implements the Cash-in-Hand & Expenses domain
// (frontend/components/Cash.tsx): cash movements (in/out) and the expense
// register. Two related resources on one frontend page, one Go package —
// same grouping the frontend itself uses.
package cash

import "time"

// CashMovement represents one cash-in or cash-out entry. For a cash-in
// sourced from a loan (Source == "Loan"), Status tracks whether that
// loan has since been marked closed (mirrors legacy's
// setCashLoanStatus/toggleCashLoan).
type CashMovement struct {
	ID         uint      `json:"id" gorm:"primaryKey"`
	Type       string    `json:"type" gorm:"not null;size:10"` // "in" | "out"
	Source     string    `json:"source" gorm:"size:20"`        // "Savings" | "Loan" — only for type=in
	Purpose    string    `json:"purpose" gorm:"size:120"`      // only for type=out
	Bank       string    `json:"bank" gorm:"size:120"`
	Amount     float64   `json:"amount" gorm:"not null"`
	Status     string    `json:"status" gorm:"size:20"` // "Open" | "Closed" — only for loan-sourced cash-in
	OccurredOn time.Time `json:"occurredOn" gorm:"not null"`
	CreatedAt  time.Time `json:"createdAt"`
}

func (CashMovement) TableName() string {
	return "cash_movements"
}

// Expense represents one expense-register entry.
type Expense struct {
	ID           uint      `json:"id" gorm:"primaryKey"`
	OccurredOn   time.Time `json:"occurredOn" gorm:"not null"`
	Category     string    `json:"category" gorm:"not null;size:80"`
	Amount       float64   `json:"amount" gorm:"not null"`
	Mode         string    `json:"mode" gorm:"not null;size:20"`
	Payee        string    `json:"payee" gorm:"not null;size:120"`
	Branch       string    `json:"branch" gorm:"not null;size:80"`
	Status       string    `json:"status" gorm:"not null;size:20;default:Pending"`
	ReceiptImage string    `json:"receiptImage,omitempty" gorm:"type:text"` // base64 data URL; see architecture.md's File Uploads note — no object storage wired yet
	CreatedAt    time.Time `json:"createdAt"`
}

func (Expense) TableName() string {
	return "expenses"
}
