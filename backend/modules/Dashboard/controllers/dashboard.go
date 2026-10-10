package controllers

import (
	"cloudhouse/backend/auth"
	common "cloudhouse/backend/common/controllers"
	"cloudhouse/backend/modules/Dashboard/models"
	loan "cloudhouse/backend/modules/Loan/controllers"
	loanModels "cloudhouse/backend/modules/Loan/models"
	"context"
	"errors"
	"net/http"
	"strconv"
	"strings"
	"time"

	"github.com/labstack/echo/v4"
	"gorm.io/gorm"
)

type NeedsAttentionFilter struct {
	Query string
	Kind  string
}

func getNeedsAttention(ctx context.Context, page int, branchScope *uint, f NeedsAttentionFilter) (*models.NeedsAttentionResult, error) {
	approvals, _, err := loan.FindLoans(ctx, loan.LoanFilter{Status: loanModels.StatusPendingApproval, BranchScope: branchScope, Query: f.Query})
	if err != nil {
		return nil, err
	}
	requests, _, err := loan.FindLoanRequests(ctx, loan.LoanRequestFilter{Status: loanModels.RequestStatusPending, BranchID: branchScope, Query: f.Query})
	if err != nil {
		return nil, err
	}
	auctions, _, err := loan.FindLoans(ctx, loan.LoanFilter{
		StatusIn:    []string{loanModels.StatusAuctionEligible, "Defaulted"},
		BranchScope: branchScope,
		Query:       f.Query,
	})
	if err != nil {
		return nil, err
	}
	otherApprovals, err := pendingOtherApprovals(ctx, branchScope, f.Query)
	if err != nil {
		return nil, err
	}
	include := func(kind string) bool { return f.Kind == "" || f.Kind == kind }
	items := make([]models.NeedsAttentionItem, 0, len(approvals)+len(otherApprovals)+len(requests)+len(auctions))
	for _, l := range approvals {
		if !include("approvals") {
			break
		}
		items = append(items, models.NeedsAttentionItem{
			Kind:          "approval",
			Flow:          "loan_sanction",
			EntityID:      l.ID,
			LoanID:        l.ID,
			LoanNumber:    l.LoanNumber,
			CustomerName:  l.Customer.Name,
			Principal:     l.PrincipalAmount,
			ApprovalStage: l.ApprovalStage,
		})
	}
	if include("approvals") {
		items = append(items, otherApprovals...)
	}
	for _, r := range requests {
		if !include("requests") {
			break
		}
		items = append(items, models.NeedsAttentionItem{
			Kind:         "request",
			RequestID:    r.ID,
			LoanID:       r.LoanID,
			LoanNumber:   r.Loan.LoanNumber,
			CustomerName: r.Loan.Customer.Name,
			RequestType:  r.Type,
			Detail:       r.Detail,
		})
	}
	for _, l := range auctions {
		if !include("auctions") {
			break
		}
		items = append(items, models.NeedsAttentionItem{
			Kind:         "auction",
			LoanID:       l.ID,
			LoanNumber:   l.LoanNumber,
			CustomerName: l.Customer.Name,
			Outstanding:  l.OutstandingAmount,
			Status:       l.Status,
		})
	}
	if page <= 0 {
		page = 1
	}
	total := len(items)
	start := (page - 1) * 15
	if start > total {
		start = total
	}
	end := start + 15
	if end > total {
		end = total
	}
	return &models.NeedsAttentionResult{
		Items:          items[start:end],
		TotalCount:     total,
		ApprovalsCount: len(approvals) + len(otherApprovals),
		RequestsCount:  len(requests),
		AuctionsCount:  len(auctions),
	}, nil
}

func CaptureDailySnapshot(ctx context.Context) error {
	now := time.Now()
	if _, err := findByDate(ctx, now); err == nil {
		return nil
	}
	active, _, err := loan.FindLoans(ctx, loan.LoanFilter{Status: loanModels.StatusActive})
	if err != nil {
		return err
	}
	overdue, _, err := loan.FindLoans(ctx, loan.LoanFilter{Status: loanModels.StatusOverdue})
	if err != nil {
		return err
	}
	pending, _, err := loan.FindLoans(ctx, loan.LoanFilter{Status: loanModels.StatusPendingApproval})
	if err != nil {
		return err
	}
	openedFrom := time.Date(now.Year(), now.Month(), now.Day(), 0, 0, 0, 0, now.Location())
	openedTo := openedFrom
	openedToday, _, err := loan.FindLoans(ctx, loan.LoanFilter{OpenedFrom: &openedFrom, OpenedTo: &openedTo})
	if err != nil {
		return err
	}
	open, err := loan.FindOpenForCalendar(ctx)
	if err != nil {
		return err
	}
	dueToday := 0
	for _, l := range open {
		if sameDay(l.DueDate, now) {
			dueToday++
		}
	}
	return insertSnapshot(ctx, &models.Snapshot{
		Date:                 openedFrom,
		ActiveCount:          len(active),
		OverdueCount:         len(overdue),
		PendingApprovalCount: len(pending),
		OpenedTodayCount:     len(openedToday),
		DueTodayCount:        dueToday,
	})
}

func sameDay(a, b time.Time) bool {
	return a.Year() == b.Year() && a.Month() == b.Month() && a.Day() == b.Day()
}

func latestSnapshot(ctx context.Context) (*models.Snapshot, error) {
	rec, err := findLatest(ctx)
	if err != nil {
		if errors.Is(err, gorm.ErrRecordNotFound) {
			return nil, nil
		}
		return nil, err
	}
	return rec, nil
}

func listSnapshots(ctx context.Context, limit, offset int) ([]models.Snapshot, int64, error) {
	return findSnapshots(ctx, limit, offset)
}

func GetNeedsAttention(c echo.Context) error {
	ctx := auth.RequestContext(c)
	page, _ := strconv.Atoi(c.QueryParam("page"))
	f := NeedsAttentionFilter{Query: strings.TrimSpace(c.QueryParam("search"))}
	switch k := strings.ToLower(strings.TrimSpace(c.QueryParam("kind"))); k {
	case "":
	case "approvals", "requests", "auctions":
		f.Kind = k
	default:
		return c.JSON(http.StatusBadRequest, echo.Map{"success": false, "error": "invalid kind: expected approvals, requests or auctions"})
	}
	rec, err := getNeedsAttention(ctx, page, auth.GetBranchScope(c), f)
	if err != nil {
		return common.FailErr(c, err)
	}
	return common.Success(c, http.StatusOK, rec)
}

func GetDashboardSummary(c echo.Context) error {
	rec, err := getSummary(auth.RequestContext(c), auth.GetBranchScope(c))
	if err != nil {
		return common.FailErr(c, err)
	}
	return common.Success(c, http.StatusOK, rec)
}

func GetDashboardActivity(c echo.Context) error {
	page, limit, offset := common.PageParams(c)
	if limit == 0 {
		page, limit = 1, 20
	}
	if limit > ActivityMaxLimit {
		limit = ActivityMaxLimit
	}
	rec, err := getActivity(auth.RequestContext(c), auth.GetBranchScope(c), limit, offset)
	if err != nil {
		return common.FailErr(c, err)
	}
	return common.SuccessPage(c, page, limit, rec.Total, rec.Items)
}

func GetLatestSnapshot(c echo.Context) error {
	rec, err := latestSnapshot(auth.RequestContext(c))
	if err != nil {
		return common.FailErr(c, err)
	}
	return common.Success(c, http.StatusOK, rec)
}

func ListSnapshots(c echo.Context) error {
	ctx := auth.RequestContext(c)
	page, limit, offset := common.PageParams(c)
	if limit > 0 {
		rec, total, err := listSnapshots(ctx, limit, offset)
		if err != nil {
			return common.FailErr(c, err)
		}
		return common.SuccessPage(c, page, limit, total, rec)
	}
	rec, _, err := listSnapshots(ctx, 0, 0)
	if err != nil {
		return common.FailErr(c, err)
	}
	return common.SuccessAll(c, rec)
}
