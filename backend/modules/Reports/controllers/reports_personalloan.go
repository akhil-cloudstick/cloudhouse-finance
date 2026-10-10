package controllers

import (
	"cloudhouse/backend/config"
	"cloudhouse/backend/modules/Reports/models"
	"context"
)

func personalLoans(ctx context.Context, f models.Filter) ([]models.PersonalLoanRow, models.PersonalLoanTotals, error) {
	from, to := dateRange(f)
	var rows []models.PersonalLoanRow
	q := config.DB.
		WithContext(ctx).Table("personal_loans p").
		Select(`p.id as loan_id, p.loan_number, p.opened_date, p.frequency,
			p.principal_amount, p.disbursed_amount, p.outstanding_amount, p.status,
			b.name as branch_name, c.name as customer_name`).
		Joins("LEFT JOIN branches b ON b.id = p.branch_id").
		Joins("LEFT JOIN customers c ON c.id = p.customer_id").
		Where("p.opened_date >= ? AND p.opened_date < ?", from, to).
		// Loans still awaiting (or refused) approval never disbursed anything.
		Where("p.status NOT IN ?", []string{"Pending Approval", "Rejected"}).
		Where("p.deleted_at IS NULL").
		Order("p.opened_date desc")
	if f.BranchID != nil {
		q = q.Where("p.branch_id = ?", *f.BranchID)
	}
	if err := q.Scan(&rows).Error; err != nil {
		return nil, models.PersonalLoanTotals{}, err
	}
	rows = MatchRows(rows, f.Q)
	totals := models.PersonalLoanTotals{Count: len(rows)}
	for _, r := range rows {
		totals.TotalPrincipal += r.PrincipalAmount
		totals.TotalDisbursed += r.DisbursedAmount
		totals.TotalOutstanding += r.OutstandingAmount
	}
	return rows, totals, nil
}
