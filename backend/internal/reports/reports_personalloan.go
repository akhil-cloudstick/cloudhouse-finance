package reports

import "context"

// PersonalLoans returns every personal loan opened in [from, to]
// (branch-scoped if f.BranchID is set) — GET /reports/personal-loans.
// Unlike Disbursement (gold loans), there is no sanction-chain
// approval_stage gate here: a personal loan has no multi-stage approval
// chain at all — creation and disbursement happen as one step (see
// personalloan.Service.CreateLoan) — so every row opened in range
// genuinely had cash go out.
func (s *Service) PersonalLoans(ctx context.Context, f Filter) ([]PersonalLoanRow, PersonalLoanTotals, error) {
	from, to := dateRange(f)
	var rows []PersonalLoanRow
	q := s.db.WithContext(ctx).Table("personal_loans p").
		Select(`p.id as loan_id, p.loan_number, p.opened_date, p.frequency,
			p.principal_amount, p.disbursed_amount, p.outstanding_amount, p.status,
			b.name as branch_name, c.name as customer_name`).
		Joins("LEFT JOIN branches b ON b.id = p.branch_id").
		Joins("LEFT JOIN customers c ON c.id = p.customer_id").
		Where("p.opened_date >= ? AND p.opened_date < ?", from, to).
		Where("p.deleted_at IS NULL").
		Order("p.opened_date desc")
	if f.BranchID != nil {
		q = q.Where("p.branch_id = ?", *f.BranchID)
	}
	if err := q.Scan(&rows).Error; err != nil {
		return nil, PersonalLoanTotals{}, err
	}
	// Search before totals, so Totals describe the rows actually shown.
	rows = MatchRows(rows, f.Q)
	totals := PersonalLoanTotals{Count: len(rows)}
	for _, r := range rows {
		totals.TotalPrincipal += r.PrincipalAmount
		totals.TotalDisbursed += r.DisbursedAmount
		totals.TotalOutstanding += r.OutstandingAmount
	}
	return rows, totals, nil
}
