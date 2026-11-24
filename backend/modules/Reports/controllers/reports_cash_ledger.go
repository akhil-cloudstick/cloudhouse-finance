package controllers

import (
	"cloudhouse/backend/auth"
	common "cloudhouse/backend/common/controllers"
	"cloudhouse/backend/config"
	"cloudhouse/backend/modules/Reports/models"
	"context"
	"fmt"
	"net/http"
	"regexp"
	"strconv"
	"strings"
	"time"

	"github.com/labstack/echo/v4"
	"gorm.io/gorm"
)

// The Cash Ledger report is the main ledger's every cash movement, oldest first: Debit is money
// out, Credit money in, Balance the balance in hand after the entry — counted over the whole
// ledger, so narrowing to one loan hides rows without changing balances, as the Ledger page does.
// Each month closes with a subtotal row.

// A gold loan's movements carry its number as a "… — LN-00144" suffix on Purpose (see the Cash
// module's Record* helpers); there is no loan column on a movement.
var ledgerLoanRef = regexp.MustCompile(`—\s*LN-(\d+)\s*$`)

// ledgerMovement is the slice of a cash movement the report reads.
type ledgerMovement struct {
	OccurredOn time.Time
	Type       string
	Amount     float64
	Purpose    string
}

// ledgerLoanNumber is the gold loan a movement belongs to (LN-00144 → 144), or 0.
func ledgerLoanNumber(purpose string) int {
	m := ledgerLoanRef.FindStringSubmatch(purpose)
	if m == nil {
		return 0
	}
	n, _ := strconv.Atoi(m[1])
	return n
}

// ledgerLoanQuery reads the loan a user typed — "00144/26", "LN-00144" or "144" — as 144; 0 when
// it names none.
func ledgerLoanQuery(q string) int {
	q = strings.TrimSpace(q)
	if i := strings.Index(q, "/"); i >= 0 {
		q = q[:i]
	}
	q = strings.TrimPrefix(strings.ToUpper(q), "LN-")
	n, err := strconv.Atoi(strings.TrimSpace(q))
	if err != nil || n <= 0 {
		return 0
	}
	return n
}

// ledgerParticulars is a gold loan as "00144/26": its five-digit number and the year it opened
// (just the number when that year isn't known); blank for a movement that isn't a gold loan's.
func ledgerParticulars(loan int, openedYear map[int]int) string {
	if loan == 0 {
		return ""
	}
	if y, ok := openedYear[loan]; ok {
		return fmt.Sprintf("%05d/%02d", loan, y%100)
	}
	return fmt.Sprintf("%05d", loan)
}

// buildCashLedger turns the movements of the period (ledger order, oldest first) into the
// report's rows. `opening` is the balance in hand before the first of them; `loans` (none or 0 = all)
// keeps only those loans' rows, the balance still counting every movement.
func buildCashLedger(opening float64, moves []ledgerMovement, openedYear map[int]int, loans ...int) ([]models.CashLedgerRow, models.CashLedgerTotals) {
	only := map[int]bool{}
	for _, l := range loans {
		if l != 0 {
			only[l] = true
		}
	}
	totals := models.CashLedgerTotals{OpeningBalance: opening}
	var rows []models.CashLedgerRow
	balance := opening
	var month string
	var monthDebit, monthCredit, monthEnd float64
	shown := false
	closeMonth := func() {
		if shown {
			t, _ := time.Parse("2006-01", month)
			rows = append(rows, models.CashLedgerRow{
				Month: month, Particulars: "Total — " + t.Format("January 2006"),
				Debit: common.RoundDecimal2(monthDebit), Credit: common.RoundDecimal2(monthCredit), Balance: monthEnd, Total: true,
			})
		}
		monthDebit, monthCredit, shown = 0, 0, false
	}
	for _, m := range moves {
		if mk := m.OccurredOn.Format("2006-01"); mk != month {
			closeMonth()
			month = mk
		}
		var debit, credit float64
		if m.Type == "out" {
			debit = m.Amount
			balance -= m.Amount
		} else {
			credit = m.Amount
			balance += m.Amount
		}
		balance = common.RoundDecimal2(balance)
		monthEnd = balance
		ref := ledgerLoanNumber(m.Purpose)
		if len(only) > 0 && !only[ref] {
			continue
		}
		rows = append(rows, models.CashLedgerRow{
			Date: m.OccurredOn.Format("2006-01-02"), Month: month,
			Particulars: ledgerParticulars(ref, openedYear),
			Debit:       debit, Credit: credit, Balance: balance,
		})
		monthDebit += debit
		monthCredit += credit
		totals.TotalDebit += debit
		totals.TotalCredit += credit
		shown = true
	}
	closeMonth()
	totals.TotalDebit = common.RoundDecimal2(totals.TotalDebit)
	totals.TotalCredit = common.RoundDecimal2(totals.TotalCredit)
	totals.ClosingBalance = balance
	return rows, totals
}

func cashLedger(ctx context.Context, f models.Filter, loanQuery string) ([]models.CashLedgerRow, models.CashLedgerTotals, error) {
	from, to := dateRange(f)
	scoped := func() *gorm.DB {
		q := config.DB.WithContext(ctx).Table("cash_movements")
		if len(f.BranchIDs) > 0 {
			q = q.Where("branch_id IN ?", f.BranchIDs)
		}
		return q
	}
	var opening float64
	if err := scoped().Where("occurred_on < ?", from).
		Select("COALESCE(SUM(CASE WHEN type = 'in' THEN amount ELSE -amount END), 0)").
		Scan(&opening).Error; err != nil {
		return nil, models.CashLedgerTotals{}, err
	}
	var moves []ledgerMovement
	if err := scoped().Where("occurred_on >= ? AND occurred_on < ?", from, to).
		Select("occurred_on, type, amount, purpose").
		Order("DATE(occurred_on) asc, created_at asc, id asc").
		Scan(&moves).Error; err != nil {
		return nil, models.CashLedgerTotals{}, err
	}
	if len(moves) > reportExportMaxRows {
		return nil, models.CashLedgerTotals{}, common.NewBadRequest(fmt.Sprintf("this ledger has %d entries in the chosen period — choose a shorter date range (at most %d)", len(moves), reportExportMaxRows))
	}
	openedYear, err := loansOpenedYear(ctx, moves)
	if err != nil {
		return nil, models.CashLedgerTotals{}, err
	}
	// loanQuery may name several loans, comma-separated.
	var loans []int
	for _, part := range strings.Split(loanQuery, ",") {
		loans = append(loans, ledgerLoanQuery(part))
	}
	rows, totals := buildCashLedger(common.RoundDecimal2(opening), moves, openedYear, loans...)
	return rows, totals, nil
}

// loansOpenedYear is the year each gold loan the movements name was opened, by loan number.
func loansOpenedYear(ctx context.Context, moves []ledgerMovement) (map[int]int, error) {
	seen := map[int]bool{}
	var numbers []string
	for _, m := range moves {
		if n := ledgerLoanNumber(m.Purpose); n != 0 && !seen[n] {
			seen[n] = true
			numbers = append(numbers, fmt.Sprintf("LN-%05d", n))
		}
	}
	out := map[int]int{}
	if len(numbers) == 0 {
		return out, nil
	}
	var loans []struct {
		LoanNumber string
		OpenedDate time.Time
	}
	if err := config.DB.WithContext(ctx).Table("loans").
		Select("loan_number, opened_date").
		Where("loan_number IN ?", numbers).
		Scan(&loans).Error; err != nil {
		return nil, err
	}
	for _, l := range loans {
		if n := ledgerLoanNumber("— " + l.LoanNumber); n != 0 {
			out[n] = l.OpenedDate.Year()
		}
	}
	return out, nil
}

// CashLedgerReport returns every row of the period at once (no paging): the month subtotals and
// the running balance only read right over the whole period.
func CashLedgerReport(c echo.Context) error {
	ctx := auth.RequestContext(c)
	f, err := parseFilter(c)
	if err != nil {
		badRequest(c, err)
		return nil
	}
	rows, totals, err := cashLedger(ctx, f, c.QueryParam("loan"))
	if err != nil {
		reportError(c, err)
		return nil
	}
	return common.Success(c, http.StatusOK, models.Result{Rows: rows, Totals: totals, TotalCount: len(rows)})
}

// exportCashLedger writes the report as a spreadsheet or PDF: the opening balance, every entry with
// each month's subtotal, and the closing balance.
func exportCashLedger(c echo.Context, f models.Filter, format string) {
	ctx := auth.RequestContext(c)
	rows, totals, err := cashLedger(ctx, f, c.QueryParam("loan"))
	if err != nil {
		reportError(c, err)
		return
	}
	money := func(v float64) string {
		if v == 0 {
			return ""
		}
		return fmt.Sprintf("%.2f", v)
	}
	headers := []string{"date", "particulars", "debit", "credit", "balance"}
	data := [][]string{{"", "Opening balance", "", "", fmt.Sprintf("%.2f", totals.OpeningBalance)}}
	for _, r := range rows {
		date := ""
		if t, err := time.Parse("2006-01-02", r.Date); err == nil {
			date = t.Format("02-01-2006")
		}
		data = append(data, []string{date, r.Particulars, money(r.Debit), money(r.Credit), fmt.Sprintf("%.2f", r.Balance)})
	}
	data = append(data, []string{"", "Closing balance", money(totals.TotalDebit), money(totals.TotalCredit), fmt.Sprintf("%.2f", totals.ClosingBalance)})
	const key = "cash-ledger"
	filename := fmt.Sprintf("%s-%s.%s", key, time.Now().Format("20060102-150405"), format)
	switch format {
	case "xlsx":
		buf, err := BuildXLSX(key, headers, data)
		if err != nil {
			reportError(c, err)
			return
		}
		c.Response().Header().Set("Content-Disposition", "attachment; filename=\""+filename+"\"")
		c.Blob(http.StatusOK, "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", buf)
	case "pdf":
		buf, err := BuildPDF(businessName(ctx), key, headers, data)
		if err != nil {
			reportError(c, err)
			return
		}
		c.Response().Header().Set("Content-Disposition", "attachment; filename=\""+filename+"\"")
		c.Blob(http.StatusOK, "application/pdf", buf)
	default:
		badRequest(c, fmt.Errorf("format must be xlsx or pdf"))
	}
}
