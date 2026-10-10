package controllers

import (
	"cloudhouse/backend/auth"
	common "cloudhouse/backend/common/controllers"
	"cloudhouse/backend/config"
	"cloudhouse/backend/modules/Loan/models"
	reports "cloudhouse/backend/modules/Reports/controllers"
	"fmt"
	"net/http"
	"strconv"
	"strings"
	"time"

	"github.com/labstack/echo/v4"
)

var statementHeaders = []string{
	"Loan Number", "Customer", "Opened", "Principal", "Payment Date", "Type", "Amount", "Interest", "Principal Applied", "Balance",
}

func statementRows(loans []models.Loan) [][]string {
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

func SchemeStatement(c echo.Context) error {
	ctx := auth.RequestContext(c)
	schemeID, err := common.IDParam(c, "id")
	if err != nil {
		return common.FailErr(c, err)
	}
	owned, err := config.ExistsInTenant(ctx, config.DB, "schemes", schemeID)
	if err != nil {
		return common.FailErr(c, err)
	}
	if !owned {
		return c.JSON(http.StatusNotFound, echo.Map{"success": false, "error": "scheme not found"})
	}
	from, to, ok := parseOpenedRange(c)
	if !ok {
		return nil
	}
	format := common.DefaultQuery(c, "format", "pdf")
	if format != "pdf" && format != "xlsx" {
		return c.JSON(http.StatusBadRequest, echo.Map{"success": false, "error": "format must be pdf or xlsx"})
	}
	f := LoanFilter{SchemeID: schemeID, OpenedFrom: from, OpenedTo: to, BranchScope: auth.GetBranchScope(c)}
	if v := c.QueryParam("loan_ids"); v != "" {
		for _, part := range strings.Split(v, ",") {
			id, err := strconv.ParseUint(strings.TrimSpace(part), 10, 64)
			if err != nil {
				return c.JSON(http.StatusBadRequest, echo.Map{"success": false, "error": "invalid loanIds"})
			}
			f.LoanIDs = append(f.LoanIDs, uint(id))
		}
	}
	loans, _, err := listLoans(ctx, f)
	if err != nil {
		return common.FailErr(c, err)
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
			return common.FailWith(c, http.StatusBadRequest, "Could not build the statement, please try again", err)
		}
		c.Response().Header().Set("Content-Disposition", "attachment; filename=\""+filename+"\"")
		return c.Blob(http.StatusOK, "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", buf)
	case "pdf":
		buf, err := reports.BuildPDF(businessName(ctx), "Scheme Statement", statementHeaders, data)
		if err != nil {
			return common.FailWith(c, http.StatusBadRequest, "Could not build the statement, please try again", err)
		}
		c.Response().Header().Set("Content-Disposition", "attachment; filename=\""+filename+"\"")
		return c.Blob(http.StatusOK, "application/pdf", buf)
	}
	return nil
}
