package controllers

import (
	"cloudhouse/backend/auth"
	common "cloudhouse/backend/common/controllers"
	"cloudhouse/backend/modules/Loan/models"
	"context"
	"net/http"
	"strings"
	"time"

	"github.com/labstack/echo/v4"
)

const RiskLoss RiskLevel = "Loss"

var riskEligibleStatuses = []string{
	models.StatusActive, models.StatusDueSoon, models.StatusOverdue, models.StatusClosureRequested,
	"Defaulted", models.StatusAuctionEligible,
}

type RiskLevel string

type LoanRiskRow struct {
	LoanID            uint      `json:"loan_id"`
	LoanNumber        string    `json:"loan_number"`
	CustomerID        uint      `json:"customer_id"`
	CustomerName      string    `json:"customer_name"`
	Status            string    `json:"status"`
	PrincipalAmount   float64   `json:"principal_amount"`
	OutstandingAmount float64   `json:"outstanding_amount"`
	TotalNetWeight    float64   `json:"total_net_weight"`
	CurrentGoldValue  float64   `json:"current_gold_value"`
	RiskLevel         RiskLevel `json:"risk_level"`
}

type RiskAssessmentFilter struct {
	Status      string
	BranchScope *uint
	RiskLevel   RiskLevel
	OpenedFrom  *time.Time
	OpenedTo    *time.Time
	Query       string
	Limit       int
	Offset      int
}

type RiskAssessmentResult struct {
	Items   []LoanRiskRow
	Total   int
	Counts  map[RiskLevel]int
	HasMore bool
}

func ClassifyRisk(currentGoldValue, principalAmount float64) RiskLevel {
	if currentGoldValue < principalAmount {
		return RiskLoss
	}
	if currentGoldValue < principalAmount*(1+0.10) {
		return RiskAtRisk
	}
	return RiskSafe
}

func listLoanRiskAssessment(ctx context.Context, f RiskAssessmentFilter) (*RiskAssessmentResult, error) {
	rate, err := common.FindLatest(ctx)
	if err != nil {
		return nil, common.NewBadRequest("no gold rate has been published yet")
	}
	lf := LoanFilter{
		BranchScope: f.BranchScope,
		OpenedFrom:  f.OpenedFrom,
		OpenedTo:    f.OpenedTo,
		Query:       f.Query,
	}
	if f.Status != "" {
		lf.Status = f.Status
	} else {
		lf.StatusIn = riskEligibleStatuses
	}
	loans, _, err := FindLoans(ctx, lf)
	if err != nil {
		return nil, err
	}
	rows := make([]LoanRiskRow, 0, len(loans))
	counts := map[RiskLevel]int{RiskLoss: 0, RiskAtRisk: 0, RiskSafe: 0}
	for _, l := range loans {
		var currentValue float64
		for _, o := range l.Ornaments {
			if o.ReleasedAt != nil {
				continue
			}
			r, rErr := rateForPurity(rate, o.Purity)
			if rErr != nil {
				continue
			}
			currentValue += o.NetWeight * r
		}
		level := ClassifyRisk(currentValue, l.OutstandingAmount)
		counts[level]++
		if f.RiskLevel != "" && level != f.RiskLevel {
			continue
		}
		rows = append(rows, LoanRiskRow{
			LoanID:            l.ID,
			LoanNumber:        l.LoanNumber,
			CustomerID:        l.CustomerID,
			CustomerName:      l.Customer.Name,
			Status:            l.Status,
			PrincipalAmount:   l.PrincipalAmount,
			OutstandingAmount: l.OutstandingAmount,
			TotalNetWeight:    l.TotalNetWeight,
			CurrentGoldValue:  currentValue,
			RiskLevel:         level,
		})
	}
	total := len(rows)
	items := rows
	hasMore := false
	if f.Limit > 0 {
		start := f.Offset
		if start > total {
			start = total
		}
		end := start + f.Limit
		if end > total {
			end = total
		}
		items = rows[start:end]
		hasMore = end < total
	}
	return &RiskAssessmentResult{Items: items, Total: total, Counts: counts, HasMore: hasMore}, nil
}

func riskStatusAllowed(status string) bool {
	for _, s := range riskEligibleStatuses {
		if s == status {
			return true
		}
	}
	return false
}

func riskLevelAllowed(v string) bool {
	switch RiskLevel(v) {
	case RiskSafe, RiskAtRisk, RiskLoss:
		return true
	default:
		return false
	}
}

func ListRiskAssessment(c echo.Context) error {
	ctx := auth.RequestContext(c)
	status := c.QueryParam("status")
	riskLevel := c.QueryParam("risk_level")
	page, limit, offset := common.PageParams(c)
	if status != "" && !riskStatusAllowed(status) {
		return c.JSON(http.StatusBadRequest, echo.Map{"success": false, "error": "invalid status"})
	}
	if riskLevel != "" && !riskLevelAllowed(riskLevel) {
		return c.JSON(http.StatusBadRequest, echo.Map{"success": false, "error": "invalid risk_level"})
	}
	from, to, ok := parseOpenedRange(c)
	if !ok {
		return nil
	}
	f := RiskAssessmentFilter{
		Status:      status,
		RiskLevel:   RiskLevel(riskLevel),
		BranchScope: auth.GetBranchScope(c),
		OpenedFrom:  from,
		OpenedTo:    to,
		Query:       strings.TrimSpace(c.QueryParam("search")),
	}
	f.Limit, f.Offset = limit, offset
	result, err := listLoanRiskAssessment(ctx, f)
	if err != nil {
		return common.FailErr(c, err)
	}
	return common.SuccessPage(c, page, limit, int64(result.Total), result.Items, echo.Map{
		"counts": echo.Map{
			"loss":    result.Counts[RiskLoss],
			"at_risk": result.Counts[RiskAtRisk],
			"safe":    result.Counts[RiskSafe],
		},
	})
}
