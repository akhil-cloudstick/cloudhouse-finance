package controllers

import (
	"cloudhouse/backend/config"
	loanModels "cloudhouse/backend/modules/Loan/models"
	"cloudhouse/backend/modules/Reports/models"
	"context"
	"fmt"
	"strings"
	"time"

	"gorm.io/gorm"
)

func disbursementReport(ctx context.Context, f models.Filter) ([]models.DisbursementRow, models.DisbursementTotals, error) {
	from, to := dateRange(f)
	var rows []models.DisbursementRow
	q := config.DB.
		WithContext(ctx).Table("loans l").
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
		return nil, models.DisbursementTotals{}, err
	}
	rows = MatchRows(rows, f.Q)
	totals := models.DisbursementTotals{Count: len(rows)}
	for _, r := range rows {
		totals.TotalAmount += r.Amount
	}
	return rows, totals, nil
}

// loanStatusValues are the only statuses the loans-status report lists.
var loanStatusValues = []string{"Active", "Due Soon", "Overdue", "Defaulted", "Closed"}

// storedLoanStatusValues are the stored statuses behind those (Defaulted is derived from them).
var storedLoanStatusValues = []string{"Active", "Due Soon", "Overdue", "Closed"}

func loanStatus(ctx context.Context, f models.Filter, status string) ([]models.LoanStatusRow, models.LoanStatusTotals, error) {
	if status != "" {
		valid := false
		for _, s := range loanStatusValues {
			if s == status {
				valid = true
				break
			}
		}
		if !valid {
			return nil, models.LoanStatusTotals{}, fmt.Errorf("status must be one of %s", strings.Join(loanStatusValues, ", "))
		}
	}
	from, to := dateRange(f)
	// Defaulted is not a stored status: an open loan more than DefaultedAfterDays past its due date counts as
	// Defaulted (the same rule as the Loans page filter), whatever status it is stored under.
	defaultedBefore := time.Now().AddDate(0, 0, -loanModels.DefaultedAfterDays)
	effective := "CASE WHEN l.status IN ('Active','Due Soon','Overdue') AND l.due_date < ? THEN 'Defaulted' ELSE l.status END"
	newBase := func() *gorm.DB {
		q := config.DB.
			WithContext(ctx).Table("loans l").
			Joins("LEFT JOIN branches b ON b.id = l.branch_id").
			Joins("LEFT JOIN customers c ON c.id = l.customer_id").
			Where("l.opened_date >= ? AND l.opened_date < ?", from, to).
			Where("l.deleted_at IS NULL").
			Where("l.status IN ?", storedLoanStatusValues)
		if f.BranchID != nil {
			q = q.Where("l.branch_id = ?", *f.BranchID)
		}
		return q
	}
	var totals models.LoanStatusTotals
	type statusCount struct {
		Status string
		Count  int
	}
	var counts []statusCount
	if err := newBase().Select(effective+" as status, count(*) as count", defaultedBefore).Group("1").Scan(&counts).Error; err != nil {
		return nil, models.LoanStatusTotals{}, err
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
		`+effective+` as status, l.outstanding_amount as outstanding, l.due_date`, defaultedBefore).
		Order("l.due_date asc")
	if status != "" {
		q = q.Where("("+effective+") = ?", defaultedBefore, status)
	}
	var rows []models.LoanStatusRow
	if err := q.Scan(&rows).Error; err != nil {
		return nil, models.LoanStatusTotals{}, err
	}
	rows = MatchRows(rows, f.Q)
	return rows, totals, nil
}

func interestCollection(ctx context.Context, f models.Filter) ([]models.InterestCollectionRow, models.InterestCollectionTotals, error) {
	from, to := dateRange(f)
	var rows []models.InterestCollectionRow
	q := config.DB.
		WithContext(ctx).Table("loan_payments p").
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
		return nil, models.InterestCollectionTotals{}, err
	}
	rows = MatchRows(rows, f.Q)
	var totals models.InterestCollectionTotals
	for _, r := range rows {
		totals.TotalInterest += r.InterestApplied
		totals.TotalPenal += r.PenalApplied
	}
	totals.Total = totals.TotalInterest + totals.TotalPenal
	return rows, totals, nil
}

func outstandingPrincipal(ctx context.Context, f models.Filter) ([]models.OutstandingPrincipalRow, models.OutstandingPrincipalTotals, error) {
	openStatuses := []string{"Active", "Due Soon", "Overdue", "Defaulted", "Auction Eligible", "Auctioned - Balance Due"}
	q := config.DB.
		WithContext(ctx).Table("loans l").
		Select(`b.name as branch_name, count(*) as loan_count, COALESCE(sum(l.outstanding_amount), 0) as outstanding`).
		Joins("LEFT JOIN branches b ON b.id = l.branch_id").
		Where("l.status IN ?", openStatuses).
		Where("l.deleted_at IS NULL").
		Group("b.name")
	if f.BranchID != nil {
		q = q.Where("l.branch_id = ?", *f.BranchID)
	}
	var rows []models.OutstandingPrincipalRow
	if err := q.Scan(&rows).Error; err != nil {
		return nil, models.OutstandingPrincipalTotals{}, err
	}
	rows = MatchRows(rows, f.Q)
	var totals models.OutstandingPrincipalTotals
	for _, r := range rows {
		totals.TotalOutstanding += r.Outstanding
		totals.TotalLoans += r.LoanCount
	}
	return rows, totals, nil
}

func paymentCollection(ctx context.Context, f models.Filter) ([]models.PaymentCollectionRow, models.PaymentCollectionTotals, error) {
	from, to := dateRange(f)
	var rows []models.PaymentCollectionRow
	q := config.DB.
		WithContext(ctx).Table("loan_payments p").
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
		return nil, models.PaymentCollectionTotals{}, err
	}
	rows = MatchRows(rows, f.Q)
	totals := models.PaymentCollectionTotals{Count: len(rows)}
	for _, r := range rows {
		totals.TotalAmount += r.Amount
	}
	return rows, totals, nil
}
