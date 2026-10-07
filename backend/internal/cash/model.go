// Package cash implements the Cash-in-Hand & Expenses domain
// (frontend/components/Cash.tsx): cash movements (in/out) and the expense
// register. Two related resources on one frontend page, one Go package —
// same grouping the frontend itself uses.
package cash

import (
	"time"

	"cloudhouse/backend/internal/bank"
	"cloudhouse/backend/internal/branch"
	"cloudhouse/backend/internal/customer"
	"cloudhouse/backend/internal/platform"
)

// CashMovement represents one cash-in or cash-out entry. For a cash-in
// sourced from a loan (Source == "Loan"), Status tracks whether that
// loan has since been marked closed (mirrors legacy's
// setCashLoanStatus/toggleCashLoan).
type CashMovement struct {
	platform.TenantScoped
	ID      uint   `json:"id" gorm:"primaryKey"`
	Type    string `json:"type" gorm:"not null;size:10"` // "in" | "out"
	Source  string `json:"source" gorm:"size:60"`        // a CashSource name ("Savings", "Loan HDFC 4471", …) — only for type=in
	Purpose string `json:"purpose" gorm:"size:120"`      // only for type=out
	// Mode is how the cash physically arrived — "Cash" | "UPI" | "Bank
	// Transfer" (same free-text convention as Expense.Mode) — required for
	// type=in via AddCashModal.tsx; left blank for cash-out and any other
	// movement that doesn't record one.
	Mode string `json:"mode" gorm:"size:20"`
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

	// TransactionGroupID (renamed from an earlier "GroupRef" naming) groups
	// several CashMovement rows that together make up one logical split
	// payment — e.g. a single ₹10,000 collection paid ₹6,000 cash + ₹4,000
	// UPI becomes two rows sharing one TransactionGroupID (a UUID generated
	// once per payment/disbursement call). Deliberately a plain string, not
	// a hard FK to another table — it identifies a logical event, not a row.
	// Nullable/blank for older rows and for any movement that was never
	// split (still exactly one row, just with no group to speak of).
	TransactionGroupID string `json:"transactionGroupId" gorm:"size:40;index"`

	// BankID is the real, queryable bank identity behind this movement — the
	// free-text Bank field above is kept for display/back-compat, BankID is
	// the FK the Party Transactions ledger (bank drill-down) actually
	// queries against. Nullable: not every movement has a bank (plain cash
	// has none), and historical rows are only linked by a one-time backfill.
	BankID  *uint      `json:"bankId"`
	BankRef *bank.Bank `json:"bankRef,omitempty" gorm:"foreignKey:BankID"`

	// ToBankID is the destination account for a bank-to-bank transfer — the
	// branch's own account that received the money BankID/Bank moved from
	// (AddCashModal.tsx's "To Bank", offered alongside the existing "From
	// Bank" picker when Mode is UPI/Bank Transfer). Nullable: most movements
	// (plain cash, a single-bank UPI/transfer with no internal destination
	// recorded) have none.
	ToBankID  *uint      `json:"toBankId"`
	ToBankRef *bank.Bank `json:"toBankRef,omitempty" gorm:"foreignKey:ToBankID"`

	// CounterBankID is the other side of a self transfer — on the debit row the
	// bank it went to, on the credit row the bank it came from — so the ledger
	// can show "from → to" on either row. Display only: unlike ToBankID it never
	// changes how bank balances are summed.
	CounterBankID  *uint      `json:"counterBankId"`
	CounterBankRef *bank.Bank `json:"counterBankRef,omitempty" gorm:"foreignKey:CounterBankID"`

	// PartyCustomerID links this movement to the customer it was actually
	// collected from/paid to, when the recorder call already has one in
	// hand (a loan/personal-loan/investment payment always does — the
	// recorder functions just weren't threading CustomerID through before).
	// Nullable: an expense-style cash-out or a movement with no customer
	// party has none.
	PartyCustomerID *uint              `json:"partyCustomerId"`
	PartyCustomer   *customer.Customer `json:"partyCustomer,omitempty" gorm:"foreignKey:PartyCustomerID"`

	// ExpenseID links a cash-out row to the Expense it was booked for (see
	// MovementService.RecordExpenseCashOut, called from ExpenseService.
	// Approve). Nullable — most movements have no expense behind them.
	// Rows with this set are excluded from Summary's Disbursements sum
	// (MovementRepository.SumByTypeAndDate/SumBreakdownByDate) since the
	// expense is already counted there via ExpenseRepository.SumCashByDate/
	// SumAllByDate — this column exists purely to make the expense visible
	// in the Cash Movements ledger table without double-counting it.
	ExpenseID *uint `json:"expenseId"`

	// ReceiptImage is the bill attached to a manual Add Cash / Self Transfer
	// entry (an /uploads/... URL, see internal/upload) — same as Expense.ReceiptImage.
	ReceiptImage string `json:"receiptImage,omitempty" gorm:"type:text"`

	CreatedAt time.Time `json:"createdAt"`
}

func (CashMovement) TableName() string {
	return "cash_movements"
}

// Expense represents one expense-register entry.
type Expense struct {
	platform.TenantScoped
	ID         uint      `json:"id" gorm:"primaryKey"`
	OccurredOn time.Time `json:"occurredOn" gorm:"not null"`
	Category   string    `json:"category" gorm:"not null;size:80"`
	Amount     float64   `json:"amount" gorm:"not null;type:numeric(16,2)"`
	Mode       string    `json:"mode" gorm:"not null;size:20"`
	Payee      string    `json:"payee" gorm:"not null;size:120"`
	// FromBankID/ToBankID record an internal transfer between two of the
	// branch's own bank accounts when this expense's Mode is UPI/Bank —
	// ExpenseModal.tsx's "From Bank"/"To Bank" pickers. Nullable: a Cash-mode
	// expense has neither.
	FromBankID *uint         `json:"fromBankId"`
	FromBank   *bank.Bank    `json:"fromBank,omitempty" gorm:"foreignKey:FromBankID"`
	ToBankID   *uint         `json:"toBankId"`
	ToBank     *bank.Bank    `json:"toBank,omitempty" gorm:"foreignKey:ToBankID"`
	BranchID   uint          `json:"branchId" gorm:"not null"`
	Branch     branch.Branch `json:"branch" gorm:"foreignKey:BranchID"`
	Status     string        `json:"status" gorm:"not null;size:20;default:Pending"` // "Pending" | "Approved" | "Rejected"
	// ApprovalStage is the approval-chain stage a Pending expense waits at
	// (workflow.FlowExpense, e.g. "R4"). Empty on rows from before the
	// chain was configurable — they wait at its first step.
	ApprovalStage string     `json:"approvalStage" gorm:"size:40"`
	Remarks       string     `json:"remarks" gorm:"size:500"`
	ApprovedBy    *string    `json:"approvedBy,omitempty" gorm:"size:120"`
	ApprovedAt    *time.Time `json:"approvedAt,omitempty"`
	ReceiptImage  string     `json:"receiptImage,omitempty" gorm:"type:text"` // /uploads/... URL from the upload module (see internal/upload)
	// CashMovementID is set once this expense is Approved (see
	// ExpenseService.Approve / MovementService.RecordExpenseCashOut) — the
	// cash-out row that made this expense visible in the Cash Movements
	// ledger table. Nil for Pending/Rejected expenses, which never move cash.
	CashMovementID *uint     `json:"cashMovementId,omitempty"`
	CreatedAt      time.Time `json:"createdAt"`
}

func (Expense) TableName() string {
	return "expenses"
}

// OpeningCashBalance records an opening balance entered by authorized staff
// at the start of a day, per branch and payment mode. Mode "Cash" is the
// till's cash in hand (the only one Summary/ExpectedCash uses); UPI/Bank
// Transfer/Cheque rows are the opening balance of one of the branch's bank
// accounts, so they carry a BankID. One row per (branch, date, mode, bank) —
// unique index created in EnsureOpeningBalanceModeIndex, not a struct tag,
// because it needs COALESCE(bank_id, 0) so Cash rows (no bank) still collide.
// BankID is the "to" bank — the account the balance sits in, and the one the
// row is keyed on; FromBankID records the bank the funds came from.
type OpeningCashBalance struct {
	platform.TenantScoped
	ID          uint          `json:"id" gorm:"primaryKey"`
	BranchID    uint          `json:"branchId" gorm:"not null;index"`
	Branch      branch.Branch `json:"branch" gorm:"foreignKey:BranchID"`
	BalanceDate time.Time     `json:"balanceDate" gorm:"not null;index"`
	Mode        string        `json:"mode" gorm:"not null;size:20;default:Cash"`
	BankID      *uint         `json:"bankId"`
	Bank        *bank.Bank    `json:"bank,omitempty" gorm:"foreignKey:BankID"`
	FromBankID  *uint         `json:"fromBankId"`
	FromBank    *bank.Bank    `json:"fromBank,omitempty" gorm:"foreignKey:FromBankID"`
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

	OrnamentType string  `json:"ornamentType" gorm:"not null;size:80"`
	SoldAmount   float64 `json:"soldAmount" gorm:"not null;type:numeric(16,2)"`
	CostAmount   float64 `json:"costAmount" gorm:"not null;type:numeric(16,2)"`
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

	// Mode is how the sale proceeds were received — Cash/UPI/Bank Transfer,
	// same vocabulary as CashMovement.Mode. Defaults to "Cash" for legacy
	// rows and any sale that doesn't set it explicitly, matching the
	// implicit cash-only behavior this field replaces.
	Mode string `json:"mode" gorm:"not null;size:20;default:Cash"`
	// BankID is which bank UPI/Bank Transfer proceeds landed in — mirrors
	// CashMovement.BankID/BankRef. Nil for a Cash sale.
	BankID  *uint      `json:"bankId"`
	BankRef *bank.Bank `json:"bankRef,omitempty" gorm:"foreignKey:BankID"`

	Remarks string `json:"remarks" gorm:"size:500"`
	// ReceiptImage is the bill attached to the sale (/uploads/... URL).
	ReceiptImage string    `json:"receiptImage,omitempty" gorm:"type:text"`
	CreatedAt    time.Time `json:"createdAt"`
}

func (GoldSale) TableName() string {
	return "gold_sales"
}

// Category types — which entry form a Category belongs to. A Category with
// IsCommon set is offered on all three forms regardless of its Type.
const (
	CategoryCashIn       = "cash_in"       // Credit — "Add Cash" sources (Savings, Loan …)
	CategoryExpense      = "expense"       // Debit — expense categories (Rent, Salaries …)
	CategorySelfTransfer = "self_transfer" // Self Transfer — "Bank to Bank"
)

// Category is the single list behind the Ledger's Add Entry modal: cash-in
// sources, expense categories and self-transfer categories are rows of this
// one table, told apart by Type. Staff add new ones on the fly from each
// form's picker (find-or-create by name, case-insensitive). When a name that
// already exists under another Type is added, the existing row is flipped to
// IsCommon instead of duplicating it — a common category shows up on every
// form. A name is unique per tenant.
//
// CashMovement.Source / Expense.Category keep storing the resolved name as
// free text (no FK), so this list doesn't change how an entry is read.
//
// A cash-in category whose name starts with "Loan" (see IsLoanSource) is one
// bank loan: BankID/LoanNumber/PrincipalAmount are captured on its first Add
// Cash entry and reused by every later one (PrincipalAmount != nil marks the
// details as captured). Loans are always common — drawn from on Credit,
// repaid on Debit, and a Self Transfer category. The loan's balance starts at
// the principal, drops with each Add Cash under it and climbs back with each
// approved expense / self transfer in the same name — see loanBalance.
type Category struct {
	platform.TenantScoped
	ID       uint   `json:"id" gorm:"primaryKey"`
	Type     string `json:"type" gorm:"not null;size:20;index;default:cash_in"`
	Name     string `json:"name" gorm:"index;not null;size:80"`
	IsCommon bool   `json:"isCommon" gorm:"not null;default:false"`

	BankID          *uint      `json:"bankId,omitempty"`
	Bank            *bank.Bank `json:"bank,omitempty" gorm:"foreignKey:BankID"`
	LoanNumber      string     `json:"loanNumber,omitempty" gorm:"size:60"`
	PrincipalAmount *float64   `json:"principalAmount,omitempty" gorm:"type:numeric(16,2)"`
	// LoanOpenedAt is when the details were captured — only movements and
	// repayments created from then on count toward the loan's balance, so
	// older entries under a reused name (e.g. the seeded "Loan") don't.
	LoanOpenedAt *time.Time `json:"loanOpenedAt,omitempty"`
	CreatedAt    time.Time  `json:"createdAt"`
}

// HasLoanDetails reports whether this loan category's bank/number/principal
// were already captured on an earlier Add Cash entry.
func (s *Category) HasLoanDetails() bool {
	return s.PrincipalAmount != nil && s.BankID != nil
}

func (Category) TableName() string {
	return "categories"
}

// CashSource / ExpenseCategory are the cash-in and expense views of Category —
// the same row type, kept as names so the two pickers' code reads as before.
type (
	CashSource      = Category
	ExpenseCategory = Category
)

// LoanCashSource captures the loan-specific details staff enter on
// AddCashModal.tsx when Source is "Loan" — which bank the loan itself came
// from, its loan number, principal, and (optionally) interest rate/
// duration. One row per CashMovement (Type "in", Source "Loan"); nothing
// else reads or writes this table, so a bare FK back to the movement is
// enough — no reverse pointer needed on CashMovement itself.
type LoanCashSource struct {
	platform.TenantScoped
	ID              uint       `json:"id" gorm:"primaryKey"`
	CashMovementID  uint       `json:"cashMovementId" gorm:"not null;index"`
	BankID          uint       `json:"bankId" gorm:"not null"`
	Bank            *bank.Bank `json:"bank,omitempty" gorm:"foreignKey:BankID"`
	LoanNumber      string     `json:"loanNumber" gorm:"not null;size:60"`
	PrincipalAmount float64    `json:"principalAmount" gorm:"not null;type:numeric(16,2)"`
	// InterestRate/DurationMonths are optional — staff may not always know
	// or want to record them at cash-entry time.
	InterestRate   *float64  `json:"interestRate" gorm:"type:numeric(6,2)"`
	DurationMonths *int      `json:"durationMonths"`
	CreatedAt      time.Time `json:"createdAt"`
}

func (LoanCashSource) TableName() string {
	return "loan_cash_sources"
}
