package models

import (
	"time"
)

type Filter struct {
	From     *time.Time
	To       *time.Time
	BranchID *uint
	Page     int
	PageSize int
	Q        string
}

type Result struct {
	Rows       any `json:"rows"`
	Totals     any `json:"totals"`
	TotalCount int `json:"total_count"`
}

type DisbursementRow struct {
	LoanID       uint      `json:"loan_id"`
	LoanNumber   string    `json:"loan_number"`
	OpenedDate   time.Time `json:"opened_date"`
	Amount       float64   `json:"amount"`
	BranchName   string    `json:"branch_name"`
	CustomerName string    `json:"customer_name"`
	SchemeName   string    `json:"scheme_name"`
}

type DisbursementTotals struct {
	Count       int     `json:"count"`
	TotalAmount float64 `json:"total_amount"`
}

type LoanStatusRow struct {
	LoanID       uint      `json:"loan_id"`
	LoanNumber   string    `json:"loan_number"`
	CustomerName string    `json:"customer_name"`
	BranchName   string    `json:"branch_name"`
	Status       string    `json:"status"`
	Outstanding  float64   `json:"outstanding"`
	DueDate      time.Time `json:"due_date"`
}

type LoanStatusTotals struct {
	Active    int `json:"active"`
	Closed    int `json:"closed"`
	DueSoon   int `json:"due_soon"`
	Overdue   int `json:"overdue"`
	Defaulted int `json:"defaulted"`
	Other     int `json:"other"`
	Count     int `json:"count"`
}

type DepositRegisterRow struct {
	InvestmentID     uint      `json:"investment_id"`
	InvestmentNumber string    `json:"investment_number"`
	CustomerName     string    `json:"customer_name"`
	PlanName         string    `json:"plan_name"`
	PrincipalAmount  float64   `json:"principal_amount"`
	InterestRate     float64   `json:"interest_rate"`
	StartDate        time.Time `json:"start_date"`
	MaturityDate     time.Time `json:"maturity_date"`
	BranchName       string    `json:"branch_name"`
	Status           string    `json:"status"`
}

type DepositRegisterTotals struct {
	Count          int     `json:"count"`
	TotalPrincipal float64 `json:"total_principal"`
}

type InterestPayoutRegisterRow struct {
	InvestmentID     uint       `json:"investment_id"`
	InvestmentNumber string     `json:"investment_number"`
	CustomerName     string     `json:"customer_name"`
	SequenceNo       int        `json:"sequence_no"`
	DueDate          time.Time  `json:"due_date"`
	Amount           float64    `json:"amount"`
	Status           string     `json:"status"`
	PaidAt           *time.Time `json:"paid_at"`
}

type InterestPayoutRegisterTotals struct {
	Count        int     `json:"count"`
	TotalDue     float64 `json:"total_due"`
	TotalPaid    float64 `json:"total_paid"`
	TotalPending float64 `json:"total_pending"`
}

type MaturityRegisterRow struct {
	InvestmentID     uint      `json:"investment_id"`
	InvestmentNumber string    `json:"investment_number"`
	CustomerName     string    `json:"customer_name"`
	BranchName       string    `json:"branch_name"`
	PrincipalAmount  float64   `json:"principal_amount"`
	MaturityDate     time.Time `json:"maturity_date"`
	Status           string    `json:"status"`
}

type MaturityRegisterTotals struct {
	Active  int `json:"active"`
	Matured int `json:"matured"`
	Closed  int `json:"closed"`
	Renewed int `json:"renewed"`
	Count   int `json:"count"`
}

type InvestorLedgerRow struct {
	InvestmentID      uint      `json:"investment_id"`
	InvestmentNumber  string    `json:"investment_number"`
	PlanName          string    `json:"plan_name"`
	PrincipalAmount   float64   `json:"principal_amount"`
	TotalInterestPaid float64   `json:"total_interest_paid"`
	StartDate         time.Time `json:"start_date"`
	MaturityDate      time.Time `json:"maturity_date"`
	Status            string    `json:"status"`
}

type InvestorLedgerTotals struct {
	Count             int     `json:"count"`
	TotalPrincipal    float64 `json:"total_principal"`
	TotalInterestPaid float64 `json:"total_interest_paid"`
}

type InterestCollectionRow struct {
	LoanID          uint      `json:"loan_id"`
	LoanNumber      string    `json:"loan_number"`
	PaidOn          time.Time `json:"paid_on"`
	InterestApplied float64   `json:"interest_applied"`
	PenalApplied    float64   `json:"penal_applied"`
	BranchName      string    `json:"branch_name"`
}

type InterestCollectionTotals struct {
	TotalInterest float64 `json:"total_interest"`
	TotalPenal    float64 `json:"total_penal"`
	Total         float64 `json:"total"`
}

type OutstandingPrincipalRow struct {
	BranchName  string  `json:"branch_name"`
	LoanCount   int     `json:"loan_count"`
	Outstanding float64 `json:"outstanding"`
}

type OutstandingPrincipalTotals struct {
	TotalOutstanding float64 `json:"total_outstanding"`
	TotalLoans       int     `json:"total_loans"`
}

type PaymentCollectionRow struct {
	PaymentID    uint      `json:"payment_id"`
	LoanNumber   string    `json:"loan_number"`
	PaidOn       time.Time `json:"paid_on"`
	Amount       float64   `json:"amount"`
	Type         string    `json:"type"`
	BranchName   string    `json:"branch_name"`
	EmployeeName string    `json:"employee_name"`
}

type PaymentCollectionTotals struct {
	TotalAmount float64 `json:"total_amount"`
	Count       int     `json:"count"`
}

type GoldWeightRow struct {
	OrnamentID   uint    `json:"ornament_id"`
	LoanNumber   string  `json:"loan_number"`
	CustomerName string  `json:"customer_name"`
	Name         string  `json:"name"`
	Purity       string  `json:"purity"`
	GrossWeight  float64 `json:"gross_weight"`
	NetWeight    float64 `json:"net_weight"`
	GoldValue    float64 `json:"gold_value"`
}

type GoldWeightTotals struct {
	TotalGrossWeight float64 `json:"total_gross_weight"`
	TotalNetWeight   float64 `json:"total_net_weight"`
	TotalGoldValue   float64 `json:"total_gold_value"`
}

type PacketRow struct {
	PacketID      uint    `json:"packet_id"`
	Code          string  `json:"code"`
	LoanNumber    string  `json:"loan_number"`
	Status        string  `json:"status"`
	LockerCode    *string `json:"locker_code,omitempty"`
	MovementCount int     `json:"movement_count"`
}

type PacketTotals struct {
	Count       int `json:"count"`
	InLocker    int `json:"in_locker"`
	BankPledged int `json:"bank_pledged"`
	Released    int `json:"released"`
}

type BankPledgeRow struct {
	RecordID      uint       `json:"record_id"`
	LoanNumber    string     `json:"loan_number"`
	BankName      string     `json:"bank_name"`
	PledgedAmount float64    `json:"pledged_amount"`
	PledgeDate    time.Time  `json:"pledge_date"`
	ReleaseDate   *time.Time `json:"release_date,omitempty"`
	Status        string     `json:"status"`
}

type BankPledgeTotals struct {
	OutstandingLiability float64 `json:"outstanding_liability"`
	Count                int     `json:"count"`
}

type LoanExtensionRow struct {
	RequestID   uint       `json:"request_id"`
	LoanNumber  string     `json:"loan_number"`
	RequestedAt time.Time  `json:"requested_at"`
	Months      *int       `json:"months,omitempty"`
	NewDueDate  *time.Time `json:"new_due_date,omitempty"`
	Status      string     `json:"status"`
}

type LoanExtensionTotals struct {
	Count int `json:"count"`
}

type GoldReleaseRow struct {
	RequestID        uint      `json:"request_id"`
	LoanNumber       string    `json:"loan_number"`
	CustomerName     string    `json:"customer_name"`
	RequestedAt      time.Time `json:"requested_at"`
	SettlementAmount float64   `json:"settlement_amount"`
	Status           string    `json:"status"`
}

type GoldReleaseTotals struct {
	Count           int     `json:"count"`
	TotalSettlement float64 `json:"total_settlement"`
}

type AuctionRow struct {
	RecordID         uint       `json:"record_id"`
	LoanNumber       string     `json:"loan_number"`
	Stage            string     `json:"stage"`
	AuctionDate      *time.Time `json:"auction_date,omitempty"`
	SaleAmount       float64    `json:"sale_amount"`
	SettlementStatus string     `json:"settlement_status"`
}

type AuctionTotals struct {
	Count           int     `json:"count"`
	TotalSaleAmount float64 `json:"total_sale_amount"`
}

type ExpenseCashflowRow struct {
	Date          time.Time `json:"date"`
	BranchName    string    `json:"branch_name"`
	Collections   float64   `json:"collections"`
	Disbursements float64   `json:"disbursements"`
	CashExpenses  float64   `json:"cash_expenses"`
}

type ExpenseCashflowTotals struct {
	TotalCollections   float64 `json:"total_collections"`
	TotalDisbursements float64 `json:"total_disbursements"`
	TotalExpenses      float64 `json:"total_expenses"`
	NetCashflow        float64 `json:"net_cashflow"`
}

type KYCRow struct {
	CustomerID    uint   `json:"customer_id"`
	Code          string `json:"code"`
	Name          string `json:"name"`
	Phone         string `json:"phone"`
	KYCStatus     string `json:"kyc_status"`
	PANStatus     string `json:"pan_status"`
	AadhaarStatus string `json:"aadhaar_status"`
}

type KYCTotals struct {
	Count    int `json:"count"`
	Verified int `json:"verified"`
	Pending  int `json:"pending"`
}

type GoldRateHistoryRow struct {
	Date  time.Time `json:"date"`
	K24   float64   `json:"k24"`
	SetBy string    `json:"set_by"`
}

type GoldRateHistoryTotals struct {
	Count int `json:"count"`
}

type EmployeePerformanceRow struct {
	EmployeeID     uint    `json:"employee_id"`
	Name           string  `json:"name"`
	Role           string  `json:"role"`
	BranchName     string  `json:"branch_name"`
	LoansProcessed int     `json:"loans_processed"`
	CollectionsAmt float64 `json:"collections_amount"`
	RemindersSent  int     `json:"reminders_sent"`
	Approvals      int     `json:"approvals"`
}

type EmployeePerformanceTotals struct {
	TotalLoansProcessed int     `json:"total_loans_processed"`
	TotalCollections    float64 `json:"total_collections"`
}

type CommunicationHistoryRow struct {
	ID             uint      `json:"id"`
	RecipientName  string    `json:"recipient_name"`
	RecipientPhone string    `json:"recipient_phone"`
	Channel        string    `json:"channel"`
	TriggerType    string    `json:"trigger_type"`
	Status         string    `json:"status"`
	SentAt         time.Time `json:"sent_at"`
}

type CommunicationHistoryTotals struct {
	Count  int `json:"count"`
	Sent   int `json:"sent"`
	Failed int `json:"failed"`
}

type PersonalLoanRow struct {
	LoanID            uint      `json:"loan_id"`
	LoanNumber        string    `json:"loan_number"`
	OpenedDate        time.Time `json:"opened_date"`
	CustomerName      string    `json:"customer_name"`
	BranchName        string    `json:"branch_name"`
	Frequency         string    `json:"frequency"`
	PrincipalAmount   float64   `json:"principal_amount"`
	DisbursedAmount   float64   `json:"disbursed_amount"`
	OutstandingAmount float64   `json:"outstanding_amount"`
	Status            string    `json:"status"`
}

type PersonalLoanTotals struct {
	Count            int     `json:"count"`
	TotalPrincipal   float64 `json:"total_principal"`
	TotalDisbursed   float64 `json:"total_disbursed"`
	TotalOutstanding float64 `json:"total_outstanding"`
}

type BalanceSheetRow struct {
	Label  string  `json:"label"`
	Amount float64 `json:"amount"`
	Style  string  `json:"style"`
	Indent int     `json:"indent"`
}

type BalanceSheetTotals struct {
	TotalAssets      float64 `json:"total_assets"`
	TotalLiabilities float64 `json:"total_liabilities"`
	TotalEquity      float64 `json:"total_equity"`
}

type ProfitLossRow struct {
	Label  string  `json:"label"`
	Amount float64 `json:"amount"`
	Style  string  `json:"style"`
	Indent int     `json:"indent"`
}

type ProfitLossTotals struct {
	TotalIncome     float64 `json:"total_income"`
	TotalExpenses   float64 `json:"total_expenses"`
	ProfitForPeriod float64 `json:"profit_for_period"`
}
