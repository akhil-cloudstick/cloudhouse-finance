package reports

// BalanceSheet — Assets / Liabilities / Capital statement.

// balanceOpenLoanStatuses mirrors OutstandingPrincipal's "currently open"
// set — a balance sheet's loan-portfolio figures are a point-in-time
// snapshot of open loans, not something reconstructible to an arbitrary
// past date (loans.outstanding_amount/accrued_interest are always "now",
// with no full payment-ledger replay available here).
var balanceOpenLoanStatuses = []string{"Active", "Due Soon", "Overdue", "Defaulted", "Auction Eligible", "Auctioned - Balance Due"}

// BalanceSheet computes the Assets/Liabilities/Capital statement as of
// f.To (f.From is ignored — this is a snapshot, not a range, same
// reasoning as OutstandingPrincipal/Packets) — GET /reports/balance-sheet.
//
// There's no capital/equity ledger in this schema, so "Capital" is a
// single computed Net Position (Assets − Liabilities) line rather than a
// true owner's-equity breakdown — see BalanceSheetRow's doc comment.
func (s *Service) BalanceSheet(f Filter) ([]BalanceSheetRow, BalanceSheetTotals, error) {
	_, asOf := dateRange(f)

	var rows []BalanceSheetRow
	add := func(section, label string, amount float64) {
		rows = append(rows, BalanceSheetRow{Section: section, Label: label, Amount: amount})
	}

	// ---- Assets ----

	// Cash & Bank: each branch's most recent OpeningCashBalance on/before
	// asOf, plus that branch's net cash movement (in − out − cash
	// expenses) from that balance date through asOf — the same formula
	// cash.SummaryService.GetExpectedCash uses for a single day, extended
	// here over the full [openingDate, asOf] window since a balance sheet
	// needs a running total rather than one day's movement.
	type cashRow struct {
		OpenAmt      float64
		TotalIn      float64
		TotalOut     float64
		CashExpenses float64
	}
	var cashRows []cashRow
	cq := s.db.Table("opening_cash_balances ocb").
		Select(`ocb.amount as open_amt,
			COALESCE(SUM(CASE WHEN cm.type = 'in' THEN cm.amount ELSE 0 END), 0) as total_in,
			COALESCE(SUM(CASE WHEN cm.type = 'out' THEN cm.amount ELSE 0 END), 0) as total_out,
			(SELECT COALESCE(SUM(e.amount), 0) FROM expenses e
				WHERE e.branch_id = ocb.branch_id AND e.mode = 'Cash' AND e.status <> 'Rejected'
				AND e.occurred_on >= ocb.balance_date AND e.occurred_on <= ?) as cash_expenses`, asOf).
		Joins(`LEFT JOIN cash_movements cm ON cm.branch_id = ocb.branch_id
			AND cm.occurred_on >= ocb.balance_date AND cm.occurred_on <= ?`, asOf).
		Where(`ocb.balance_date = (SELECT MAX(o2.balance_date) FROM opening_cash_balances o2
			WHERE o2.branch_id = ocb.branch_id AND o2.balance_date <= ?)`, asOf).
		Group("ocb.branch_id, ocb.amount, ocb.balance_date")
	if f.BranchID != nil {
		cq = cq.Where("ocb.branch_id = ?", *f.BranchID)
	}
	if err := cq.Scan(&cashRows).Error; err != nil {
		return nil, BalanceSheetTotals{}, err
	}
	var cashBalance float64
	for _, r := range cashRows {
		cashBalance += r.OpenAmt + r.TotalIn - r.TotalOut - r.CashExpenses
	}
	add("Assets", "Cash & Bank Balances", cashBalance)

	// Loan Portfolio.
	type loanTotals struct {
		Outstanding     float64
		AccruedInterest float64
		AccruedPenal    float64
	}
	var lt loanTotals
	lq := s.db.Table("loans l").
		Select(`COALESCE(SUM(l.outstanding_amount), 0) as outstanding,
			COALESCE(SUM(l.accrued_interest), 0) as accrued_interest,
			COALESCE(SUM(l.accrued_penal_interest), 0) as accrued_penal`).
		Where("l.status IN ?", balanceOpenLoanStatuses).
		Where("l.deleted_at IS NULL")
	if f.BranchID != nil {
		lq = lq.Where("l.branch_id = ?", *f.BranchID)
	}
	if err := lq.Scan(&lt).Error; err != nil {
		return nil, BalanceSheetTotals{}, err
	}
	add("Assets", "Outstanding Loan Principal", lt.Outstanding)
	add("Assets", "Accrued Interest Receivable", lt.AccruedInterest)
	add("Assets", "Accrued Penal Interest Receivable", lt.AccruedPenal)

	// Gold Held in Custody, split between in-house and bank re-pledged —
	// derived off whether the loan has an Active bank_pledge_records row
	// (the source of truth those loans update off), rather than trusting
	// loans' own bank_pledge_status column's exact string values here.
	type sumValue struct{ Value float64 }
	var inHouse sumValue
	ghq := s.db.Table("ornaments o").
		Select("COALESCE(SUM(o.gold_value), 0) as value").
		Joins("LEFT JOIN loans l ON l.id = o.loan_id").
		Where("l.status IN ?", balanceOpenLoanStatuses).
		Where("l.deleted_at IS NULL").
		Where("NOT EXISTS (SELECT 1 FROM bank_pledge_records r WHERE r.loan_id = l.id AND r.status = 'Active')")
	if f.BranchID != nil {
		ghq = ghq.Where("l.branch_id = ?", *f.BranchID)
	}
	if err := ghq.Scan(&inHouse).Error; err != nil {
		return nil, BalanceSheetTotals{}, err
	}
	add("Assets", "Gold Held In-House (at pledge value)", inHouse.Value)

	var rePledged sumValue
	bpq := s.db.Table("bank_pledge_records r").
		Select("COALESCE(SUM(r.pledged_amount), 0) as value").
		Joins("LEFT JOIN loans l ON l.id = r.loan_id").
		Where("r.status = ?", "Active")
	if f.BranchID != nil {
		bpq = bpq.Where("l.branch_id = ?", *f.BranchID)
	}
	if err := bpq.Scan(&rePledged).Error; err != nil {
		return nil, BalanceSheetTotals{}, err
	}
	add("Assets", "Gold Re-pledged with Banks (right to redeem)", rePledged.Value)

	totalAssets := cashBalance + lt.Outstanding + lt.AccruedInterest + lt.AccruedPenal + inHouse.Value + rePledged.Value

	// ---- Liabilities ----

	// Same figure as the "Gold Re-pledged with Banks" asset line above —
	// the bank's OD/loan against that pledged gold is the liability
	// counterpart to the customer's gold still being tracked as an asset
	// while it sits with the bank.
	add("Liabilities", "Bank Borrowings (OD/loan against re-pledged gold)", rePledged.Value)

	var surplusPayable sumValue
	spq := s.db.Table("auction_records r").
		Select("COALESCE(SUM(r.surplus_payable_amount), 0) as value").
		Joins("LEFT JOIN loans l ON l.id = r.loan_id").
		Where("r.surplus_payable_amount > 0").
		// Empty disposition = not yet paid out (see AuctionRecord's doc
		// comment — once set it can never change, so this is the exact
		// "still owed" gate, not FinalSettlementStatus).
		Where("r.surplus_disposition = ?", "")
	if f.BranchID != nil {
		spq = spq.Where("l.branch_id = ?", *f.BranchID)
	}
	if err := spq.Scan(&surplusPayable).Error; err != nil {
		return nil, BalanceSheetTotals{}, err
	}
	add("Liabilities", "Auction Surplus Payable to Customers", surplusPayable.Value)

	var pendingExpenses sumValue
	peq := s.db.Table("expenses e").
		Select("COALESCE(SUM(e.amount), 0) as value").
		Where("e.status = ?", "Pending")
	if f.BranchID != nil {
		peq = peq.Where("e.branch_id = ?", *f.BranchID)
	}
	if err := peq.Scan(&pendingExpenses).Error; err != nil {
		return nil, BalanceSheetTotals{}, err
	}
	add("Liabilities", "Pending Expenses Payable", pendingExpenses.Value)

	totalLiabilities := rePledged.Value + surplusPayable.Value + pendingExpenses.Value

	// ---- Capital ----

	netPosition := totalAssets - totalLiabilities
	add("Capital", "Net Position (Assets − Liabilities)", netPosition)

	totals := BalanceSheetTotals{
		TotalAssets:      totalAssets,
		TotalLiabilities: totalLiabilities,
		NetPosition:      netPosition,
	}
	return rows, totals, nil
}
