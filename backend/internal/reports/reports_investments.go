package reports

import (
	"context"

	"gorm.io/gorm"
)

// Deposit register, interest payout register, maturity register and
// investor ledger reports — all read off `investments`/`investment_payouts`/
// `investment_plans` (internal/investment), mirroring reports_loans.go's
// raw Table/Joins/Scan style.

// DepositRegister returns every investment opened in [from, to]
// (branch-scoped if f.BranchID is set) — GET /reports/investments/deposit-register.
func (s *Service) DepositRegister(ctx context.Context, f Filter) ([]DepositRegisterRow, DepositRegisterTotals, error) {
	from, to := dateRange(f)
	var rows []DepositRegisterRow
	q := s.db.WithContext(ctx).Table("investments i").
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
		return nil, DepositRegisterTotals{}, err
	}
	// Search before totals, so Totals describe the rows actually shown.
	rows = MatchRows(rows, f.Q)
	totals := DepositRegisterTotals{Count: len(rows)}
	for _, r := range rows {
		totals.TotalPrincipal += r.PrincipalAmount
	}
	return rows, totals, nil
}

// InterestPayoutRegister returns every payout due in [from, to] (branch-scoped
// if f.BranchID is set) — GET /reports/investments/interest-payout-register.
func (s *Service) InterestPayoutRegister(ctx context.Context, f Filter) ([]InterestPayoutRegisterRow, InterestPayoutRegisterTotals, error) {
	from, to := dateRange(f)
	var rows []InterestPayoutRegisterRow
	q := s.db.WithContext(ctx).Table("investment_payouts ip").
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
		return nil, InterestPayoutRegisterTotals{}, err
	}
	// Search before totals, so Totals describe the rows actually shown.
	rows = MatchRows(rows, f.Q)
	totals := InterestPayoutRegisterTotals{Count: len(rows)}
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

// MaturityRegister returns investments maturing in [from, to] (branch-scoped
// if f.BranchID is set), plus a status breakdown over the same date-scoped
// set — mirrors LoanStatus's status-count pattern (reports_loans.go) —
// GET /reports/investments/maturity-register.
func (s *Service) MaturityRegister(ctx context.Context, f Filter) ([]MaturityRegisterRow, MaturityRegisterTotals, error) {
	from, to := dateRange(f)
	newBase := func() *gorm.DB {
		q := s.db.WithContext(ctx).Table("investments i").
			Joins("LEFT JOIN branches b ON b.id = i.branch_id").
			Joins("LEFT JOIN customers c ON c.id = i.customer_id").
			Where("i.maturity_date >= ? AND i.maturity_date < ?", from, to).
			Where("i.deleted_at IS NULL")
		if f.BranchID != nil {
			q = q.Where("i.branch_id = ?", *f.BranchID)
		}
		return q
	}

	var totals MaturityRegisterTotals
	type statusCount struct {
		Status string
		Count  int
	}
	var counts []statusCount
	if err := newBase().Select("i.status, count(*) as count").Group("i.status").Scan(&counts).Error; err != nil {
		return nil, MaturityRegisterTotals{}, err
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

	var rows []MaturityRegisterRow
	err := newBase().
		Select(`i.id as investment_id, i.investment_number, c.name as customer_name, b.name as branch_name,
			i.principal_amount, i.maturity_date, i.status`).
		Order("i.maturity_date asc").Scan(&rows).Error
	if err != nil {
		return nil, MaturityRegisterTotals{}, err
	}
	return rows, totals, nil
}

// InvestorLedger returns every investment belonging to one investor
// (customerID), newest first — a detail-view statement rather than a
// date-scoped register — GET /reports/investments/investor-ledger.
func (s *Service) InvestorLedger(ctx context.Context, customerID uint) ([]InvestorLedgerRow, InvestorLedgerTotals, error) {
	var rows []InvestorLedgerRow
	err := s.db.WithContext(ctx).Table("investments i").
		Select(`i.id as investment_id, i.investment_number, p.name as plan_name, i.principal_amount,
			i.total_interest_paid, i.start_date, i.maturity_date, i.status`).
		Joins("LEFT JOIN investment_plans p ON p.id = i.plan_id").
		Where("i.customer_id = ?", customerID).
		Where("i.deleted_at IS NULL").
		Order("i.id desc").
		Scan(&rows).Error
	if err != nil {
		return nil, InvestorLedgerTotals{}, err
	}
	totals := InvestorLedgerTotals{Count: len(rows)}
	for _, r := range rows {
		totals.TotalPrincipal += r.PrincipalAmount
		totals.TotalInterestPaid += r.TotalInterestPaid
	}
	return rows, totals, nil
}
