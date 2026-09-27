package reports

import "context"

// Gold-weight, packet-tracking, and gold-rate-history reports.

// GoldWeight lists pledged ornaments for loans opened in [from, to] — GET
// /reports/gold-weight.
func (s *Service) GoldWeight(ctx context.Context, f Filter) ([]GoldWeightRow, GoldWeightTotals, error) {
	from, to := dateRange(f)
	var rows []GoldWeightRow
	q := s.db.WithContext(ctx).Table("ornaments o").
		Select(`o.id as ornament_id, l.loan_number, c.name as customer_name, o.name,
			o.purity, o.gross_weight, o.net_weight, o.gold_value`).
		Joins("LEFT JOIN loans l ON l.id = o.loan_id").
		Joins("LEFT JOIN customers c ON c.id = l.customer_id").
		Where("l.opened_date >= ? AND l.opened_date < ?", from, to).
		Where("l.deleted_at IS NULL").
		Order("l.opened_date desc")
	if f.BranchID != nil {
		q = q.Where("l.branch_id = ?", *f.BranchID)
	}
	if err := q.Scan(&rows).Error; err != nil {
		return nil, GoldWeightTotals{}, err
	}
	// Search before totals, so Totals describe the rows actually shown.
	rows = MatchRows(rows, f.Q)
	var totals GoldWeightTotals
	for _, r := range rows {
		totals.TotalGrossWeight += r.GrossWeight
		totals.TotalNetWeight += r.NetWeight
		totals.TotalGoldValue += r.GoldValue
	}
	return rows, totals, nil
}

// Packets lists tracked packets with their current locker (if any) and
// movement count — GET /reports/packets. Not date-scoped (packet
// tracking/locker occupancy is a current-state view, mirroring
// OutstandingPrincipal's reasoning), but f.BranchID (via the packet's loan)
// still applies.
func (s *Service) Packets(ctx context.Context, f Filter) ([]PacketRow, PacketTotals, error) {
	var rows []PacketRow
	q := s.db.WithContext(ctx).Table("packets p").
		Select(`p.id as packet_id, p.code, l.loan_number, p.status, lk.code as locker_code,
			(SELECT count(*) FROM packet_movements pm WHERE pm.packet_id = p.id) as movement_count`).
		Joins("LEFT JOIN loans l ON l.id = p.loan_id").
		Joins("LEFT JOIN lockers lk ON lk.id = p.current_locker_id").
		Order("p.updated_at desc")
	if f.BranchID != nil {
		q = q.Where("l.branch_id = ?", *f.BranchID)
	}
	if err := q.Scan(&rows).Error; err != nil {
		return nil, PacketTotals{}, err
	}
	// Search before totals, so Totals describe the rows actually shown.
	rows = MatchRows(rows, f.Q)
	totals := PacketTotals{Count: len(rows)}
	for _, r := range rows {
		switch r.Status {
		case "Locker Stored":
			totals.InLocker++
		case "Bank Pledged":
			totals.BankPledged++
		case "Released":
			totals.Released++
		}
	}
	return rows, totals, nil
}

// GoldRateHistory is a plain date-ranged listing of published gold rates —
// GET /reports/gold-rate-history. Not branch-scoped — gold rates aren't a
// per-branch concept.
func (s *Service) GoldRateHistory(ctx context.Context, f Filter) ([]GoldRateHistoryRow, GoldRateHistoryTotals, error) {
	from, to := dateRange(f)
	var rows []GoldRateHistoryRow
	if err := s.db.WithContext(ctx).Table("gold_rates").
		Select("date, k24, set_by").
		Where("date >= ? AND date < ?", from, to).
		Order("date desc").
		Scan(&rows).Error; err != nil {
		return nil, GoldRateHistoryTotals{}, err
	}
	return rows, GoldRateHistoryTotals{Count: len(rows)}, nil
}
