package controllers

import (
	"cloudhouse/backend/config"
	"cloudhouse/backend/modules/Reports/models"
	"context"
	"math"
	"strconv"
	"strings"
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
	if len(f.BranchIDs) > 0 {
		q = q.Where("l.branch_id IN ?", f.BranchIDs)
	}
	if len(f.CustomerIDs) > 0 {
		q = q.Where("l.customer_id IN ?", f.CustomerIDs)
	}
	if len(f.OrnamentTypes) > 0 {
		q = q.Where("LOWER(TRIM(o.name)) IN ?", lowerTrimmed(f.OrnamentTypes))
	}
	if len(f.Purities) > 0 {
		// an ornament's purity is stored as "22K" or as a fineness such as "75%", so a picked karat matches both
		purities := append([]string(nil), f.Purities...)
		for _, p := range f.Purities {
			if k, err := strconv.Atoi(strings.TrimSuffix(strings.ToUpper(strings.TrimSpace(p)), "K")); err == nil && k > 0 && k <= 24 {
				purities = append(purities, strconv.FormatFloat(math.Round(float64(k)/24*1000)/10, 'f', -1, 64)+"%")
			}
		}
		q = q.Where("o.purity IN ?", purities)
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
	// Every packet still held (in a locker, pledged, …) plus the ones released
	// within the chosen period — not every packet ever released.
	from, to := dateRange(f)
	q = q.Where("p.status <> ? OR (p.updated_at >= ? AND p.updated_at < ?)", "Released", from, to)
	if len(f.BranchIDs) > 0 {
		q = q.Where("l.branch_id IN ?", f.BranchIDs)
	}
	if len(f.CustomerIDs) > 0 {
		q = q.Where("l.customer_id IN ?", f.CustomerIDs)
	}
	if len(f.LoanIDs) > 0 {
		q = q.Where("l.id IN ?", f.LoanIDs)
	}
	if len(f.Statuses) > 0 {
		q = q.Where("LOWER(TRIM(p.status)) IN ?", lowerTrimmed(f.Statuses))
	}
	if len(f.LockerIDs) > 0 {
		q = q.Where("p.current_locker_id IN ?", f.LockerIDs)
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
	q := config.DB.
		WithContext(ctx).Table("gold_rates").
		Select("date, k24, set_by").
		Where("date >= ? AND date < ?", from, to).
		Order("date desc")
	// set_by is the free-text name a rate was signed with, so it is filtered on the names themselves
	// (picked from GoldRateSetByOptions), not through employee ids.
	if len(f.SetByNames) > 0 {
		q = q.Where("LOWER(TRIM(set_by)) IN ?", lowerTrimmed(f.SetByNames))
	}
	if err := q.Scan(&rows).Error; err != nil {
		return nil, models.GoldRateHistoryTotals{}, err
	}
	return rows, models.GoldRateHistoryTotals{Count: len(rows)}, nil
}
