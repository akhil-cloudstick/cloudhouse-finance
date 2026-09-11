// Package reports implements the management-only Reports module
// (frontend/components/Reports.tsx): 15 server-side aggregation endpoints
// covering loans, gold/packets, bank pledge, auctions, cash, KYC, gold
// rates, employee performance, and WhatsApp communication history, each
// with a matching xlsx/pdf export. Access is gated by "can view report" —
// by default granted only to Administrator/Management/Branch Manager/
// Auditor (see internal/authz.Restrictions), editable per role from the
// permissions admin screen.
//
// Unlike most other packages in this codebase, reports queries the
// database directly by table name (db.Raw/db.Table) rather than importing
// every domain package's GORM model — the underlying tables (loans,
// ornaments, packets, bank_pledge_records, auction_records, ...) already
// belong to loan/packet/cash/etc.; reports is a pure read-side aggregator
// over them, and pulling in every domain package's model just to re-shape
// its output as a report row would be a lot of import surface for no
// benefit (reports never writes to any of these tables).
package reports

import "time"

// Filter is the common set of query params every report endpoint accepts:
// a date range, an optional single-branch scope (nil = all branches, same
// convention as platform.GetBranchScope elsewhere), and pagination. Export
// endpoints ignore Page/PageSize — a downloaded file must contain every
// matching row, not just the current page.
type Filter struct {
	From     *time.Time
	To       *time.Time
	BranchID *uint
	Page     int
	PageSize int
}

// Paginate applies f's Page/PageSize (both 1-based; PageSize defaults to
// 10, matching the frontend's fixed page size) to a slice already filtered/
// sorted by the caller, returning the requested page and the *pre-slice*
// total row count.
func Paginate[T any](rows []T, f Filter) (page []T, total int) {
	total = len(rows)
	pageSize := f.PageSize
	if pageSize <= 0 {
		pageSize = 10
	}
	page1 := f.Page
	if page1 <= 0 {
		page1 = 1
	}
	start := (page1 - 1) * pageSize
	if start >= total {
		return []T{}, total
	}
	end := start + pageSize
	if end > total {
		end = total
	}
	return rows[start:end], total
}

// Result is the common response envelope every non-export report endpoint
// returns: {"rows": [...], "totals": {...}, "totalCount": N}.
type Result struct {
	Rows       any `json:"rows"`
	Totals     any `json:"totals"`
	TotalCount int `json:"totalCount"`
}

// ---- Row/Totals DTOs, one pair per report family ----

type DisbursementRow struct {
	LoanID       uint      `json:"loanId"`
	LoanNumber   string    `json:"loanNumber"`
	OpenedDate   time.Time `json:"openedDate"`
	Amount       float64   `json:"amount"`
	BranchName   string    `json:"branchName"`
	CustomerName string    `json:"customerName"`
	SchemeName   string    `json:"schemeName"`
}

type DisbursementTotals struct {
	Count       int     `json:"count"`
	TotalAmount float64 `json:"totalAmount"`
}

type LoanStatusRow struct {
	LoanID       uint      `json:"loanId"`
	LoanNumber   string    `json:"loanNumber"`
	CustomerName string    `json:"customerName"`
	BranchName   string    `json:"branchName"`
	Status       string    `json:"status"`
	Outstanding  float64   `json:"outstanding"`
	DueDate      time.Time `json:"dueDate"`
}

type LoanStatusTotals struct {
	Active    int `json:"active"`
	Closed    int `json:"closed"`
	DueSoon   int `json:"dueSoon"`
	Overdue   int `json:"overdue"`
	Defaulted int `json:"defaulted"`
	Other     int `json:"other"`
	Count     int `json:"count"`
}

// ---- Investment reports (internal/investment) ----

type DepositRegisterRow struct {
	InvestmentID     uint      `json:"investmentId"`
	InvestmentNumber string    `json:"investmentNumber"`
	CustomerName     string    `json:"customerName"`
	PlanName         string    `json:"planName"`
	PrincipalAmount  float64   `json:"principalAmount"`
	InterestRate     float64   `json:"interestRate"`
	StartDate        time.Time `json:"startDate"`
	MaturityDate     time.Time `json:"maturityDate"`
	BranchName       string    `json:"branchName"`
	Status           string    `json:"status"`
}

type DepositRegisterTotals struct {
	Count          int     `json:"count"`
	TotalPrincipal float64 `json:"totalPrincipal"`
}

type InterestPayoutRegisterRow struct {
	InvestmentID     uint       `json:"investmentId"`
	InvestmentNumber string     `json:"investmentNumber"`
	CustomerName     string     `json:"customerName"`
	SequenceNo       int        `json:"sequenceNo"`
	DueDate          time.Time  `json:"dueDate"`
	Amount           float64    `json:"amount"`
	Status           string     `json:"status"`
	PaidAt           *time.Time `json:"paidAt"`
}

type InterestPayoutRegisterTotals struct {
	Count        int     `json:"count"`
	TotalDue     float64 `json:"totalDue"`
	TotalPaid    float64 `json:"totalPaid"`
	TotalPending float64 `json:"totalPending"`
}

type MaturityRegisterRow struct {
	InvestmentID     uint      `json:"investmentId"`
	InvestmentNumber string    `json:"investmentNumber"`
	CustomerName     string    `json:"customerName"`
	BranchName       string    `json:"branchName"`
	PrincipalAmount  float64   `json:"principalAmount"`
	MaturityDate     time.Time `json:"maturityDate"`
	Status           string    `json:"status"`
}

type MaturityRegisterTotals struct {
	Active  int `json:"active"`
	Matured int `json:"matured"`
	Closed  int `json:"closed"`
	Renewed int `json:"renewed"`
	Count   int `json:"count"`
}

// InvestorLedgerRow is one investment in a single investor's statement —
// InvestorLedger returns every investment for the requested customer, not
// a date-scoped listing, since it's a detail view rather than a register.
type InvestorLedgerRow struct {
	InvestmentID      uint      `json:"investmentId"`
	InvestmentNumber  string    `json:"investmentNumber"`
	PlanName          string    `json:"planName"`
	PrincipalAmount   float64   `json:"principalAmount"`
	TotalInterestPaid float64   `json:"totalInterestPaid"`
	StartDate         time.Time `json:"startDate"`
	MaturityDate      time.Time `json:"maturityDate"`
	Status            string    `json:"status"`
}

type InvestorLedgerTotals struct {
	Count             int     `json:"count"`
	TotalPrincipal    float64 `json:"totalPrincipal"`
	TotalInterestPaid float64 `json:"totalInterestPaid"`
}

type InterestCollectionRow struct {
	LoanID          uint      `json:"loanId"`
	LoanNumber      string    `json:"loanNumber"`
	PaidOn          time.Time `json:"paidOn"`
	InterestApplied float64   `json:"interestApplied"`
	PenalApplied    float64   `json:"penalApplied"`
	BranchName      string    `json:"branchName"`
}

type InterestCollectionTotals struct {
	TotalInterest float64 `json:"totalInterest"`
	TotalPenal    float64 `json:"totalPenal"`
	Total         float64 `json:"total"`
}

type OutstandingPrincipalRow struct {
	BranchName  string  `json:"branchName"`
	LoanCount   int     `json:"loanCount"`
	Outstanding float64 `json:"outstanding"`
}

type OutstandingPrincipalTotals struct {
	TotalOutstanding float64 `json:"totalOutstanding"`
	TotalLoans       int     `json:"totalLoans"`
}

type PaymentCollectionRow struct {
	PaymentID    uint      `json:"paymentId"`
	LoanNumber   string    `json:"loanNumber"`
	PaidOn       time.Time `json:"paidOn"`
	Amount       float64   `json:"amount"`
	Type         string    `json:"type"`
	BranchName   string    `json:"branchName"`
	EmployeeName string    `json:"employeeName"`
}

type PaymentCollectionTotals struct {
	TotalAmount float64 `json:"totalAmount"`
	Count       int     `json:"count"`
}

type GoldWeightRow struct {
	OrnamentID   uint    `json:"ornamentId"`
	LoanNumber   string  `json:"loanNumber"`
	CustomerName string  `json:"customerName"`
	Name         string  `json:"name"`
	Purity       string  `json:"purity"`
	GrossWeight  float64 `json:"grossWeight"`
	NetWeight    float64 `json:"netWeight"`
	GoldValue    float64 `json:"goldValue"`
}

type GoldWeightTotals struct {
	TotalGrossWeight float64 `json:"totalGrossWeight"`
	TotalNetWeight   float64 `json:"totalNetWeight"`
	TotalGoldValue   float64 `json:"totalGoldValue"`
}

type PacketRow struct {
	PacketID      uint    `json:"packetId"`
	Code          string  `json:"code"`
	LoanNumber    string  `json:"loanNumber"`
	Status        string  `json:"status"`
	LockerCode    *string `json:"lockerCode,omitempty"`
	MovementCount int     `json:"movementCount"`
}

type PacketTotals struct {
	Count       int `json:"count"`
	InLocker    int `json:"inLocker"`
	BankPledged int `json:"bankPledged"`
	Released    int `json:"released"`
}

type BankPledgeRow struct {
	RecordID      uint       `json:"recordId"`
	LoanNumber    string     `json:"loanNumber"`
	BankName      string     `json:"bankName"`
	PledgedAmount float64    `json:"pledgedAmount"`
	PledgeDate    time.Time  `json:"pledgeDate"`
	ReleaseDate   *time.Time `json:"releaseDate,omitempty"`
	Status        string     `json:"status"`
}

type BankPledgeTotals struct {
	OutstandingLiability float64 `json:"outstandingLiability"` // sum of Active pledges
	Count                int     `json:"count"`
}

type LoanExtensionRow struct {
	RequestID   uint       `json:"requestId"`
	LoanNumber  string     `json:"loanNumber"`
	RequestedAt time.Time  `json:"requestedAt"`
	Months      *int       `json:"months,omitempty"`
	NewDueDate  *time.Time `json:"newDueDate,omitempty"`
	Status      string     `json:"status"`
}

type LoanExtensionTotals struct {
	Count int `json:"count"`
}

type GoldReleaseRow struct {
	RequestID        uint      `json:"requestId"`
	LoanNumber       string    `json:"loanNumber"`
	CustomerName     string    `json:"customerName"`
	RequestedAt      time.Time `json:"requestedAt"`
	SettlementAmount float64   `json:"settlementAmount"`
	Status           string    `json:"status"`
}

type GoldReleaseTotals struct {
	Count           int     `json:"count"`
	TotalSettlement float64 `json:"totalSettlement"`
}

type AuctionRow struct {
	RecordID         uint       `json:"recordId"`
	LoanNumber       string     `json:"loanNumber"`
	Stage            string     `json:"stage"`
	AuctionDate      *time.Time `json:"auctionDate,omitempty"`
	SaleAmount       float64    `json:"saleAmount"`
	SettlementStatus string     `json:"settlementStatus"`
}

type AuctionTotals struct {
	Count           int     `json:"count"`
	TotalSaleAmount float64 `json:"totalSaleAmount"`
}

type ExpenseCashflowRow struct {
	Date          time.Time `json:"date"`
	BranchName    string    `json:"branchName"`
	Collections   float64   `json:"collections"`
	Disbursements float64   `json:"disbursements"`
	CashExpenses  float64   `json:"cashExpenses"`
}

type ExpenseCashflowTotals struct {
	TotalCollections   float64 `json:"totalCollections"`
	TotalDisbursements float64 `json:"totalDisbursements"`
	TotalExpenses      float64 `json:"totalExpenses"`
	NetCashflow        float64 `json:"netCashflow"`
}

type KYCRow struct {
	CustomerID    uint   `json:"customerId"`
	Code          string `json:"code"`
	Name          string `json:"name"`
	Phone         string `json:"phone"`
	KYCStatus     string `json:"kycStatus"`
	PANStatus     string `json:"panStatus"`
	AadhaarStatus string `json:"aadhaarStatus"`
}

type KYCTotals struct {
	Count    int `json:"count"`
	Verified int `json:"verified"`
	Pending  int `json:"pending"`
}

type GoldRateHistoryRow struct {
	Date  time.Time `json:"date"`
	K24   float64   `json:"k24"`
	SetBy string    `json:"setBy"`
}

type GoldRateHistoryTotals struct {
	Count int `json:"count"`
}

type EmployeePerformanceRow struct {
	EmployeeID     uint    `json:"employeeId"`
	Name           string  `json:"name"`
	Role           string  `json:"role"`
	BranchName     string  `json:"branchName"`
	LoansProcessed int     `json:"loansProcessed"`
	CollectionsAmt float64 `json:"collectionsAmount"`
	RemindersSent  int     `json:"remindersSent"`
	Approvals      int     `json:"approvals"`
}

type EmployeePerformanceTotals struct {
	TotalLoansProcessed int     `json:"totalLoansProcessed"`
	TotalCollections    float64 `json:"totalCollections"`
}

type CommunicationHistoryRow struct {
	ID             uint      `json:"id"`
	RecipientName  string    `json:"recipientName"`
	RecipientPhone string    `json:"recipientPhone"`
	Channel        string    `json:"channel"`
	TriggerType    string    `json:"triggerType"`
	Status         string    `json:"status"`
	SentAt         time.Time `json:"sentAt"`
}

type CommunicationHistoryTotals struct {
	Count  int `json:"count"`
	Sent   int `json:"sent"`
	Failed int `json:"failed"`
}

// ---- Personal loan report (internal/personalloan) ----

type PersonalLoanRow struct {
	LoanID            uint      `json:"loanId"`
	LoanNumber        string    `json:"loanNumber"`
	OpenedDate        time.Time `json:"openedDate"`
	CustomerName      string    `json:"customerName"`
	BranchName        string    `json:"branchName"`
	Frequency         string    `json:"frequency"`
	PrincipalAmount   float64   `json:"principalAmount"`
	DisbursedAmount   float64   `json:"disbursedAmount"`
	OutstandingAmount float64   `json:"outstandingAmount"`
	Status            string    `json:"status"`
}

type PersonalLoanTotals struct {
	Count            int     `json:"count"`
	TotalPrincipal   float64 `json:"totalPrincipal"`
	TotalDisbursed   float64 `json:"totalDisbursed"`
	TotalOutstanding float64 `json:"totalOutstanding"`
}

// TradeSheetRow is one gold-stock movement event — see reports_trade.go for
// how Pledge In/Release Out/Re-pledge to Bank/Bank Release/Auction Out rows
// are each sourced. Purity/NetWeight are blank/zero on the two event types
// (bank re-pledge, auction) whose source table doesn't itemize weight.
type TradeSheetRow struct {
	Date       time.Time `json:"date"`
	Reference  string    `json:"reference"`
	Type       string    `json:"type"`
	Party      string    `json:"party"`
	Purity     string    `json:"purity"`
	NetWeight  float64   `json:"netWeight"`
	Rate       float64   `json:"rate"`
	Value      float64   `json:"value"`
	BranchName string    `json:"branchName"`
}

// PurityStock is one purity's closing stock weight, part of
// TradeSheetTotals.
type PurityStock struct {
	Purity    string  `json:"purity"`
	NetWeight float64 `json:"netWeight"`
}

type TradeSheetTotals struct {
	ClosingStockByPurity []PurityStock `json:"closingStockByPurity"`
	TotalValue           float64       `json:"totalValue"`
}

// BalanceSheetRow is one line item of the Assets/Liabilities/Capital
// statement — see reports_balance.go for how each is computed. There's no
// owner's-capital/equity ledger in this schema, so "Capital" carries a
// single computed Net Position (Assets − Liabilities) row rather than a
// real equity breakdown.
type BalanceSheetRow struct {
	Section string  `json:"section"` // "Assets" | "Liabilities" | "Capital"
	Label   string  `json:"label"`
	Amount  float64 `json:"amount"`
}

type BalanceSheetTotals struct {
	TotalAssets      float64 `json:"totalAssets"`
	TotalLiabilities float64 `json:"totalLiabilities"`
	NetPosition      float64 `json:"netPosition"`
}
