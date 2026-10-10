package controllers

import (
	"cloudhouse/backend/config"
	"cloudhouse/backend/modules/Reports/models"
	"context"
)

func goldWeight(ctx context.Context, f models.Filter) ([]models.GoldWeightRow, models.GoldWeightTotals, error) {
	from, to := dateRange(f)
	var rows []models.GoldWeightRow
	q := config.DB.
		WithContext(ctx).Table("ornaments o").
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
		return nil, models.GoldWeightTotals{}, err
	}
	rows = MatchRows(rows, f.Q)
	var totals models.GoldWeightTotals
	for _, r := range rows {
		totals.TotalGrossWeight += r.GrossWeight
		totals.TotalNetWeight += r.NetWeight
		totals.TotalGoldValue += r.GoldValue
	}
	return rows, totals, nil
}

func packetsReport(ctx context.Context, f models.Filter) ([]models.PacketRow, models.PacketTotals, error) {
	var rows []models.PacketRow
	q := config.DB.
		WithContext(ctx).Table("packets p").
		Select(`p.id as packet_id, p.code, l.loan_number, p.status, lk.code as locker_code,
			(SELECT count(*) FROM packet_movements pm WHERE pm.packet_id = p.id) as movement_count`).
		Joins("LEFT JOIN loans l ON l.id = p.loan_id").
		Joins("LEFT JOIN lockers lk ON lk.id = p.current_locker_id").
		Order("p.updated_at desc")
	if f.BranchID != nil {
		q = q.Where("l.branch_id = ?", *f.BranchID)
	}
	if err := q.Scan(&rows).Error; err != nil {
		return nil, models.PacketTotals{}, err
	}
	rows = MatchRows(rows, f.Q)
	totals := models.PacketTotals{Count: len(rows)}
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

func goldRateHistory(ctx context.Context, f models.Filter) ([]models.GoldRateHistoryRow, models.GoldRateHistoryTotals, error) {
	from, to := dateRange(f)
	var rows []models.GoldRateHistoryRow
	if err := config.DB.
		WithContext(ctx).Table("gold_rates").
		Select("date, k24, set_by").
		Where("date >= ? AND date < ?", from, to).
		Order("date desc").
		Scan(&rows).Error; err != nil {
		return nil, models.GoldRateHistoryTotals{}, err
	}
	return rows, models.GoldRateHistoryTotals{Count: len(rows)}, nil
}
