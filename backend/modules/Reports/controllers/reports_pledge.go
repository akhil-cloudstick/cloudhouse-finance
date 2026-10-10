package controllers

import (
	"cloudhouse/backend/config"
	"cloudhouse/backend/modules/Reports/models"
	"context"
)

func bankPledge(ctx context.Context, f models.Filter) ([]models.BankPledgeRow, models.BankPledgeTotals, error) {
	from, to := dateRange(f)
	var rows []models.BankPledgeRow
	q := config.DB.
		WithContext(ctx).Table("bank_pledge_records r").
		Select(`r.id as record_id, l.loan_number, r.bank_name, r.pledged_amount,
			r.pledge_date, r.release_date, r.status`).
		Joins("LEFT JOIN loans l ON l.id = r.loan_id").
		Where("r.pledge_date >= ? AND r.pledge_date < ?", from, to).
		Order("r.pledge_date desc")
	if f.BranchID != nil {
		q = q.Where("l.branch_id = ?", *f.BranchID)
	}
	if err := q.Scan(&rows).Error; err != nil {
		return nil, models.BankPledgeTotals{}, err
	}
	rows = MatchRows(rows, f.Q)
	totals := models.BankPledgeTotals{Count: len(rows)}
	for _, r := range rows {
		if r.Status == "Active" {
			totals.OutstandingLiability += r.PledgedAmount
		}
	}
	return rows, totals, nil
}

func loanExtensions(ctx context.Context, f models.Filter) ([]models.LoanExtensionRow, models.LoanExtensionTotals, error) {
	from, to := dateRange(f)
	var rows []models.LoanExtensionRow
	q := config.DB.
		WithContext(ctx).Table("loan_requests req").
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
		return nil, models.LoanExtensionTotals{}, err
	}
	rows = MatchRows(rows, f.Q)
	return rows, models.LoanExtensionTotals{Count: len(rows)}, nil
}

func goldRelease(ctx context.Context, f models.Filter) ([]models.GoldReleaseRow, models.GoldReleaseTotals, error) {
	from, to := dateRange(f)
	var rows []models.GoldReleaseRow
	q := config.DB.
		WithContext(ctx).Table("loan_requests req").
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
		return nil, models.GoldReleaseTotals{}, err
	}
	rows = MatchRows(rows, f.Q)
	totals := models.GoldReleaseTotals{Count: len(rows)}
	for _, r := range rows {
		totals.TotalSettlement += r.SettlementAmount
	}
	return rows, totals, nil
}

func auctionsReport(ctx context.Context, f models.Filter) ([]models.AuctionRow, models.AuctionTotals, error) {
	from, to := dateRange(f)
	var rows []models.AuctionRow
	q := config.DB.
		WithContext(ctx).Table("auction_records r").
		Select(`r.id as record_id, l.loan_number, r.stage, r.auction_date, r.sale_amount,
			r.final_settlement_status as settlement_status`).
		Joins("LEFT JOIN loans l ON l.id = r.loan_id").
		Where("r.auction_eligible_date >= ? AND r.auction_eligible_date < ?", from, to).
		Order("r.auction_eligible_date desc")
	if f.BranchID != nil {
		q = q.Where("l.branch_id = ?", *f.BranchID)
	}
	if err := q.Scan(&rows).Error; err != nil {
		return nil, models.AuctionTotals{}, err
	}
	rows = MatchRows(rows, f.Q)
	totals := models.AuctionTotals{Count: len(rows)}
	for _, r := range rows {
		totals.TotalSaleAmount += r.SaleAmount
	}
	return rows, totals, nil
}
