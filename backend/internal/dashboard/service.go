package dashboard

import (
	"context"
	"errors"
	"time"

	"gorm.io/gorm"

	"cloudhouse/backend/internal/cash"
	"cloudhouse/backend/internal/goldrate"
	"cloudhouse/backend/internal/loan"
	"cloudhouse/backend/internal/platform"
)

// NeedsAttentionPageSize is fixed (not caller-adjustable) — matches the
// widget's fixed page size on frontend/components/Dashboard.tsx.
const NeedsAttentionPageSize = 15

// Service builds the dashboard's aggregation feeds directly on top of
// internal/loan's own repositories — the exact same ones loan.Service.List
// and loan.Service.ListRequests already delegate to — so none of loan's
// filtering/status logic is duplicated here.
//
// db/goldRateRepo/movementRepo back GET /dashboard/summary and
// /dashboard/activity (summary.go): small read-only aggregates over tables
// other modules own, always issued through a model (never raw SQL) so the
// tenant scope still applies.
type Service struct {
	db           platform.DB
	loanRepo     *loan.Repository
	requestRepo  *loan.LoanRequestRepository
	snapshotRepo *SnapshotRepository
	goldRateRepo *goldrate.Repository
	movementRepo *cash.MovementRepository
}

func NewService(db platform.DB, loanRepo *loan.Repository, requestRepo *loan.LoanRequestRepository, snapshotRepo *SnapshotRepository, goldRateRepo *goldrate.Repository, movementRepo *cash.MovementRepository) *Service {
	return &Service{db: db, loanRepo: loanRepo, requestRepo: requestRepo, snapshotRepo: snapshotRepo, goldRateRepo: goldRateRepo, movementRepo: movementRepo}
}

// Needs Attention kinds accepted by NeedsAttentionFilter.Kind (GET
// /dashboard/needs-attention?kind=).
const (
	NeedsAttentionKindApprovals = "approvals"
	NeedsAttentionKindRequests  = "requests"
	NeedsAttentionKindAuctions  = "auctions"
)

// NeedsAttentionFilter narrows GetNeedsAttention.
type NeedsAttentionFilter struct {
	// Query matches loan number or customer name/code in all three sources
	// (pushed into each source's own SQL — see loan.LoanFilter.Query /
	// loan.LoanRequestFilter.Query).
	Query string
	// Kind, when set, keeps only that source's rows in Items/TotalCount.
	// The per-kind counts are still reported for every kind (under the
	// same Query), so the widget's chips keep their numbers.
	Kind string
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
func (s *Service) GetNeedsAttention(ctx context.Context, page int, branchScope *uint, f NeedsAttentionFilter) (*NeedsAttentionResult, error) {
	approvals, _, err := s.loanRepo.FindAll(ctx, loan.LoanFilter{Status: loan.StatusPendingApproval, BranchScope: branchScope, Query: f.Query})
	if err != nil {
		return nil, err
	}
	requests, _, err := s.requestRepo.FindAll(ctx, loan.LoanRequestFilter{Status: loan.RequestStatusPending, BranchID: branchScope, Query: f.Query})
	if err != nil {
		return nil, err
	}
	auctions, _, err := s.loanRepo.FindAll(ctx, loan.LoanFilter{
		StatusIn:    []string{loan.StatusAuctionEligible, loan.StatusDefaulted},
		BranchScope: branchScope,
		Query:       f.Query,
	})
	if err != nil {
		return nil, err
	}

	otherApprovals, err := s.pendingOtherApprovals(ctx, branchScope, f.Query)
	if err != nil {
		return nil, err
	}

	include := func(kind string) bool { return f.Kind == "" || f.Kind == kind }
	items := make([]NeedsAttentionItem, 0, len(approvals)+len(otherApprovals)+len(requests)+len(auctions))
	for _, l := range approvals {
		if !include(NeedsAttentionKindApprovals) {
			break
		}
		items = append(items, NeedsAttentionItem{
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
	if include(NeedsAttentionKindApprovals) {
		items = append(items, otherApprovals...)
	}
	for _, r := range requests {
		if !include(NeedsAttentionKindRequests) {
			break
		}
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
		if !include(NeedsAttentionKindAuctions) {
			break
		}
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
		ApprovalsCount: len(approvals) + len(otherApprovals),
		RequestsCount:  len(requests),
		AuctionsCount:  len(auctions),
	}, nil
}

// CaptureDailySnapshot computes today's KPI counts for ONE business (every
// branch of it, matching what that business's Administrator sees on the
// mobile dashboard) and writes one Snapshot row, unless that business
// already has today's row.
//
// Called hourly per active business by the ticker in internal/app, through
// tenant.ForEachActive; the FindByDate guard is what makes "once per day"
// actually hold, since the ticker has no fixed-wall-clock scheduling to lean
// on. Because both the guard and the write are tenant-scoped, one business
// having captured today says nothing about whether another has.
//
// It previously ran ONCE, under platform.AllowCrossTenant, against a table
// with no tenant_id — so the counts it stored were every business's loans
// added together, and every business's dashboard read that one row. Passing
// a cross-tenant context here again would restore that leak.
func (s *Service) CaptureDailySnapshot(ctx context.Context) error {
	now := time.Now()
	if _, err := s.snapshotRepo.FindByDate(ctx, now); err == nil {
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

	return s.snapshotRepo.Create(ctx, &Snapshot{
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
func (s *Service) LatestSnapshot(ctx context.Context) (*Snapshot, error) {
	rec, err := s.snapshotRepo.FindLatest(ctx)
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
func (s *Service) ListSnapshots(ctx context.Context, limit, offset int) ([]Snapshot, int64, error) {
	return s.snapshotRepo.FindAll(ctx, limit, offset)
}
