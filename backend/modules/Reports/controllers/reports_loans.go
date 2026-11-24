package controllers

import (
	"cloudhouse/backend/config"
	"cloudhouse/backend/modules/Reports/models"
	"context"
	"fmt"
	"sort"
	"strings"
	"time"
)

// ListLoanStatusRows lists loans the way the Loans page does (same listing, same read-time status). The Loan module
// sets it at start-up: Loan already depends on Reports through Cash, so Reports cannot import Loan directly.
var ListLoanStatusRows = func(ctx context.Context, branchIDs, customerIDs []uint, from, to *time.Time) ([]models.LoanStatusRow, error) {
	return nil, nil
}

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
	if len(f.BranchIDs) > 0 {
		q = q.Where("l.branch_id IN ?", f.BranchIDs)
	}
	if len(f.CustomerIDs) > 0 {
		q = q.Where("l.customer_id IN ?", f.CustomerIDs)
	}
	if len(f.SchemeIDs) > 0 {
		q = q.Where("l.scheme_id IN ?", f.SchemeIDs)
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

// status is one or more comma-separated statuses; empty means every status.
func containsString(list []string, v string) bool {
	for _, s := range list {
		if s == v {
			return true
		}
	}
	return false
}

func loanStatus(ctx context.Context, f models.Filter, status string) ([]models.LoanStatusRow, models.LoanStatusTotals, error) {
	var statuses []string
	for _, st := range strings.Split(status, ",") {
		if st = strings.TrimSpace(st); st == "" {
			continue
		}
		valid := false
		for _, s := range loanStatusValues {
			if s == st {
				valid = true
				break
			}
		}
		if !valid {
			return nil, models.LoanStatusTotals{}, fmt.Errorf("status must be one of %s", strings.Join(loanStatusValues, ", "))
		}
		statuses = append(statuses, st)
	}
	// Listed through the Loans page's own listing, so a loan reads as Overdue / Defaulted / … here exactly as it does
	// there (the status saved on a loan can lag, so it is not used).
	all, err := ListLoanStatusRows(ctx, f.BranchIDs, f.CustomerIDs, f.From, f.To)
	if err != nil {
		return nil, models.LoanStatusTotals{}, err
	}
	var totals models.LoanStatusTotals
	var rows []models.LoanStatusRow
	for _, r := range all {
		totals.Count++
		switch r.Status {
		case "Active":
			totals.Active++
		case "Closed":
			totals.Closed++
		case "Due Soon":
			totals.DueSoon++
		case "Overdue":
			totals.Overdue++
		case "Defaulted":
			totals.Defaulted++
		default:
			totals.Other++
		}
		if len(statuses) == 0 || containsString(statuses, r.Status) {
			rows = append(rows, r)
		}
	}
	sort.SliceStable(rows, func(i, j int) bool { return rows[i].DueDate.Before(rows[j].DueDate) })
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
	if len(f.BranchIDs) > 0 {
		q = q.Where("l.branch_id IN ?", f.BranchIDs)
	}
	if len(f.CustomerIDs) > 0 {
		q = q.Where("l.customer_id IN ?", f.CustomerIDs)
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
	if len(f.BranchIDs) > 0 {
		q = q.Where("l.branch_id IN ?", f.BranchIDs)
	}
	if len(f.CustomerIDs) > 0 {
		q = q.Where("l.customer_id IN ?", f.CustomerIDs)
	}
	if len(f.PaymentTypes) > 0 {
		q = q.Where("p.type IN ?", f.PaymentTypes)
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
