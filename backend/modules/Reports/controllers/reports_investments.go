package controllers

import (
	"cloudhouse/backend/config"
	"cloudhouse/backend/modules/Reports/models"
	"context"

	"gorm.io/gorm"
)

func depositRegister(ctx context.Context, f models.Filter) ([]models.DepositRegisterRow, models.DepositRegisterTotals, error) {
	from, to := dateRange(f)
	var rows []models.DepositRegisterRow
	q := config.DB.
		WithContext(ctx).Table("investments i").
		Select(`i.id as investment_id, i.investment_number, i.principal_amount, i.interest_rate_percent as interest_rate,
			i.start_date, i.maturity_date, i.status, b.name as branch_name, c.name as customer_name, p.name as plan_name`).
		Joins("LEFT JOIN branches b ON b.id = i.branch_id").
		Joins("LEFT JOIN customers c ON c.id = i.customer_id").
		Joins("LEFT JOIN investment_plans p ON p.id = i.plan_id").
		Where("i.start_date >= ? AND i.start_date < ?", from, to).
		Where("i.deleted_at IS NULL").
		Order("i.start_date desc")
	if f.BranchID != nil {
		q = q.Where("i.branch_id = ?", *f.BranchID)
	}
	if err := q.Scan(&rows).Error; err != nil {
		return nil, models.DepositRegisterTotals{}, err
	}
	rows = MatchRows(rows, f.Q)
	totals := models.DepositRegisterTotals{Count: len(rows)}
	for _, r := range rows {
		totals.TotalPrincipal += r.PrincipalAmount
	}
	return rows, totals, nil
}

func interestPayoutRegister(ctx context.Context, f models.Filter) ([]models.InterestPayoutRegisterRow, models.InterestPayoutRegisterTotals, error) {
	from, to := dateRange(f)
	var rows []models.InterestPayoutRegisterRow
	q := config.DB.
		WithContext(ctx).Table("investment_payouts ip").
		Select(`i.id as investment_id, i.investment_number, c.name as customer_name,
			ip.sequence_no, ip.due_date, ip.amount, ip.status, ip.paid_at`).
		Joins("JOIN investments i ON i.id = ip.investment_id").
		Joins("LEFT JOIN customers c ON c.id = i.customer_id").
		Where("ip.due_date >= ? AND ip.due_date < ?", from, to).
		Order("ip.due_date asc")
	if f.BranchID != nil {
		q = q.Where("i.branch_id = ?", *f.BranchID)
	}
	if err := q.Scan(&rows).Error; err != nil {
		return nil, models.InterestPayoutRegisterTotals{}, err
	}
	rows = MatchRows(rows, f.Q)
	totals := models.InterestPayoutRegisterTotals{Count: len(rows)}
	for _, r := range rows {
		totals.TotalDue += r.Amount
		if r.Status == "Paid" {
			totals.TotalPaid += r.Amount
		} else {
			totals.TotalPending += r.Amount
		}
	}
	return rows, totals, nil
}

func maturityRegister(ctx context.Context, f models.Filter) ([]models.MaturityRegisterRow, models.MaturityRegisterTotals, error) {
	from, to := dateRange(f)
	newBase := func() *gorm.DB {
		q := config.DB.
			WithContext(ctx).Table("investments i").
			Joins("LEFT JOIN branches b ON b.id = i.branch_id").
			Joins("LEFT JOIN customers c ON c.id = i.customer_id").
			Where("i.maturity_date >= ? AND i.maturity_date < ?", from, to).
			Where("i.deleted_at IS NULL")
		if f.BranchID != nil {
			q = q.Where("i.branch_id = ?", *f.BranchID)
		}
		return q
	}
	var totals models.MaturityRegisterTotals
	type statusCount struct {
		Status string
		Count  int
	}
	var counts []statusCount
	if err := newBase().Select("i.status, count(*) as count").Group("i.status").Scan(&counts).Error; err != nil {
		return nil, models.MaturityRegisterTotals{}, err
	}
	for _, sc := range counts {
		totals.Count += sc.Count
		switch sc.Status {
		case "Active":
			totals.Active += sc.Count
		case "Matured":
			totals.Matured += sc.Count
		case "Closed":
			totals.Closed += sc.Count
		case "Renewed":
			totals.Renewed += sc.Count
		}
	}
	var rows []models.MaturityRegisterRow
	err := newBase().
		Select(`i.id as investment_id, i.investment_number, c.name as customer_name, b.name as branch_name,
			i.principal_amount, i.maturity_date, i.status`).
		Order("i.maturity_date asc").Scan(&rows).Error
	if err != nil {
		return nil, models.MaturityRegisterTotals{}, err
	}
	return rows, totals, nil
}

func investorLedger(ctx context.Context, customerID uint, branchID *uint) ([]models.InvestorLedgerRow, models.InvestorLedgerTotals, error) {
	var rows []models.InvestorLedgerRow
	q := config.DB.
		WithContext(ctx).Table("investments i")
	if branchID != nil {
		q = q.Where("i.branch_id = ?", *branchID)
	}
	err := q.
		Select(`i.id as investment_id, i.investment_number, p.name as plan_name, i.principal_amount,
			i.total_interest_paid, i.start_date, i.maturity_date, i.status`).
		Joins("LEFT JOIN investment_plans p ON p.id = i.plan_id").
		Where("i.customer_id = ?", customerID).
		Where("i.deleted_at IS NULL").
		Order("i.id desc").
		Scan(&rows).Error
	if err != nil {
		return nil, models.InvestorLedgerTotals{}, err
	}
	totals := models.InvestorLedgerTotals{Count: len(rows)}
	for _, r := range rows {
		totals.TotalPrincipal += r.PrincipalAmount
		totals.TotalInterestPaid += r.TotalInterestPaid
	}
	return rows, totals, nil
}
