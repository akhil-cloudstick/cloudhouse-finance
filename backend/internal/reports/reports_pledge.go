package reports

import "context"

// Bank-pledge, loan-extension, gold-release, and auction reports.

// BankPledge lists bank pledge records pledged in [from, to], with the
// outstanding (Active) liability summed per the whole matched set — GET
// /reports/bank-pledge.
func (s *Service) BankPledge(ctx context.Context, f Filter) ([]BankPledgeRow, BankPledgeTotals, error) {
	from, to := dateRange(f)
	var rows []BankPledgeRow
	q := s.db.WithContext(ctx).Table("bank_pledge_records r").
		Select(`r.id as record_id, l.loan_number, r.bank_name, r.pledged_amount,
			r.pledge_date, r.release_date, r.status`).
		Joins("LEFT JOIN loans l ON l.id = r.loan_id").
		Where("r.pledge_date >= ? AND r.pledge_date < ?", from, to).
		Order("r.pledge_date desc")
	if f.BranchID != nil {
		q = q.Where("l.branch_id = ?", *f.BranchID)
	}
	if err := q.Scan(&rows).Error; err != nil {
		return nil, BankPledgeTotals{}, err
	}
	// Search before totals, so Totals describe the rows actually shown.
	rows = MatchRows(rows, f.Q)
	totals := BankPledgeTotals{Count: len(rows)}
	for _, r := range rows {
		if r.Status == "Active" {
			totals.OutstandingLiability += r.PledgedAmount
		}
	}
	return rows, totals, nil
}

// LoanExtensions lists Extension-type loan requests raised in [from, to] —
// GET /reports/loan-extensions.
func (s *Service) LoanExtensions(ctx context.Context, f Filter) ([]LoanExtensionRow, LoanExtensionTotals, error) {
	from, to := dateRange(f)
	var rows []LoanExtensionRow
	q := s.db.WithContext(ctx).Table("loan_requests req").
		Select(`req.id as request_id, l.loan_number, req.requested_at,
			req.requested_extension_months as months, req.new_due_date, req.status`).
		Joins("LEFT JOIN loans l ON l.id = req.loan_id").
		Where("req.type = ?", "Extension").
		Where("req.requested_at >= ? AND req.requested_at < ?", from, to).
		Order("req.requested_at desc")
	if f.BranchID != nil {
		q = q.Where("l.branch_id = ?", *f.BranchID)
	}
	if err := q.Scan(&rows).Error; err != nil {
		return nil, LoanExtensionTotals{}, err
	}
	// Search before totals, so Totals describe the rows actually shown.
	rows = MatchRows(rows, f.Q)
	return rows, LoanExtensionTotals{Count: len(rows)}, nil
}

// GoldRelease lists Release-type loan requests raised in [from, to] — GET
// /reports/gold-release.
func (s *Service) GoldRelease(ctx context.Context, f Filter) ([]GoldReleaseRow, GoldReleaseTotals, error) {
	from, to := dateRange(f)
	var rows []GoldReleaseRow
	q := s.db.WithContext(ctx).Table("loan_requests req").
		Select(`req.id as request_id, l.loan_number, c.name as customer_name,
			req.requested_at, req.settlement_amount, req.status`).
		Joins("LEFT JOIN loans l ON l.id = req.loan_id").
		Joins("LEFT JOIN customers c ON c.id = l.customer_id").
		Where("req.type = ?", "Release").
		Where("req.requested_at >= ? AND req.requested_at < ?", from, to).
		Order("req.requested_at desc")
	if f.BranchID != nil {
		q = q.Where("l.branch_id = ?", *f.BranchID)
	}
	if err := q.Scan(&rows).Error; err != nil {
		return nil, GoldReleaseTotals{}, err
	}
	// Search before totals, so Totals describe the rows actually shown.
	rows = MatchRows(rows, f.Q)
	totals := GoldReleaseTotals{Count: len(rows)}
	for _, r := range rows {
		totals.TotalSettlement += r.SettlementAmount
	}
	return rows, totals, nil
}

// Auctions lists auction cases whose eligible-date fell in [from, to] — GET
// /reports/auctions.
func (s *Service) Auctions(ctx context.Context, f Filter) ([]AuctionRow, AuctionTotals, error) {
	from, to := dateRange(f)
	var rows []AuctionRow
	q := s.db.WithContext(ctx).Table("auction_records r").
		Select(`r.id as record_id, l.loan_number, r.stage, r.auction_date, r.sale_amount,
			r.final_settlement_status as settlement_status`).
		Joins("LEFT JOIN loans l ON l.id = r.loan_id").
		Where("r.auction_eligible_date >= ? AND r.auction_eligible_date < ?", from, to).
		Order("r.auction_eligible_date desc")
	if f.BranchID != nil {
		q = q.Where("l.branch_id = ?", *f.BranchID)
	}
	if err := q.Scan(&rows).Error; err != nil {
		return nil, AuctionTotals{}, err
	}
	// Search before totals, so Totals describe the rows actually shown.
	rows = MatchRows(rows, f.Q)
	totals := AuctionTotals{Count: len(rows)}
	for _, r := range rows {
		totals.TotalSaleAmount += r.SaleAmount
	}
	return rows, totals, nil
}
