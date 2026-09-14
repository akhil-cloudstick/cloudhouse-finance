package reports

import "context"

// BalanceSheet — Ind AS Division III (NBFC) style statement.

// balanceOpenLoanStatuses mirrors OutstandingPrincipal's "currently open"
// set — a balance sheet's loan-portfolio figures are a point-in-time
// snapshot of open loans, not something reconstructible to an arbitrary
// past date (loans.outstanding_amount/accrued_interest are always "now",
// with no full payment-ledger replay available here).
var balanceOpenLoanStatuses = []string{"Active", "Due Soon", "Overdue", "Defaulted", "Auction Eligible", "Auctioned - Balance Due"}

// BalanceSheet computes the Assets/Liabilities/Equity statement as of
// f.To (f.From is ignored — this is a snapshot, not a range, same
// reasoning as OutstandingPrincipal/Packets) — GET /reports/balance-sheet.
//
// This follows the *shape* of a real NBFC Division III balance sheet
// (Financial vs Non-Financial Assets/Liabilities, with Equity presented
// below Liabilities) — see the reference Ind AS Division III guide this
// was checked against. Several lines have no ledger in this schema to
// source from and report as 0: Debt Securities, Subordinated Liabilities,
// Property/Plant & Equipment, Provisions, Equity Share Capital. "Other
// Equity" is a single computed balancing figure (Total Assets − Total
// Liabilities), not a real reserves/surplus roll-forward — there is no
// equity ledger in this system.
//
// Gold held as collateral (in-house or re-pledged with a bank) is
// deliberately NOT listed as an asset — it belongs to the customer, not
// this company; only the loan receivable against it (already counted
// under Loans & Advances) is this company's asset. An earlier version of
// this report incorrectly carried pledged gold value as an asset line;
// that's the "wrong" this rewrite corrects, alongside adopting the actual
// Division III statement structure instead of an ad hoc grouping.
func (s *Service) BalanceSheet(ctx context.Context, f Filter) ([]BalanceSheetRow, BalanceSheetTotals, error) {
	_, asOf := dateRange(f)

	var rows []BalanceSheetRow
	add := func(label string, amount float64, style string, indent int) {
		rows = append(rows, BalanceSheetRow{Label: label, Amount: amount, Style: style, Indent: indent})
	}
	header := func(label string, indent int) { add(label, 0, "header", indent) }
	line := func(label string, amount float64, indent int) { add(label, amount, "", indent) }
	total := func(label string, amount float64, indent int) { add(label, amount, "total", indent) }

	// Cash & cash equivalents: each branch's most recent
	// OpeningCashBalance on/before asOf, plus that branch's net *cash*
	// movement (mode = "Cash" only) from that balance date through asOf —
	// the same formula cash.SummaryService.GetExpectedCash uses for a
	// single day, extended here over the full [openingDate, asOf] window.
	type cashRow struct {
		OpenAmt      float64
		TotalIn      float64
		TotalOut     float64
		CashExpenses float64
	}
	var cashRows []cashRow
	cq := s.db.WithContext(ctx).Table("opening_cash_balances ocb").
		Select(`ocb.amount as open_amt,
			COALESCE(SUM(CASE WHEN cm.type = 'in' AND cm.mode = 'Cash' THEN cm.amount ELSE 0 END), 0) as total_in,
			COALESCE(SUM(CASE WHEN cm.type = 'out' AND cm.mode = 'Cash' THEN cm.amount ELSE 0 END), 0) as total_out,
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
	var cashInHand float64
	for _, r := range cashRows {
		cashInHand += r.OpenAmt + r.TotalIn - r.TotalOut - r.CashExpenses
	}

	// Bank Balances other than (a): every Bank Transfer/UPI movement ever
	// recorded up to asOf, netted — there's no separate "opening bank
	// balance" ledger the way cash has one, so this assumes the bank
	// balance started at 0 at the dawn of this system's records.
	type netAmt struct{ Value float64 }
	var bank netAmt
	bq := s.db.WithContext(ctx).Table("cash_movements cm").
		Select(`COALESCE(SUM(CASE WHEN cm.type = 'in' THEN cm.amount ELSE -cm.amount END), 0) as value`).
		Where("cm.mode IN ?", []string{"UPI", "Bank Transfer"}).
		Where("cm.occurred_on <= ?", asOf)
	if f.BranchID != nil {
		bq = bq.Where("cm.branch_id = ?", *f.BranchID)
	}
	if err := bq.Scan(&bank).Error; err != nil {
		return nil, BalanceSheetTotals{}, err
	}

	// Loans & Advances (Gold Loans): currently-open loans only.
	type loanTotals struct {
		Outstanding     float64
		AccruedInterest float64
		AccruedPenal    float64
	}
	var lt loanTotals
	lq := s.db.WithContext(ctx).Table("loans l").
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
	loanBook := lt.Outstanding + lt.AccruedInterest + lt.AccruedPenal

	// Borrowings (Other than Debt Securities): the bank OD/loan against
	// gold this company has re-pledged out.
	var borrowings netAmt
	brq := s.db.WithContext(ctx).Table("bank_pledge_records r").
		Select("COALESCE(SUM(r.pledged_amount), 0) as value").
		Joins("LEFT JOIN loans l ON l.id = r.loan_id").
		Where("r.status = ?", "Active")
	if f.BranchID != nil {
		brq = brq.Where("l.branch_id = ?", *f.BranchID)
	}
	if err := brq.Scan(&borrowings).Error; err != nil {
		return nil, BalanceSheetTotals{}, err
	}

	// Payables & Trade Creditors: pending expenses + auction surplus not
	// yet paid out to the customer (empty SurplusDisposition — see
	// AuctionRecord's doc comment: once set it can never change, so this
	// is the exact "still owed" gate, not FinalSettlementStatus).
	var surplusPayable netAmt
	spq := s.db.WithContext(ctx).Table("auction_records r").
		Select("COALESCE(SUM(r.surplus_payable_amount), 0) as value").
		Joins("LEFT JOIN loans l ON l.id = r.loan_id").
		Where("r.surplus_payable_amount > 0").
		Where("r.surplus_disposition = ?", "")
	if f.BranchID != nil {
		spq = spq.Where("l.branch_id = ?", *f.BranchID)
	}
	if err := spq.Scan(&surplusPayable).Error; err != nil {
		return nil, BalanceSheetTotals{}, err
	}

	var pendingExpenses netAmt
	peq := s.db.WithContext(ctx).Table("expenses e").
		Select("COALESCE(SUM(e.amount), 0) as value").
		Where("e.status = ?", "Pending")
	if f.BranchID != nil {
		peq = peq.Where("e.branch_id = ?", *f.BranchID)
	}
	if err := peq.Scan(&pendingExpenses).Error; err != nil {
		return nil, BalanceSheetTotals{}, err
	}
	payables := pendingExpenses.Value + surplusPayable.Value

	// ---- Assemble, in the exact order/labels a Division III statement
	// prints them (see the reference guide's sample balance sheet). ----

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

	totals := BalanceSheetTotals{
		TotalAssets:      totalAssets,
		TotalLiabilities: totalLiabilities,
		TotalEquity:      totalEquity,
	}
	return rows, totals, nil
}
