package controllers

import (
	"cloudhouse/backend/auth"
	common "cloudhouse/backend/common/controllers"
	"cloudhouse/backend/config"
	"cloudhouse/backend/modules/Reports/models"
	"context"
	"errors"
	"fmt"
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
	// Form G named period (period=q1..q4|annual, year=YYYY) overrides from/to.
	if p := c.QueryParam("period"); p != "" && p != "custom" {
		year := time.Now().Year()
		if y := c.QueryParam("year"); y != "" {
			n, err := strconv.Atoi(y)
			if err != nil || n < 2000 || n > 2200 {
				return models.Filter{}, errors.New("year must be a 4-digit year")
			}
			year = n
		}
		start, end, _, ok := FormGPeriodRange(p, year)
		if !ok {
			return models.Filter{}, errors.New("period must be q1, q2, q3, q4 or annual")
		}
		f.From, f.To, f.PeriodName = &start, &end, p
	}
	// branch_id is one or more comma-separated ids, kept inside the caller's branch scope.
	for _, part := range strings.Split(c.QueryParam("branch_id"), ",") {
		if part = strings.TrimSpace(part); part == "" {
			continue
		}
		id, err := strconv.ParseUint(part, 10, 64)
		if err != nil {
			return models.Filter{}, err
		}
		f.BranchIDs = append(f.BranchIDs, uint(id))
	}
	if scope := auth.GetBranchScope(c); scope != nil {
		for _, id := range f.BranchIDs {
			if id != *scope {
				return models.Filter{}, errors.New("that branch is outside your current branch selection")
			}
		}
		f.BranchIDs = []uint{*scope}
	}
	f.Status = c.QueryParam("status")
	f.Statuses = parseStrList(c.QueryParam("status"))
	idLists := []struct {
		name string
		dst  *[]uint
	}{
		{"customer_id", &f.CustomerIDs}, {"scheme_id", &f.SchemeIDs}, {"loan_id", &f.LoanIDs}, {"bank_id", &f.BankIDs},
		{"employee_id", &f.EmployeeIDs}, {"investor_id", &f.InvestorIDs}, {"plan_id", &f.PlanIDs},
		{"expense_category_id", &f.ExpenseCategoryIDs},
	}
	for _, l := range idLists {
		ids, err := parseIDList(c.QueryParam(l.name))
		if err != nil {
			return models.Filter{}, fmt.Errorf("%s must be one or more comma-separated ids", l.name)
		}
		*l.dst = ids
	}
	f.SetByNames = parseStrList(c.QueryParam("set_by"))
	f.Purities = parseStrList(c.QueryParam("purity"))
	f.PaymentTypes = parseStrList(c.QueryParam("payment_type"))
	f.CollectionModes = parseStrList(c.QueryParam("collection_mode"))
	f.Frequencies = parseStrList(c.QueryParam("frequency"))
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

// parseIDList reads comma-separated ids; blanks are skipped and a bad id is an error.
func parseIDList(raw string) ([]uint, error) {
	var ids []uint
	for _, part := range strings.Split(raw, ",") {
		if part = strings.TrimSpace(part); part == "" {
			continue
		}
		id, err := strconv.ParseUint(part, 10, 64)
		if err != nil {
			return nil, err
		}
		ids = append(ids, uint(id))
	}
	return ids, nil
}

// parseStrList reads comma-separated strings; blanks are skipped.
func parseStrList(raw string) []string {
	var out []string
	for _, part := range strings.Split(raw, ",") {
		if part = strings.TrimSpace(part); part != "" {
			out = append(out, part)
		}
	}
	return out
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
	rows, totals, err := loanStatus(ctx, f, f.Status)
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

// GoldRateSetByOptions lists the distinct names rates were set by, searchable and paged
// (?search=&limit=&offset=), for the Set By filter of the gold-rate-history report.
func GoldRateSetByOptions(c echo.Context) error {
	ctx := auth.RequestContext(c)
	limit, offset := 20, 0
	if n, err := strconv.Atoi(c.QueryParam("limit")); err == nil && n > 0 && n <= 100 {
		limit = n
	}
	if n, err := strconv.Atoi(c.QueryParam("offset")); err == nil && n > 0 {
		offset = n
	}
	q := config.DB.WithContext(ctx).Table("gold_rates").
		Where("set_by IS NOT NULL AND TRIM(set_by) <> ''").
		Distinct("set_by").Order("set_by asc")
	if s := strings.TrimSpace(c.QueryParam("search")); s != "" {
		q = q.Where("LOWER(set_by) LIKE ?", "%"+strings.ToLower(s)+"%")
	}
	var names []string
	// One extra row tells whether another page follows.
	if err := q.Limit(limit+1).Offset(offset).Pluck("set_by", &names).Error; err != nil {
		reportError(c, err)
		return nil
	}
	hasMore := len(names) > limit
	if hasMore {
		names = names[:limit]
	}
	return common.Success(c, http.StatusOK, echo.Map{"items": names, "hasMore": hasMore})
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
