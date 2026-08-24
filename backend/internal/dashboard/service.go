package dashboard

import "ambikagold/backend/internal/loan"

// NeedsAttentionPageSize is fixed (not caller-adjustable) — matches the
// widget's fixed page size on frontend/components/Dashboard.tsx.
const NeedsAttentionPageSize = 15

// Service builds the dashboard's aggregation feeds directly on top of
// internal/loan's own repositories — the exact same ones loan.Service.List
// and loan.Service.ListRequests already delegate to — so none of loan's
// filtering/status logic is duplicated here.
type Service struct {
	loanRepo    *loan.Repository
	requestRepo *loan.LoanRequestRepository
}

func NewService(loanRepo *loan.Repository, requestRepo *loan.LoanRequestRepository) *Service {
	return &Service{loanRepo: loanRepo, requestRepo: requestRepo}
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
func (s *Service) GetNeedsAttention(page int, branchScope *uint) (*NeedsAttentionResult, error) {
	approvals, err := s.loanRepo.FindAll(loan.LoanFilter{Status: loan.StatusPendingApproval, BranchScope: branchScope})
	if err != nil {
		return nil, err
	}
	requests, err := s.requestRepo.FindAll(loan.LoanRequestFilter{Status: loan.RequestStatusPending, BranchID: branchScope})
	if err != nil {
		return nil, err
	}
	auctions, err := s.loanRepo.FindAll(loan.LoanFilter{
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
