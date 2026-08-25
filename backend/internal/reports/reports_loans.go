package reports

import "gorm.io/gorm"

// Disbursement, loan-status, interest-collection, outstanding-principal, and
// payment-collection reports — all read primarily off `loans`/`loan_payments`.

// Disbursement returns every loan opened in [from, to] whose money has
// actually left the till (branch-scoped if f.BranchID is set) —
// GET /reports/disbursement.
//
// Only loans at approval_stage "Approved" count. Cash-out is recorded solely
// when a loan clears its FINAL sanction stage (see loan.Service.Decide's
// `disbursing` flag), so a loan still moving through the sanction chain — or
// one that was rejected — has had no money paid out and must not be reported
// as disbursed. Without this filter the report counted every loan ever
// created, inflating disbursement totals by the entire pending pipeline.
func (s *Service) Disbursement(f Filter) ([]DisbursementRow, DisbursementTotals, error) {
	from, to := dateRange(f)
	var rows []DisbursementRow
	q := s.db.Table("loans l").
		Select(`l.id as loan_id, l.loan_number, l.opened_date, l.principal_amount as amount,
			b.name as branch_name, c.name as customer_name, sc.name as scheme_name`).
		Joins("LEFT JOIN branches b ON b.id = l.branch_id").
		Joins("LEFT JOIN customers c ON c.id = l.customer_id").
		Joins("LEFT JOIN schemes sc ON sc.id = l.scheme_id").
		Where("l.opened_date >= ? AND l.opened_date < ?", from, to).
		Where("l.approval_stage = ?", "Approved").
		Where("l.deleted_at IS NULL").
		Order("l.opened_date desc")
	if f.BranchID != nil {
		q = q.Where("l.branch_id = ?", *f.BranchID)
	}
	if err := q.Scan(&rows).Error; err != nil {
		return nil, DisbursementTotals{}, err
	}
	totals := DisbursementTotals{Count: len(rows)}
	for _, r := range rows {
		totals.TotalAmount += r.Amount
	}
	return rows, totals, nil
}

// LoanStatus returns loans, optionally filtered to a single status (param
// "status" — one of loan.Status* values), plus a status-count breakdown
// over the SAME date-scoped set (by OpenedDate) — GET /reports/loans/status.
func (s *Service) LoanStatus(f Filter, status string) ([]LoanStatusRow, LoanStatusTotals, error) {
	from, to := dateRange(f)
	newBase := func() *gorm.DB {
		q := s.db.Table("loans l").
			Joins("LEFT JOIN branches b ON b.id = l.branch_id").
			Joins("LEFT JOIN customers c ON c.id = l.customer_id").
			Where("l.opened_date >= ? AND l.opened_date < ?", from, to).
			Where("l.deleted_at IS NULL")
		if f.BranchID != nil {
			q = q.Where("l.branch_id = ?", *f.BranchID)
		}
		return q
	}

	var totals LoanStatusTotals
	type statusCount struct {
		Status string
		Count  int
	}
	var counts []statusCount
	if err := newBase().Select("l.status, count(*) as count").Group("l.status").Scan(&counts).Error; err != nil {
		return nil, LoanStatusTotals{}, err
	}
	for _, c := range counts {
		totals.Count += c.Count
		switch c.Status {
		case "Active":
			totals.Active += c.Count
		case "Closed":
			totals.Closed += c.Count
		case "Due Soon":
			totals.DueSoon += c.Count
		case "Overdue":
			totals.Overdue += c.Count
		case "Defaulted":
			totals.Defaulted += c.Count
		default:
			totals.Other += c.Count
		}
	}

	q := newBase().Select(`l.id as loan_id, l.loan_number, c.name as customer_name, b.name as branch_name,
		l.status, l.outstanding_amount as outstanding, l.due_date`).
		Order("l.due_date asc")
	if status != "" {
		q = q.Where("l.status = ?", status)
	}
	var rows []LoanStatusRow
	if err := q.Scan(&rows).Error; err != nil {
		return nil, LoanStatusTotals{}, err
	}
	return rows, totals, nil
}

// InterestCollection sums interest + penal interest collected per payment
// in [from, to] — GET /reports/interest-collection. Mirrors the same
// underlying figure as loan.Service.GetInterestCollected (sum of
// loan_payments.interest_applied + penal_interest_applied), but per-row
// rather than a single aggregate, since the report needs a listing.
func (s *Service) InterestCollection(f Filter) ([]InterestCollectionRow, InterestCollectionTotals, error) {
	from, to := dateRange(f)
	var rows []InterestCollectionRow
	q := s.db.Table("loan_payments p").
		Select(`p.loan_id, l.loan_number, p.paid_on, p.interest_applied, p.penal_interest_applied as penal_applied, b.name as branch_name`).
		Joins("LEFT JOIN loans l ON l.id = p.loan_id").
		Joins("LEFT JOIN branches b ON b.id = l.branch_id").
		Where("p.paid_on >= ? AND p.paid_on < ?", from, to).
		Where("p.interest_applied > 0 OR p.penal_interest_applied > 0").
		Order("p.paid_on desc")
	if f.BranchID != nil {
		q = q.Where("l.branch_id = ?", *f.BranchID)
	}
	if err := q.Scan(&rows).Error; err != nil {
		return nil, InterestCollectionTotals{}, err
	}
	var totals InterestCollectionTotals
	for _, r := range rows {
		totals.TotalInterest += r.InterestApplied
		totals.TotalPenal += r.PenalApplied
	}
	totals.Total = totals.TotalInterest + totals.TotalPenal
	return rows, totals, nil
}

// OutstandingPrincipal sums outstanding principal across currently-open
// loans (Active/Due Soon/Overdue/Defaulted/Auctioned - Balance Due),
// branch-wise — GET /reports/outstanding-principal. Deliberately NOT
// date-scoped by OpenedDate (an outstanding balance is a point-in-time
// snapshot of currently open loans, not something that happened "in a
// range"); f.BranchID still applies.
func (s *Service) OutstandingPrincipal(f Filter) ([]OutstandingPrincipalRow, OutstandingPrincipalTotals, error) {
	openStatuses := []string{"Active", "Due Soon", "Overdue", "Defaulted", "Auction Eligible", "Auctioned - Balance Due"}
	q := s.db.Table("loans l").
		Select(`b.name as branch_name, count(*) as loan_count, COALESCE(sum(l.outstanding_amount), 0) as outstanding`).
		Joins("LEFT JOIN branches b ON b.id = l.branch_id").
		Where("l.status IN ?", openStatuses).
		Where("l.deleted_at IS NULL").
		Group("b.name")
	if f.BranchID != nil {
		q = q.Where("l.branch_id = ?", *f.BranchID)
	}
	var rows []OutstandingPrincipalRow
	if err := q.Scan(&rows).Error; err != nil {
		return nil, OutstandingPrincipalTotals{}, err
	}
	var totals OutstandingPrincipalTotals
	for _, r := range rows {
		totals.TotalOutstanding += r.Outstanding
		totals.TotalLoans += r.LoanCount
	}
	return rows, totals, nil
}

// PaymentCollection lists loan_payments in [from, to], grouped implicitly by
// date/branch/employee (each row already carries all three for the
// frontend to group/sort as needed) — GET /reports/payment-collection.
func (s *Service) PaymentCollection(f Filter) ([]PaymentCollectionRow, PaymentCollectionTotals, error) {
	from, to := dateRange(f)
	var rows []PaymentCollectionRow
	q := s.db.Table("loan_payments p").
		Select(`p.id as payment_id, l.loan_number, p.paid_on, p.amount, p.type,
			b.name as branch_name, e.name as employee_name`).
		Joins("LEFT JOIN loans l ON l.id = p.loan_id").
		Joins("LEFT JOIN branches b ON b.id = l.branch_id").
		Joins("LEFT JOIN employees e ON e.id = p.received_by_employee_id").
		Where("p.paid_on >= ? AND p.paid_on < ?", from, to).
		Order("p.paid_on desc")
	if f.BranchID != nil {
		q = q.Where("l.branch_id = ?", *f.BranchID)
	}
	if err := q.Scan(&rows).Error; err != nil {
		return nil, PaymentCollectionTotals{}, err
	}
	totals := PaymentCollectionTotals{Count: len(rows)}
	for _, r := range rows {
		totals.TotalAmount += r.Amount
	}
	return rows, totals, nil
}
