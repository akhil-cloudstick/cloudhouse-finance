package controllers

import (
	"cloudhouse/backend/auth"
	common "cloudhouse/backend/common/controllers"
	"cloudhouse/backend/config"
	"cloudhouse/backend/modules/Reports/models"
	"context"
	"errors"
	"net/http"
	"strconv"
	"strings"
	"time"

	"github.com/labstack/echo/v4"
)

func Paginate[T any](rows []T, f models.Filter) (page []T, total int) {
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

func businessName(ctx context.Context) string {
	id, ok := config.TenantFromContext(ctx)
	if !ok {
		return "Gold Loan Report"
	}
	t, err := common.FindTenantByID(ctx, id)
	if err != nil || t.Name == "" {
		return "Gold Loan Report"
	}
	return t.Name
}

func dateRange(f models.Filter) (from, to time.Time) {
	from = time.Date(2000, 1, 1, 0, 0, 0, 0, time.UTC)
	to = time.Now().AddDate(1, 0, 0)
	if f.From != nil {
		from = *f.From
	}
	if f.To != nil {
		to = f.To.AddDate(0, 0, 1)
	}
	return from, to
}

func parseFilter(c echo.Context) (models.Filter, error) {
	var f models.Filter
	if v := c.QueryParam("from"); v != "" {
		t, err := time.Parse("2006-01-02", v)
		if err != nil {
			return models.Filter{}, err
		}
		f.From = &t
	}
	if v := c.QueryParam("to"); v != "" {
		t, err := time.Parse("2006-01-02", v)
		if err != nil {
			return models.Filter{}, err
		}
		f.To = &t
	}
	if v := c.QueryParam("branch_id"); v != "" {
		id, err := strconv.ParseUint(v, 10, 64)
		if err != nil {
			return models.Filter{}, err
		}
		branchID := uint(id)
		f.BranchID = &branchID
	}
	branchID, ok := auth.NarrowBranch(c, f.BranchID)
	if !ok {
		return models.Filter{}, errors.New("that branch is outside your current branch selection")
	}
	f.BranchID = branchID
	f.Page = 1
	if v := c.QueryParam("page"); v != "" {
		if n, err := strconv.Atoi(v); err == nil && n > 0 {
			f.Page = n
		}
	}
	f.PageSize = 10
	if v := c.QueryParam("page_size"); v != "" {
		if n, err := strconv.Atoi(v); err == nil && n > 0 {
			f.PageSize = n
		}
	}
	f.Q = strings.TrimSpace(c.QueryParam("search"))
	return f, nil
}

func badRequest(c echo.Context, err error) error {
	return c.JSON(http.StatusBadRequest, echo.Map{"success": false, "error": err.Error()})
}

func reportError(c echo.Context, err error) error {
	return common.FailErr(c, err)
}

func respond[T any](c echo.Context, rows []T, totals any, f models.Filter) error {
	page, total := Paginate(MatchRows(rows, f.Q), f)
	return common.Success(c, http.StatusOK, models.Result{Rows: page, Totals: totals, TotalCount: total})
}

func DisbursementReport(c echo.Context) error {
	ctx := auth.RequestContext(c)
	f, err := parseFilter(c)
	if err != nil {
		badRequest(c, err)
		return nil
	}
	rows, totals, err := disbursementReport(ctx, f)
	if err != nil {
		reportError(c, err)
		return nil
	}
	respond(c, rows, totals, f)
	return nil
}

func DepositRegisterReport(c echo.Context) error {
	ctx := auth.RequestContext(c)
	f, err := parseFilter(c)
	if err != nil {
		badRequest(c, err)
		return nil
	}
	rows, totals, err := depositRegister(ctx, f)
	if err != nil {
		reportError(c, err)
		return nil
	}
	respond(c, rows, totals, f)
	return nil
}

func InterestPayoutRegisterReport(c echo.Context) error {
	ctx := auth.RequestContext(c)
	f, err := parseFilter(c)
	if err != nil {
		badRequest(c, err)
		return nil
	}
	rows, totals, err := interestPayoutRegister(ctx, f)
	if err != nil {
		reportError(c, err)
		return nil
	}
	respond(c, rows, totals, f)
	return nil
}

func MaturityRegisterReport(c echo.Context) error {
	ctx := auth.RequestContext(c)
	f, err := parseFilter(c)
	if err != nil {
		badRequest(c, err)
		return nil
	}
	rows, totals, err := maturityRegister(ctx, f)
	if err != nil {
		reportError(c, err)
		return nil
	}
	respond(c, rows, totals, f)
	return nil
}

func InvestorLedgerReport(c echo.Context) error {
	ctx := auth.RequestContext(c)
	customerID, err := strconv.ParseUint(c.QueryParam("customer_id"), 10, 64)
	if err != nil {
		badRequest(c, err)
		return nil
	}
	rows, totals, err := investorLedger(ctx, uint(customerID), auth.GetBranchScope(c))
	if err != nil {
		reportError(c, err)
		return nil
	}
	return common.Success(c, http.StatusOK, models.Result{Rows: rows, Totals: totals, TotalCount: len(rows)})
}

func LoansStatusReport(c echo.Context) error {
	ctx := auth.RequestContext(c)
	f, err := parseFilter(c)
	if err != nil {
		badRequest(c, err)
		return nil
	}
	rows, totals, err := loanStatus(ctx, f, c.QueryParam("status"))
	if err != nil {
		reportError(c, err)
		return nil
	}
	respond(c, rows, totals, f)
	return nil
}

func InterestCollectionReport(c echo.Context) error {
	ctx := auth.RequestContext(c)
	f, err := parseFilter(c)
	if err != nil {
		badRequest(c, err)
		return nil
	}
	rows, totals, err := interestCollection(ctx, f)
	if err != nil {
		reportError(c, err)
		return nil
	}
	respond(c, rows, totals, f)
	return nil
}

func OutstandingPrincipalReport(c echo.Context) error {
	ctx := auth.RequestContext(c)
	f, err := parseFilter(c)
	if err != nil {
		badRequest(c, err)
		return nil
	}
	rows, totals, err := outstandingPrincipal(ctx, f)
	if err != nil {
		reportError(c, err)
		return nil
	}
	respond(c, rows, totals, f)
	return nil
}

func PaymentCollectionReport(c echo.Context) error {
	ctx := auth.RequestContext(c)
	f, err := parseFilter(c)
	if err != nil {
		badRequest(c, err)
		return nil
	}
	rows, totals, err := paymentCollection(ctx, f)
	if err != nil {
		reportError(c, err)
		return nil
	}
	respond(c, rows, totals, f)
	return nil
}

func GoldWeightReport(c echo.Context) error {
	ctx := auth.RequestContext(c)
	f, err := parseFilter(c)
	if err != nil {
		badRequest(c, err)
		return nil
	}
	rows, totals, err := goldWeight(ctx, f)
	if err != nil {
		reportError(c, err)
		return nil
	}
	respond(c, rows, totals, f)
	return nil
}

func PacketsReport(c echo.Context) error {
	ctx := auth.RequestContext(c)
	f, err := parseFilter(c)
	if err != nil {
		badRequest(c, err)
		return nil
	}
	rows, totals, err := packetsReport(ctx, f)
	if err != nil {
		reportError(c, err)
		return nil
	}
	respond(c, rows, totals, f)
	return nil
}

func BankPledgeReport(c echo.Context) error {
	ctx := auth.RequestContext(c)
	f, err := parseFilter(c)
	if err != nil {
		badRequest(c, err)
		return nil
	}
	rows, totals, err := bankPledge(ctx, f)
	if err != nil {
		reportError(c, err)
		return nil
	}
	respond(c, rows, totals, f)
	return nil
}

func LoanExtensionsReport(c echo.Context) error {
	ctx := auth.RequestContext(c)
	f, err := parseFilter(c)
	if err != nil {
		badRequest(c, err)
		return nil
	}
	rows, totals, err := loanExtensions(ctx, f)
	if err != nil {
		reportError(c, err)
		return nil
	}
	respond(c, rows, totals, f)
	return nil
}

func GoldReleaseReport(c echo.Context) error {
	ctx := auth.RequestContext(c)
	f, err := parseFilter(c)
	if err != nil {
		badRequest(c, err)
		return nil
	}
	rows, totals, err := goldRelease(ctx, f)
	if err != nil {
		reportError(c, err)
		return nil
	}
	respond(c, rows, totals, f)
	return nil
}

func AuctionsReport(c echo.Context) error {
	ctx := auth.RequestContext(c)
	f, err := parseFilter(c)
	if err != nil {
		badRequest(c, err)
		return nil
	}
	rows, totals, err := auctionsReport(ctx, f)
	if err != nil {
		reportError(c, err)
		return nil
	}
	respond(c, rows, totals, f)
	return nil
}

func ExpenseCashflowReport(c echo.Context) error {
	ctx := auth.RequestContext(c)
	f, err := parseFilter(c)
	if err != nil {
		badRequest(c, err)
		return nil
	}
	rows, totals, err := expenseCashflow(ctx, f)
	if err != nil {
		reportError(c, err)
		return nil
	}
	respond(c, rows, totals, f)
	return nil
}

func KYCReport(c echo.Context) error {
	ctx := auth.RequestContext(c)
	f, err := parseFilter(c)
	if err != nil {
		badRequest(c, err)
		return nil
	}
	rows, totals, err := kycReport(ctx, f)
	if err != nil {
		reportError(c, err)
		return nil
	}
	respond(c, rows, totals, f)
	return nil
}

func GoldRateHistoryReport(c echo.Context) error {
	ctx := auth.RequestContext(c)
	f, err := parseFilter(c)
	if err != nil {
		badRequest(c, err)
		return nil
	}
	rows, totals, err := goldRateHistory(ctx, f)
	if err != nil {
		reportError(c, err)
		return nil
	}
	respond(c, rows, totals, f)
	return nil
}

func EmployeePerformanceReport(c echo.Context) error {
	ctx := auth.RequestContext(c)
	f, err := parseFilter(c)
	if err != nil {
		badRequest(c, err)
		return nil
	}
	rows, totals, err := employeePerformance(ctx, f)
	if err != nil {
		reportError(c, err)
		return nil
	}
	respond(c, rows, totals, f)
	return nil
}

func PersonalLoansReport(c echo.Context) error {
	ctx := auth.RequestContext(c)
	f, err := parseFilter(c)
	if err != nil {
		badRequest(c, err)
		return nil
	}
	rows, totals, err := personalLoans(ctx, f)
	if err != nil {
		reportError(c, err)
		return nil
	}
	respond(c, rows, totals, f)
	return nil
}

func BalanceSheetReport(c echo.Context) error {
	f, err := parseFilter(c)
	if err != nil {
		badRequest(c, err)
		return nil
	}
	ctx := auth.RequestContext(c)
	rows, totals, err := balanceSheet(ctx, f)
	if err != nil {
		reportError(c, err)
		return nil
	}
	respond(c, rows, totals, f)
	return nil
}

func ProfitAndLossReport(c echo.Context) error {
	f, err := parseFilter(c)
	if err != nil {
		badRequest(c, err)
		return nil
	}
	ctx := auth.RequestContext(c)
	rows, totals, err := profitAndLoss(ctx, f)
	if err != nil {
		reportError(c, err)
		return nil
	}
	respond(c, rows, totals, f)
	return nil
}

func CommunicationHistoryReport(c echo.Context) error {
	ctx := auth.RequestContext(c)
	f, err := parseFilter(c)
	if err != nil {
		badRequest(c, err)
		return nil
	}
	rows, totals, err := communicationHistory(ctx, f, c.QueryParam("trigger_type"))
	if err != nil {
		reportError(c, err)
		return nil
	}
	respond(c, rows, totals, f)
	return nil
}
