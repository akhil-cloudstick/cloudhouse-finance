package reports

// ProfitAndLoss — Statement of Profit and Loss.

// ProfitAndLoss computes the Statement of Profit and Loss for [f.From,
// f.To] — GET /reports/profit-loss. Unlike BalanceSheet, this IS a
// date-ranged report (a P&L is a period statement, "for the year ended",
// not a snapshot).
//
// Follows the Ind AS Division III NBFC layout (Interest Income first, no
// trading account/gross profit) — see the reference Ind AS Division III
// guide's sample P&L. Several lines have nothing to source from in this
// schema and report as 0: Finance Costs, Fees and Commission Expense,
// Impairment/ECL Provision, Employee Benefits Expense, Depreciation, and
// both tax lines — this system tracks branch expenses as one undivided
// ledger (no cost-category taxonomy reliable enough to split those out)
// and has no fixed-asset register, ECL model, or tax computation.
// "Interest Income"/"Fees and Commission Income" here are amounts actually
// *collected* in the period (this system's only income ledger is
// loan_payments), not period-end accrual recognition.
func (s *Service) ProfitAndLoss(f Filter) ([]ProfitLossRow, ProfitLossTotals, error) {
	from, to := dateRange(f)

	var rows []ProfitLossRow
	add := func(label string, amount float64, style string, indent int) {
		rows = append(rows, ProfitLossRow{Label: label, Amount: amount, Style: style, Indent: indent})
	}
	header := func(label string, indent int) { add(label, 0, "header", indent) }
	line := func(label string, amount float64, indent int) { add(label, amount, "", indent) }
	total := func(label string, amount float64, indent int) { add(label, amount, "total", indent) }

	type incomeTotals struct {
		Interest float64
		Fees     float64
		Penal    float64
	}
	var it incomeTotals
	iq := s.db.Table("loan_payments p").
		Select(`COALESCE(SUM(p.interest_applied), 0) as interest,
			COALESCE(SUM(p.processing_fee_applied), 0) as fees,
			COALESCE(SUM(p.penal_interest_applied), 0) as penal`).
		Joins("LEFT JOIN loans l ON l.id = p.loan_id").
		Where("p.paid_on >= ? AND p.paid_on < ?", from, to)
	if f.BranchID != nil {
		iq = iq.Where("l.branch_id = ?", *f.BranchID)
	}
	if err := iq.Scan(&it).Error; err != nil {
		return nil, ProfitLossTotals{}, err
	}

	// Other Income: auction surplus this company kept as income
	// (disposition "RecordedAsIncome" — the other disposition, refunded
	// to the customer, is never this company's income).
	type sumValue struct{ Value float64 }
	var oi sumValue
	oq := s.db.Table("auction_records r").
		Select("COALESCE(SUM(r.surplus_payable_amount), 0) as value").
		Joins("LEFT JOIN loans l ON l.id = r.loan_id").
		Where("r.surplus_disposition = ?", "RecordedAsIncome").
		Where("r.auction_date >= ? AND r.auction_date < ?", from, to)
	if f.BranchID != nil {
		oq = oq.Where("l.branch_id = ?", *f.BranchID)
	}
	if err := oq.Scan(&oi).Error; err != nil {
		return nil, ProfitLossTotals{}, err
	}

	// Other Expenses: every approved expense in the period — this
	// system's only expense ledger.
	var oe sumValue
	eq := s.db.Table("expenses e").
		Select("COALESCE(SUM(e.amount), 0) as value").
		Where("e.status = ?", "Approved").
		Where("e.occurred_on >= ? AND e.occurred_on < ?", from, to)
	if f.BranchID != nil {
		eq = eq.Where("e.branch_id = ?", *f.BranchID)
	}
	if err := eq.Scan(&oe).Error; err != nil {
		return nil, ProfitLossTotals{}, err
	}

	header("I. Revenue from Operations", 0)
	line("(a) Interest Income", it.Interest, 1)
	line("(b) Fees and Commission Income", it.Fees, 1)
	line("(c) Other Operating Income (Penalties)", it.Penal, 1)
	revenueFromOps := it.Interest + it.Fees + it.Penal
	total("Total Revenue from Operations (I)", revenueFromOps, 0)

	total("II. Other Income", oi.Value, 0)

	totalIncome := revenueFromOps + oi.Value
	total("III. Total Income (I + II)", totalIncome, 0)

	header("IV. Expenses", 0)
	line("(a) Finance Costs", 0, 1)
	line("(b) Fees and Commission Expense", 0, 1)
	line("(c) Impairment on Financial Instruments (ECL Provision)", 0, 1)
	line("(d) Employee Benefits Expense", 0, 1)
	line("(e) Depreciation, Amortisation and Impairment", 0, 1)
	line("(f) Other Expenses", oe.Value, 1)
	totalExpenses := oe.Value
	total("Total Expenses (IV)", totalExpenses, 0)

	pbt := totalIncome - totalExpenses
	total("V. Profit Before Tax (III - IV)", pbt, 0)

	header("VI. Tax Expense", 0)
	line("(a) Current Tax", 0, 1)
	line("(b) Deferred Tax", 0, 1)

	profitForPeriod := pbt
	total("VII. Profit for the Period (V - VI)", profitForPeriod, 0)

	totals := ProfitLossTotals{
		TotalIncome:     totalIncome,
		TotalExpenses:   totalExpenses,
		ProfitForPeriod: profitForPeriod,
	}
	return rows, totals, nil
}
