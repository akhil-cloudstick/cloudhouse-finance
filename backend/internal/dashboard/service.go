package dashboard

import (
	"context"
	"errors"
	"time"

	"gorm.io/gorm"

	"ambikagold/backend/internal/loan"
)
import (
	"errors"
	"time"

	"gorm.io/gorm"

	"ambikagold/backend/internal/loan"
)

// NeedsAttentionPageSize is fixed (not caller-adjustable) — matches the
// widget's fixed page size on frontend/components/Dashboard.tsx.
const NeedsAttentionPageSize = 15

// Service builds the dashboard's aggregation feeds directly on top of
// internal/loan's own repositories — the exact same ones loan.Service.List
// and loan.Service.ListRequests already delegate to — so none of loan's
// filtering/status logic is duplicated here.
type Service struct {
	loanRepo     *loan.Repository
	requestRepo  *loan.LoanRequestRepository
	snapshotRepo *SnapshotRepository
}

func NewService(loanRepo *loan.Repository, requestRepo *loan.LoanRequestRepository, snapshotRepo *SnapshotRepository) *Service {
	return &Service{loanRepo: loanRepo, requestRepo: requestRepo, snapshotRepo: snapshotRepo}
}

// GetNeedsAttention merges pending-approval loans, pending Extension/Release
// requests, and auction-eligible/defaulted loans into one ordered list
// (approvals, then requests, then auctions — the order the widget always
// rendered them in), then paginates over that merged set.
//
// Each source is fetched in full from its own repository rather than pushed
// down as one SQL query, since the three sources have no common table to
// UNION across — the same read-full-then-paginate-in-Go approach
// internal/reports.Paginate already uses for its own cross-table
// aggregations. The counts returned alongside Items are taken from these
// same full fetches, so they are always exact.
func (s *Service) GetNeedsAttention(ctx context.Context, page int, branchScope *uint) (*NeedsAttentionResult, error) {
	approvals, _, err := s.loanRepo.FindAll(ctx, loan.LoanFilter{Status: loan.StatusPendingApproval, BranchScope: branchScope})
	if err != nil {
		return nil, err
	}
	requests, _, err := s.requestRepo.FindAll(ctx, loan.LoanRequestFilter{Status: loan.RequestStatusPending, BranchID: branchScope})
	if err != nil {
		return nil, err
	}
	auctions, _, err := s.loanRepo.FindAll(ctx, loan.LoanFilter{
		StatusIn:    []string{loan.StatusAuctionEligible, loan.StatusDefaulted},
		BranchScope: branchScope,
	})
	if err != nil {
		return nil, err
	}

	items := make([]NeedsAttentionItem, 0, len(approvals)+len(requests)+len(auctions))
	for _, l := range approvals {
		items = append(items, NeedsAttentionItem{
			Kind:          "approval",
			LoanID:        l.ID,
			LoanNumber:    l.LoanNumber,
			CustomerName:  l.Customer.Name,
			Principal:     l.PrincipalAmount,
			ApprovalStage: l.ApprovalStage,
		})
	}
	for _, r := range requests {
		items = append(items, NeedsAttentionItem{
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
		items = append(items, NeedsAttentionItem{
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
	start := (page - 1) * NeedsAttentionPageSize
	if start > total {
		start = total
	}
	end := start + NeedsAttentionPageSize
	if end > total {
		end = total
	}

	return &NeedsAttentionResult{
		Items:          items[start:end],
		TotalCount:     total,
		ApprovalsCount: len(approvals),
		RequestsCount:  len(requests),
		AuctionsCount:  len(auctions),
	}, nil
}

// CaptureDailySnapshot computes today's KPI counts (unscoped — every branch,
// matching what an Administrator's mobile dashboard shows) and writes one
// Snapshot row, unless today's row already exists. Called once/day by the
// background ticker in main.go; the FindByDate guard is what makes "once
// per day" actually hold, since the ticker itself has no fixed-wall-clock-
// time scheduling to lean on.
func (s *Service) CaptureDailySnapshot(ctx context.Context) error {
	now := time.Now()
	if _, err := s.snapshotRepo.FindByDate(now); err == nil {
		return nil // already captured today
	}

	active, _, err := s.loanRepo.FindAll(ctx, loan.LoanFilter{Status: loan.StatusActive})
	if err != nil {
		return err
	}
	overdue, _, err := s.loanRepo.FindAll(ctx, loan.LoanFilter{Status: loan.StatusOverdue})
	if err != nil {
		return err
	}
	pending, _, err := s.loanRepo.FindAll(ctx, loan.LoanFilter{Status: loan.StatusPendingApproval})
	if err != nil {
		return err
	}
	openedFrom := time.Date(now.Year(), now.Month(), now.Day(), 0, 0, 0, 0, now.Location())
	openedTo := openedFrom
	openedToday, _, err := s.loanRepo.FindAll(ctx, loan.LoanFilter{OpenedFrom: &openedFrom, OpenedTo: &openedTo})
	if err != nil {
		return err
	}

	// Due today: every not-yet-closed loan (same set reminder events derive
	// LoanDue from) whose DueDate falls on today.
	open, err := s.loanRepo.FindOpenForCalendar(ctx)
	if err != nil {
		return err
	}
	dueToday := 0
	for _, l := range open {
		if sameDay(l.DueDate, now) {
			dueToday++
		}
	}

	return s.snapshotRepo.Create(&Snapshot{
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

// LatestSnapshot returns the most recently captured snapshot (typically
// "yesterday", since capture runs nightly), or nil if none has been
// captured yet — e.g. the first day after this feature ships, before the
// first nightly job has run.
func (s *Service) LatestSnapshot() (*Snapshot, error) {
	rec, err := s.snapshotRepo.FindLatest()
	if err != nil {
		if errors.Is(err, gorm.ErrRecordNotFound) {
			return nil, nil
		}
		return nil, err
	}
	return rec, nil
}

// ListSnapshots returns captured snapshots history, paginated the same way
// goldrate.Service.List is.
func (s *Service) ListSnapshots(limit, offset int) ([]Snapshot, int64, error) {
	return s.snapshotRepo.FindAll(limit, offset)
}
