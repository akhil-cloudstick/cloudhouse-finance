package reports

import "sort"

// TradeSheet — gold movement/stock ledger.

// TradeSheet combines every gold-stock movement in [from, to] into one
// chronological ledger (Pledge In, Release Out, Re-pledge to Bank, Bank
// Release, Auction Out), plus closing-stock totals grouped by purity — GET
// /reports/trade-sheet.
//
// There's no single "gold movement" table to query — each event type lives
// in a different table (ornaments, loans/loan_payments, bank_pledge_records,
// auction_records) — so this runs one query per event type and combines the
// results in Go, rather than a raw-SQL UNION across differently-shaped
// tables (fragile, and this package's other reports don't do it either).
func (s *Service) TradeSheet(f Filter) ([]TradeSheetRow, TradeSheetTotals, error) {
	from, to := dateRange(f)
	var rows []TradeSheetRow

	// Pledge In — every ornament pledged against a loan opened in range.
	var pledgeIn []TradeSheetRow
	q1 := s.db.Table("ornaments o").
		Select(`l.opened_date as date, l.loan_number as reference, ? as type,
			c.name as party, o.purity, o.net_weight, o.gold_value as value, b.name as branch_name`,
			"Pledge In").
		Joins("LEFT JOIN loans l ON l.id = o.loan_id").
		Joins("LEFT JOIN customers c ON c.id = l.customer_id").
		Joins("LEFT JOIN branches b ON b.id = l.branch_id").
		Where("l.opened_date >= ? AND l.opened_date < ?", from, to).
		Where("l.deleted_at IS NULL")
	if f.BranchID != nil {
		q1 = q1.Where("l.branch_id = ?", *f.BranchID)
	}
	if err := q1.Scan(&pledgeIn).Error; err != nil {
		return nil, TradeSheetTotals{}, err
	}
	rows = append(rows, pledgeIn...)

	// Release Out — ornaments belonging to a now-Closed loan. loans carries
	// no ReleasedAt/ClosedAt column and there's no separate status-history
	// table, so the loan's last payment date stands in as "when the gold
	// went out" — the closest available proxy.
	var releaseOut []TradeSheetRow
	q2 := s.db.Table("ornaments o").
		Select(`(SELECT MAX(p.paid_on) FROM loan_payments p WHERE p.loan_id = l.id) as date,
			l.loan_number as reference, ? as type, c.name as party, o.purity, o.net_weight,
			o.gold_value as value, b.name as branch_name`, "Release Out").
		Joins("LEFT JOIN loans l ON l.id = o.loan_id").
		Joins("LEFT JOIN customers c ON c.id = l.customer_id").
		Joins("LEFT JOIN branches b ON b.id = l.branch_id").
		Where("l.status = ?", "Closed").
		Where("l.deleted_at IS NULL")
	if f.BranchID != nil {
		q2 = q2.Where("l.branch_id = ?", *f.BranchID)
	}
	if err := q2.Scan(&releaseOut).Error; err != nil {
		return nil, TradeSheetTotals{}, err
	}
	for _, r := range releaseOut {
		if r.Date.IsZero() || r.Date.Before(from) || !r.Date.Before(to) {
			continue
		}
		rows = append(rows, r)
	}

	// Re-pledge to Bank / Bank Release — bank_pledge_records pledges the
	// loan's gold as a whole, not itemized per ornament, so these rows
	// carry no Purity/NetWeight; Value is the pledge amount.
	var rePledge []TradeSheetRow
	q3 := s.db.Table("bank_pledge_records r").
		Select(`r.pledge_date as date, l.loan_number as reference, ? as type,
			r.bank_name as party, '' as purity, 0 as net_weight, r.pledged_amount as value,
			b.name as branch_name`, "Re-pledge to Bank").
		Joins("LEFT JOIN loans l ON l.id = r.loan_id").
		Joins("LEFT JOIN branches b ON b.id = l.branch_id").
		Where("r.pledge_date >= ? AND r.pledge_date < ?", from, to)
	if f.BranchID != nil {
		q3 = q3.Where("l.branch_id = ?", *f.BranchID)
	}
	if err := q3.Scan(&rePledge).Error; err != nil {
		return nil, TradeSheetTotals{}, err
	}
	rows = append(rows, rePledge...)

	var bankRelease []TradeSheetRow
	q4 := s.db.Table("bank_pledge_records r").
		Select(`r.release_date as date, l.loan_number as reference, ? as type,
			r.bank_name as party, '' as purity, 0 as net_weight, r.pledged_amount as value,
			b.name as branch_name`, "Bank Release").
		Joins("LEFT JOIN loans l ON l.id = r.loan_id").
		Joins("LEFT JOIN branches b ON b.id = l.branch_id").
		Where("r.release_date IS NOT NULL AND r.release_date >= ? AND r.release_date < ?", from, to)
	if f.BranchID != nil {
		q4 = q4.Where("l.branch_id = ?", *f.BranchID)
	}
	if err := q4.Scan(&bankRelease).Error; err != nil {
		return nil, TradeSheetTotals{}, err
	}
	rows = append(rows, bankRelease...)

	// Auction Out — an auctioned lot is settled as a whole, so the loan's
	// total net weight stands in for itemized per-ornament purity (a
	// mixed-purity lot doesn't reduce to one purity string either way).
	var auctionOut []TradeSheetRow
	q5 := s.db.Table("auction_records r").
		Select(`r.auction_date as date, l.loan_number as reference, ? as type,
			c.name as party, '' as purity, l.total_net_weight as net_weight, r.sale_amount as value,
			b.name as branch_name`, "Auction Out").
		Joins("LEFT JOIN loans l ON l.id = r.loan_id").
		Joins("LEFT JOIN customers c ON c.id = l.customer_id").
		Joins("LEFT JOIN branches b ON b.id = l.branch_id").
		Where("r.auction_date IS NOT NULL AND r.auction_date >= ? AND r.auction_date < ?", from, to)
	if f.BranchID != nil {
		q5 = q5.Where("l.branch_id = ?", *f.BranchID)
	}
	if err := q5.Scan(&auctionOut).Error; err != nil {
		return nil, TradeSheetTotals{}, err
	}
	rows = append(rows, auctionOut...)

	sort.Slice(rows, func(i, j int) bool { return rows[i].Date.Before(rows[j].Date) })

	// Rate/g is derived per row (value ÷ weight) rather than looked up
	// against gold_rates — the bank-pledge/auction rows above carry no
	// weight to divide by, and resolving a rate for an arbitrary purity
	// string needs internal/loan's purity resolution, which this package
	// deliberately avoids importing (see model.go's package doc).
	for i := range rows {
		if rows[i].NetWeight > 0 {
			rows[i].Rate = rows[i].Value / rows[i].NetWeight
		}
	}

	totals := TradeSheetTotals{}
	byPurity := map[string]float64{}
	for _, r := range rows {
		totals.TotalValue += r.Value
		if r.Purity == "" {
			// Re-pledge/auction rows carry no weight to net against
			// closing stock — see the comments above.
			continue
		}
		switch r.Type {
		case "Pledge In":
			byPurity[r.Purity] += r.NetWeight
		case "Release Out":
			byPurity[r.Purity] -= r.NetWeight
		}
	}
	for p, w := range byPurity {
		totals.ClosingStockByPurity = append(totals.ClosingStockByPurity, PurityStock{Purity: p, NetWeight: w})
	}
	sort.Slice(totals.ClosingStockByPurity, func(i, j int) bool {
		return totals.ClosingStockByPurity[i].Purity < totals.ClosingStockByPurity[j].Purity
	})

	return rows, totals, nil
}
