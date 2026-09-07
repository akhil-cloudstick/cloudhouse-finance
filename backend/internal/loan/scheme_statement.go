package loan

import (
	"fmt"
	"net/http"
	"strconv"
	"strings"
	"time"

	"github.com/gin-gonic/gin"

	"ambikagold/backend/internal/platform"
	"ambikagold/backend/internal/platform/httpx"
	"ambikagold/backend/internal/reports"
)

// statementHeaders is the flat, one-row-per-payment shape a scheme statement
// renders as — a loan with no payments in range still gets one row (with
// payment columns blank) so it isn't silently missing from the export.
var statementHeaders = []string{
	"Loan Number", "Customer", "Opened", "Principal", "Payment Date", "Type", "Amount", "Interest", "Principal Applied", "Balance",
}

// SchemeStatement backs GET /schemes/:id/statement?from=&to=&loanIds=&format=pdf|xlsx
// — a downloadable statement of every loan under a scheme (optionally
// narrowed to specific loans) and their payments in the given date range.
// Lives in the loan package rather than internal/scheme because loan.Service
// already depends on the scheme package (a Loan embeds its Scheme) — the
// reverse import would cycle.
func (h *Handler) SchemeStatement(c *gin.Context) {
	ctx := platform.RequestContext(c)
	schemeID, err := httpx.IDParam(c, "id")
	if err != nil {
		httpx.FailErr(c, err)
		return
	}
	from, to, ok := parseOpenedRange(c)
	if !ok {
		return
	}
	format := c.DefaultQuery("format", "pdf")
	if format != "pdf" && format != "xlsx" {
		httpx.Fail(c, http.StatusBadRequest, "format must be pdf or xlsx")
		return
	}

	f := LoanFilter{SchemeID: schemeID, OpenedFrom: from, OpenedTo: to, BranchScope: platform.GetBranchScope(c)}
	if v := c.Query("loanIds"); v != "" {
		for _, part := range strings.Split(v, ",") {
			id, err := strconv.ParseUint(strings.TrimSpace(part), 10, 64)
			if err != nil {
				httpx.Fail(c, http.StatusBadRequest, "invalid loanIds")
				return
			}
			f.LoanIDs = append(f.LoanIDs, uint(id))
		}
	}

	loans, _, err := h.svc.List(ctx, f)
	if err != nil {
		httpx.FailErr(c, err)
		return
	}

	data := statementRows(loans)
	schemeLabel := fmt.Sprintf("scheme-%d", schemeID)
	if len(loans) > 0 {
		schemeLabel = strings.ToLower(strings.ReplaceAll(loans[0].Scheme.Name, " ", "-"))
	}
	filename := fmt.Sprintf("%s-statement-%s.%s", schemeLabel, time.Now().Format("20060102-150405"), format)

	switch format {
	case "xlsx":
		buf, err := reports.BuildXLSX("Statement", statementHeaders, data)
		if err != nil {
			httpx.Fail(c, http.StatusInternalServerError, "could not build statement")
			return
		}
		c.Header("Content-Disposition", "attachment; filename=\""+filename+"\"")
		c.Data(http.StatusOK, "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", buf)
	case "pdf":
		buf, err := reports.BuildPDF("", "Scheme Statement", statementHeaders, data)
		if err != nil {
			httpx.Fail(c, http.StatusInternalServerError, "could not build statement")
			return
		}
		c.Header("Content-Disposition", "attachment; filename=\""+filename+"\"")
		c.Data(http.StatusOK, "application/pdf", buf)
	}
}

// statementRows flattens loans + their nested payments (already preloaded by
// Repository.FindAll) into one row per payment, newest-payment-first within
// each loan — a loan with no payments in range still gets a single row with
// blank payment columns so it isn't silently missing from the statement.
func statementRows(loans []Loan) [][]string {
	var rows [][]string
	for _, l := range loans {
		customerName := ""
		if l.Customer.ID != 0 {
			customerName = l.Customer.Name
		}
		base := []string{l.LoanNumber, customerName, l.OpenedDate.Format("2006-01-02"), fmt.Sprintf("%.2f", l.PrincipalAmount)}
		if len(l.Payments) == 0 {
			rows = append(rows, append(append([]string{}, base...), "", "", "", "", "", ""))
			continue
		}
		for _, p := range l.Payments {
			rows = append(rows, append(append([]string{}, base...),
				p.PaidOn.Format("2006-01-02"),
				p.Type,
				fmt.Sprintf("%.2f", p.Amount),
				fmt.Sprintf("%.2f", p.InterestApplied),
				fmt.Sprintf("%.2f", p.PrincipalApplied),
				fmt.Sprintf("%.2f", p.RunningBalance),
			))
		}
	}
	return rows
}
