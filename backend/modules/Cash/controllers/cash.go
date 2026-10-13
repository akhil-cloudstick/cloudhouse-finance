package controllers

import (
	"cloudhouse/backend/auth"
	common "cloudhouse/backend/common/controllers"
	"cloudhouse/backend/modules/Cash/models"
	"context"
	"fmt"
	"net/http"
	"strconv"
	"strings"
	"time"

	"github.com/labstack/echo/v4"
)

var modeVocabulary = map[string]bool{
	"Cash":          true,
	"UPI":           true,
	"Bank Transfer": true,
}

const SelfTransferSource = "Self Transfer"

var bankModes = []string{models.CashModeUPI, models.CashModeBankTransfer}

// bankModeSQL is bankModes as a SQL list, for the ledger scans that build their WHERE clause as text.
const bankModeSQL = "('UPI','Bank Transfer')"

type selfTransferRequest struct {
	Category     string  `json:"category" binding:"required"`
	Amount       float64 `json:"amount" binding:"required"`
	FromBankID   uint    `json:"from_bank_id"`
	FromBank     string  `json:"from_bank"`
	ToBankID     uint    `json:"to_bank_id"`
	ToBank       string  `json:"to_bank"`
	Mode         string  `json:"mode"`
	ReceiptImage string  `json:"receipt_image"`
	BranchID     *uint   `json:"branch_id"`
	OccurredOn   string  `json:"occurred_on"`
	Remarks      string  `json:"remarks"`
}

type setStatusRequest struct {
	Status string `json:"status" binding:"required"`
}

type LoanBalance struct {
	Principal float64 `json:"principal"`
	Drawn     float64 `json:"drawn"`
	Repaid    float64 `json:"repaid"`
	Balance   float64 `json:"balance"`
}

type RecordSelfTransferInput struct {
	Category     string
	Amount       float64
	FromBankID   uint
	FromBank     string
	ToBankID     uint
	ToBank       string
	Mode         string
	ReceiptImage string
	BranchID     *uint
	OccurredOn   time.Time
	Remarks      string
}

type PartyTotals struct {
	TotalIn  float64 `json:"total_in"`
	TotalOut float64 `json:"total_out"`
	Net      float64 `json:"net"`
	InCount  int     `json:"in_count"`
	OutCount int     `json:"out_count"`
}

type splitComponent struct {
	mode   string
	amount float64
}

type CashInBreakdown struct {
	Repayments float64 `json:"repayments"`
	Pledges    float64 `json:"pledges"`
	Auctions   float64 `json:"auctions"`
	GoldSales  float64 `json:"gold_sales"`
	TopUps     float64 `json:"top_ups"`
}

type CashOutBreakdown struct {
	LoanDisbursements float64 `json:"loan_disbursements"`
	BankReleases      float64 `json:"bank_releases"`
	AuctionRefunds    float64 `json:"auction_refunds"`
	GoldPurchases     float64 `json:"gold_purchases"`
	Withdrawals       float64 `json:"withdrawals"`
}

type BalanceScope struct {
	Bank            bool
	BranchID        *uint
	ExcludeBranches []uint
	BankID          *uint
	Mode            string
	From            time.Time
	To              time.Time
}

func parseOptionalDate(s string) (time.Time, error) {
	if s == "" {
		return time.Time{}, nil
	}
	return time.Parse("2006-01-02", s)
}

func parseOccurredOn(s string) (time.Time, error) {
	if s == "" {
		return time.Time{}, nil
	}
	t, err := time.ParseInLocation("2006-01-02", s, time.Local)
	if err != nil {
		return time.Time{}, err
	}
	now := time.Now()
	if t.Year() == now.Year() && t.YearDay() == now.YearDay() {
		return now, nil
	}
	return t, nil
}

func parseUintCSV(s string) []uint {
	if s == "" {
		return nil
	}
	var out []uint
	for _, part := range strings.Split(s, ",") {
		part = strings.TrimSpace(part)
		if part == "" {
			continue
		}
		v, err := strconv.ParseUint(part, 10, 64)
		if err != nil {
			continue
		}
		out = append(out, uint(v))
	}
	return out
}

func parseStringCSV(s string) []string {
	if s == "" {
		return nil
	}
	var out []string
	for _, part := range strings.Split(s, ",") {
		part = strings.TrimSpace(part)
		if part != "" {
			out = append(out, part)
		}
	}
	return out
}

func partyStatementRows(rows []models.CashMovement) [][]string {
	tableRows := make([][]string, len(rows))
	for i, m := range rows {
		branchName := ""
		if m.Branch != nil {
			branchName = m.Branch.Name
		}
		tableRows[i] = []string{
			m.OccurredOn.Format("2006-01-02"),
			m.Type,
			m.Source,
			m.Purpose,
			m.Mode,
			m.Bank,
			branchName,
			strconv.FormatFloat(m.Amount, 'f', 2, 64),
			m.Status,
		}
	}
	return tableRows
}

func partyStatementNote(fromDate, toDate time.Time) string {
	if fromDate.IsZero() && toDate.IsZero() {
		return ""
	}
	from, to := "…", "…"
	if !fromDate.IsZero() {
		from = fromDate.Format("02 Jan 2006")
	}
	if !toDate.IsZero() {
		to = toDate.Format("02 Jan 2006")
	}
	return from + " – " + to
}

func loanNumbersFromQuery(c echo.Context) []string {
	numbers := parseStringCSV(c.QueryParam("loan_numbers"))
	if single := c.QueryParam("loan_number"); single != "" {
		numbers = append(numbers, single)
	}
	return numbers
}

func branchColumnFor(c echo.Context, headers []string, rows [][]string) ([]string, [][]string) {
	if _, single := auth.SingleBranchPin(c); !single {
		return headers, rows
	}
	idx := -1
	for i, h := range headers {
		if h == "Branch" {
			idx = i
			break
		}
	}
	if idx < 0 {
		return headers, rows
	}
	headers = append(append([]string{}, headers[:idx]...), headers[idx+1:]...)
	for i, r := range rows {
		if idx < len(r) {
			rows[i] = append(append([]string{}, r[:idx]...), r[idx+1:]...)
		}
	}
	return headers, rows
}

func ledgerPaging(c echo.Context) (page, limit, offset int, export bool) {
	if c.QueryParam("export") == "pdf" {
		return 0, 0, 0, true
	}
	page, limit, offset = common.PageParams(c)
	if limit == 0 {
		page, limit = 1, 12
	}
	return page, limit, offset, false
}

func respondLedger(c echo.Context, page, limit int, export bool, title, filename string, fromDate, toDate time.Time, rows []LedgerRow, total int64, totals LedgerTotals, extra echo.Map) error {
	if !export {
		body := echo.Map{"total_debit": totals.TotalDebit, "total_credit": totals.TotalCredit}
		if totals.FocusPage > 0 {
			body["focus_page"] = totals.FocusPage
		}
		for k, v := range extra {
			body[k] = v
		}
		return common.SuccessPage(c, page, limit, total, rows, body)
	}
	money := func(v float64) string { return strconv.FormatFloat(v, 'f', 2, 64) }
	tableRows := make([][]string, 0, len(rows)+1)
	for _, r := range rows {
		debit, credit := "", ""
		if r.DebitOrCredit == "debit" {
			debit = money(r.Amount)
		} else {
			credit = money(r.Amount)
		}
		tableRows = append(tableRows, []string{
			r.Date.Format("2006-01-02"), r.Description, r.Method, r.Reference, r.BankName, r.CustomerName, debit, credit, money(r.RunningBalance),
		})
	}
	tableRows = append(tableRows, []string{"", "Total", "", "", "", "", money(totals.TotalDebit), money(totals.TotalCredit), ""})
	pdfBytes, err := renderTablePDF(title, partyStatementNote(fromDate, toDate),
		[]string{"Date", "Description", "Mode", "Reference", "Bank", "Customer", "Debit", "Credit", "Balance"}, tableRows)
	if err != nil {
		return common.FailWith(c, http.StatusBadRequest, "Could not generate the document, please try again", err)
	}
	c.Response().Header().Set("Content-Disposition", `attachment; filename="`+filename+`"`)
	return c.Blob(http.StatusOK, "application/pdf", pdfBytes)
}

func parseQueryDate(c echo.Context) (time.Time, error) {
	return parseOptionalDate(c.QueryParam("date"))
}

func respondLoanLedger(c echo.Context, src *models.CashSource, bal LoanBalance) error {
	ctx := auth.RequestContext(c)
	fromDate, err := parseOptionalDate(c.QueryParam("from_date"))
	if err != nil {
		return c.JSON(http.StatusBadRequest, echo.Map{"success": false, "error": "Invalid from_date, please use the YYYY-MM-DD format"})
	}
	toDate, err := parseOptionalDate(c.QueryParam("to_date"))
	if err != nil {
		return c.JSON(http.StatusBadRequest, echo.Map{"success": false, "error": "Invalid to_date, please use the YYYY-MM-DD format"})
	}
	page, limit, offset, export := ledgerPaging(c)
	rows, total, totals, err := listLoanSourceLedger(ctx, src, fromDate, toDate, limit, offset)
	if err != nil {
		return common.FailErr(c, err)
	}
	respondLedger(c, page, limit, export, "Loan Ledger — "+src.Name, "loan-ledger.pdf", fromDate, toDate, rows, total, totals, echo.Map{
		"category_name": src.Name,
		"loan": echo.Map{
			"source_id": src.ID, "name": src.Name, "loan_number": src.LoanNumber,
			"principal": bal.Principal, "drawn": bal.Drawn, "repaid": bal.Repaid, "balance": bal.Balance,
		},
	})
	return nil
}

func respondCashInLedger(c echo.Context, cat *models.Category) error {
	ctx := auth.RequestContext(c)
	fromDate, err := parseOptionalDate(c.QueryParam("from_date"))
	if err != nil {
		return c.JSON(http.StatusBadRequest, echo.Map{"success": false, "error": "Invalid from_date, please use the YYYY-MM-DD format"})
	}
	toDate, err := parseOptionalDate(c.QueryParam("to_date"))
	if err != nil {
		return c.JSON(http.StatusBadRequest, echo.Map{"success": false, "error": "Invalid to_date, please use the YYYY-MM-DD format"})
	}
	page, limit, offset, export := ledgerPaging(c)
	rows, total, totals, err := listLedgerByCashInCategory(ctx, cat.Name, auth.GetBranchScope(c), fromDate, toDate, limit, offset)
	if err != nil {
		return common.FailErr(c, err)
	}
	respondLedger(c, page, limit, export, cat.Name+" Ledger", "category-ledger.pdf", fromDate, toDate, rows, total, totals, echo.Map{"category_name": cat.Name})
	return nil
}

func sumPartyTotals(rows []models.CashMovement) PartyTotals {
	var t PartyTotals
	for _, m := range rows {
		if m.Type == "in" {
			t.TotalIn += m.Amount
			t.InCount++
		} else {
			t.TotalOut += m.Amount
			t.OutCount++
		}
	}
	t.Net = t.TotalIn - t.TotalOut
	return t
}

func strPtr(s string) *string { return &s }

func ErrInsufficientCashInHand(available, required float64) error {
	return common.NewConflict(fmt.Sprintf("Insufficient balance in hand: available ₹%.2f, required ₹%.2f", available, required))
}

func ensureBuiltInCategories(ctx context.Context) error {
	if _, _, err := findOrCreateCategory(ctx, "Gold Sale", models.CategoryCashIn); err != nil {
		return err
	}
	if _, _, err := findOrCreateCategory(ctx, auctionExpenseCategory, models.CategoryExpense); err != nil {
		return err
	}
	// A bank pledge release is filed under its own expense category, like any other, so it has a category ledger.
	_, _, err := findOrCreateCategory(ctx, bankPledgeReleaseCategory, models.CategoryExpense)
	return err
}

func startOfDay(t time.Time) time.Time {
	y, m, d := t.Date()
	return time.Date(y, m, d, 0, 0, 0, 0, t.Location())
}

func bankSideBranch(table, bankCol string) string {
	return "COALESCE((SELECT bk.branch_id FROM banks bk WHERE bk.id = " + table + "." + bankCol + "), " + table + ".branch_id)"
}

func ErrInsufficientBankBalance(available, required float64) error {
	return common.NewConflict(fmt.Sprintf("Insufficient balance in the selected bank: available ₹%.2f, required ₹%.2f", available, required))
}
