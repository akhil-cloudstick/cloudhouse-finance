package controllers

import (
	"cloudhouse/backend/config"
	"cloudhouse/backend/modules/Reports/models"
	"context"
)

var balanceOpenLoanStatuses = []string{"Active", "Due Soon", "Overdue", "Defaulted", "Auction Eligible", "Auctioned - Balance Due"}

func balanceSheet(ctx context.Context, f models.Filter) ([]models.BalanceSheetRow, models.BalanceSheetTotals, error) {
	_, asOf := dateRange(f)
	var rows []models.BalanceSheetRow
	add := func(label string, amount float64, style string, indent int) {
		rows = append(rows, models.BalanceSheetRow{Label: label, Amount: amount, Style: style, Indent: indent})
	}
	header := func(label string, indent int) { add(label, 0, "header", indent) }
	line := func(label string, amount float64, indent int) { add(label, amount, "", indent) }
	total := func(label string, amount float64, indent int) { add(label, amount, "total", indent) }
	type cashRow struct {
		OpenAmt      float64
		TotalIn      float64
		TotalOut     float64
		CashExpenses float64
	}
	var cashRows []cashRow
	cq := config.DB.
		WithContext(ctx).Table("opening_cash_balances ocb").
		Select(`ocb.amount as open_amt,
			COALESCE(SUM(CASE WHEN cm.type = 'in' AND cm.mode = 'Cash' THEN cm.amount ELSE 0 END), 0) as total_in,
			COALESCE(SUM(CASE WHEN cm.type = 'out' AND cm.mode = 'Cash' THEN cm.amount ELSE 0 END), 0) as total_out,
			(SELECT COALESCE(SUM(e.amount), 0) FROM expenses e
				WHERE e.branch_id = ocb.branch_id AND e.mode = 'Cash' AND e.status = 'Approved'
				AND e.occurred_on >= ocb.balance_date AND e.occurred_on <= ?) as cash_expenses`, asOf).
		Joins(`LEFT JOIN cash_movements cm ON cm.branch_id = ocb.branch_id
			AND cm.occurred_on >= ocb.balance_date AND cm.occurred_on <= ?
			AND cm.expense_id IS NULL`, asOf).
		Where("ocb.mode = ?", "Cash").
		Where(`ocb.balance_date = (SELECT MAX(o2.balance_date) FROM opening_cash_balances o2
			WHERE o2.branch_id = ocb.branch_id AND o2.mode = 'Cash' AND o2.balance_date <= ?)`, asOf).
		Group("ocb.branch_id, ocb.amount, ocb.balance_date")
	if f.BranchID != nil {
		cq = cq.Where("ocb.branch_id = ?", *f.BranchID)
	}
	if err := cq.Scan(&cashRows).Error; err != nil {
		return nil, models.BalanceSheetTotals{}, err
	}
	var cashInHand float64
	for _, r := range cashRows {
		cashInHand += r.OpenAmt + r.TotalIn - r.TotalOut - r.CashExpenses
	}
	type netAmt struct{ Value float64 }
	var bank netAmt
	bq := config.DB.
		WithContext(ctx).Table("cash_movements cm").
		Select(`COALESCE(SUM(CASE WHEN cm.type = 'in' THEN cm.amount ELSE -cm.amount END), 0) as value`).
		Where("cm.mode IN ?", []string{"UPI", "Bank Transfer"}).
		Where("cm.occurred_on <= ?", asOf)
	if f.BranchID != nil {
		bq = bq.Where("cm.branch_id = ?", *f.BranchID)
	}
	if err := bq.Scan(&bank).Error; err != nil {
		return nil, models.BalanceSheetTotals{}, err
	}
	type loanTotals struct {
		Outstanding     float64
		AccruedInterest float64
		AccruedPenal    float64
	}
	var lt loanTotals
	lq := config.DB.
		WithContext(ctx).Table("loans l").
		Select(`COALESCE(SUM(l.outstanding_amount), 0) as outstanding,
			COALESCE(SUM(l.accrued_interest), 0) as accrued_interest,
			COALESCE(SUM(l.accrued_penal_interest), 0) as accrued_penal`).
		Where("l.status IN ?", balanceOpenLoanStatuses).
		Where("l.deleted_at IS NULL")
	if f.BranchID != nil {
		lq = lq.Where("l.branch_id = ?", *f.BranchID)
	}
	if err := lq.Scan(&lt).Error; err != nil {
		return nil, models.BalanceSheetTotals{}, err
	}
	loanBook := lt.Outstanding + lt.AccruedInterest + lt.AccruedPenal
	var borrowings netAmt
	brq := config.DB.
		WithContext(ctx).Table("bank_pledge_records r").
		Select("COALESCE(SUM(r.pledged_amount), 0) as value").
		Joins("LEFT JOIN loans l ON l.id = r.loan_id").
		Where("r.status = ?", "Active")
	if f.BranchID != nil {
		brq = brq.Where("l.branch_id = ?", *f.BranchID)
	}
	if err := brq.Scan(&borrowings).Error; err != nil {
		return nil, models.BalanceSheetTotals{}, err
	}
	var surplusPayable netAmt
	spq := config.DB.
		WithContext(ctx).Table("auction_records r").
		Select("COALESCE(SUM(r.surplus_payable_amount), 0) as value").
		Joins("LEFT JOIN loans l ON l.id = r.loan_id").
		Where("r.surplus_payable_amount > 0").
		Where("r.surplus_disposition = ?", "")
	if f.BranchID != nil {
		spq = spq.Where("l.branch_id = ?", *f.BranchID)
	}
	if err := spq.Scan(&surplusPayable).Error; err != nil {
		return nil, models.BalanceSheetTotals{}, err
	}
	var pendingExpenses netAmt
	peq := config.DB.
		WithContext(ctx).Table("expenses e").
		Select("COALESCE(SUM(e.amount), 0) as value").
		Where("e.status = ?", "Pending")
	if f.BranchID != nil {
		peq = peq.Where("e.branch_id = ?", *f.BranchID)
	}
	if err := peq.Scan(&pendingExpenses).Error; err != nil {
		return nil, models.BalanceSheetTotals{}, err
	}
	payables := pendingExpenses.Value + surplusPayable.Value
	header("I. ASSETS", 0)
	header("(1) Financial Assets", 1)
	line("(a) Cash and cash equivalents", cashInHand, 2)
	line("(b) Bank Balances other than (a) above", bank.Value, 2)
	line("(c) Loans & Advances (Gold Loans)", loanBook, 2)
	line("(d) Other Financial Assets", 0, 2)
	finAssets := cashInHand + bank.Value + loanBook
	total("Total Financial Assets (A)", finAssets, 1)
	header("(2) Non-Financial Assets", 1)
	line("(a) Property, Plant and Equipment", 0, 2)
	line("(b) Other Non-Financial Assets & Taxes", 0, 2)
	total("Total Non-Financial Assets (B)", 0, 1)
	totalAssets := finAssets
	total("TOTAL ASSETS (A + B)", totalAssets, 0)
	header("II. LIABILITIES AND EQUITY", 0)
	header("(1) Financial Liabilities", 1)
	line("(a) Payables & Trade Creditors", payables, 2)
	line("(b) Debt Securities (NCDs)", 0, 2)
	line("(c) Borrowings (Other than Debt Securities)", borrowings.Value, 2)
	line("(d) Subordinated Liabilities", 0, 2)
	totalFinLiab := payables + borrowings.Value
	total("Total Financial Liabilities (A)", totalFinLiab, 1)
	header("(2) Non-Financial Liabilities", 1)
	line("(a) Provisions & Other Liabilities", 0, 2)
	totalNonFinLiab := 0.0
	total("Total Non-Financial Liabilities (B)", totalNonFinLiab, 1)
	totalLiabilities := totalFinLiab + totalNonFinLiab
	header("(3) Equity", 1)
	line("(a) Equity Share Capital", 0, 2)
	otherEquity := totalAssets - totalLiabilities
	line("(b) Other Equity (Reserves & Surplus) — computed, no ledger", otherEquity, 2)
	totalEquity := otherEquity
	total("Total Equity (C)", totalEquity, 1)
	total("TOTAL LIABILITIES AND EQUITY (A + B + C)", totalLiabilities+totalEquity, 0)
	totals := models.BalanceSheetTotals{
		TotalAssets:      totalAssets,
		TotalLiabilities: totalLiabilities,
		TotalEquity:      totalEquity,
	}
	return rows, totals, nil
}
