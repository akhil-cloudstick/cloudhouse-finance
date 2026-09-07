package reports

import (
	"context"
	"time"

	"ambikagold/backend/internal/commlog"
)

// Expense-cashflow, KYC, employee-performance, and communication-history
// reports.

// ExpenseCashflow buckets cash movements/expenses per (day, branch) over
// [from, to] — GET /reports/expense-cashflow. Same underlying figures as
// cash.SummaryService.GetExpectedCash (collections/disbursements/cash
// expenses), extended to a date range instead of a single day.
func (s *Service) ExpenseCashflow(ctx context.Context, f Filter) ([]ExpenseCashflowRow, ExpenseCashflowTotals, error) {
	from, to := dateRange(f)

	type movementRow struct {
		Date       time.Time
		BranchName string
		BranchID   *uint
		Type       string
		Amount     float64
	}
	mq := s.db.WithContext(ctx).Table("cash_movements m").
		Select(`date(m.occurred_on) as date, b.name as branch_name, m.branch_id, m.type,
			COALESCE(sum(m.amount), 0) as amount`).
		Joins("LEFT JOIN branches b ON b.id = m.branch_id").
		Where("m.occurred_on >= ? AND m.occurred_on < ?", from, to).
		Group("date(m.occurred_on), b.name, m.branch_id, m.type")
	if f.BranchID != nil {
		mq = mq.Where("m.branch_id = ?", *f.BranchID)
	}
	var movements []movementRow
	if err := mq.Scan(&movements).Error; err != nil {
		return nil, ExpenseCashflowTotals{}, err
	}

	type expenseRow struct {
		Date       time.Time
		BranchName string
		BranchID   uint
		Amount     float64
	}
	eq := s.db.WithContext(ctx).Table("expenses e").
		Select(`date(e.occurred_on) as date, b.name as branch_name, e.branch_id,
			COALESCE(sum(e.amount), 0) as amount`).
		Joins("LEFT JOIN branches b ON b.id = e.branch_id").
		Where("e.occurred_on >= ? AND e.occurred_on < ?", from, to).
		Where("e.mode = ?", "Cash").
		Where("e.status <> ?", "Rejected").
		Group("date(e.occurred_on), b.name, e.branch_id")
	if f.BranchID != nil {
		eq = eq.Where("e.branch_id = ?", *f.BranchID)
	}
	var expenses []expenseRow
	if err := eq.Scan(&expenses).Error; err != nil {
		return nil, ExpenseCashflowTotals{}, err
	}

	type key struct {
		Date       string // formatted "2006-01-02" so equal dates from either query key identically
		BranchName string
	}
	agg := map[key]*ExpenseCashflowRow{}
	get := func(date time.Time, branchName string) *ExpenseCashflowRow {
		k := key{Date: date.Format("2006-01-02"), BranchName: branchName}
		if row, ok := agg[k]; ok {
			return row
		}
		row := &ExpenseCashflowRow{Date: date, BranchName: branchName}
		agg[k] = row
		return row
	}
	for _, m := range movements {
		row := get(m.Date, m.BranchName)
		switch m.Type {
		case "in":
			row.Collections += m.Amount
		case "out":
			row.Disbursements += m.Amount
		}
	}
	for _, e := range expenses {
		row := get(e.Date, e.BranchName)
		row.CashExpenses += e.Amount
	}

	rows := make([]ExpenseCashflowRow, 0, len(agg))
	var totals ExpenseCashflowTotals
	for _, row := range agg {
		rows = append(rows, *row)
		totals.TotalCollections += row.Collections
		totals.TotalDisbursements += row.Disbursements
		totals.TotalExpenses += row.CashExpenses
	}
	totals.NetCashflow = totals.TotalCollections - totals.TotalDisbursements - totals.TotalExpenses
	return rows, totals, nil
}

// KYC lists customers with their KYC/PAN/Aadhaar verification status — GET
// /reports/kyc. Not date-scoped by design — KYC status is a current-state
// snapshot, not something that "happened" within a range.
func (s *Service) KYC(ctx context.Context, f Filter) ([]KYCRow, KYCTotals, error) {
	q := s.db.WithContext(ctx).Table("customers c").
		Select("c.id as customer_id, c.code, c.name, c.phone, c.kyc_status, c.pan_status, c.aadhaar_status").
		Where("c.deleted_at IS NULL").
		Order("c.name asc")
	if f.BranchID != nil {
		q = q.Where("c.branch_id = ?", *f.BranchID)
	}
	var rows []KYCRow
	if err := q.Scan(&rows).Error; err != nil {
		return nil, KYCTotals{}, err
	}
	totals := KYCTotals{Count: len(rows)}
	for _, r := range rows {
		if r.KYCStatus == "Verified" {
			totals.Verified++
		} else {
			totals.Pending++
		}
	}
	return rows, totals, nil
}

// EmployeePerformance aggregates, per employee, loans processed (sanction-
// chain approvals recorded), collections handled, and reminders sent within
// [from, to] — GET /reports/employee-performance.
func (s *Service) EmployeePerformance(ctx context.Context, f Filter) ([]EmployeePerformanceRow, EmployeePerformanceTotals, error) {
	from, to := dateRange(f)

	type empRow struct {
		EmployeeID uint
		Name       string
		Role       string
		BranchName string
	}
	eq := s.db.WithContext(ctx).Table("employees e").
		Select("e.id as employee_id, e.name, e.role, b.name as branch_name").
		Joins("LEFT JOIN branches b ON b.id = e.branch_id").
		Where("e.deleted_at IS NULL")
	if f.BranchID != nil {
		eq = eq.Where("e.branch_id = ?", *f.BranchID)
	}
	var emps []empRow
	if err := eq.Scan(&emps).Error; err != nil {
		return nil, EmployeePerformanceTotals{}, err
	}

	type countRow struct {
		EmployeeID uint
		Count      int
	}
	approvalsByEmp := map[uint]int{}
	var approvals []countRow
	if err := s.db.WithContext(ctx).Table("loan_approvals a").
		Select("a.actor_employee_id as employee_id, count(*) as count").
		Where("a.action = ?", "Approved").
		Where("a.created_at >= ? AND a.created_at < ?", from, to).
		Group("a.actor_employee_id").
		Scan(&approvals).Error; err != nil {
		return nil, EmployeePerformanceTotals{}, err
	}
	for _, a := range approvals {
		approvalsByEmp[a.EmployeeID] = a.Count
	}

	type collRow struct {
		EmployeeID uint
		Amount     float64
	}
	collByEmp := map[uint]float64{}
	var colls []collRow
	if err := s.db.WithContext(ctx).Table("loan_payments p").
		Select("p.received_by_employee_id as employee_id, COALESCE(sum(p.amount), 0) as amount").
		Where("p.paid_on >= ? AND p.paid_on < ?", from, to).
		Group("p.received_by_employee_id").
		Scan(&colls).Error; err != nil {
		return nil, EmployeePerformanceTotals{}, err
	}
	for _, c := range colls {
		collByEmp[c.EmployeeID] = c.Amount
	}

	remindersByEmp := map[uint]int{}
	var reminders []countRow
	if err := s.db.WithContext(ctx).Table("reminders r").
		Select("r.created_by_employee_id as employee_id, count(*) as count").
		Where("r.created_at >= ? AND r.created_at < ?", from, to).
		Where("r.deleted_at IS NULL").
		Group("r.created_by_employee_id").
		Scan(&reminders).Error; err != nil {
		return nil, EmployeePerformanceTotals{}, err
	}
	for _, r := range reminders {
		remindersByEmp[r.EmployeeID] = r.Count
	}

	rows := make([]EmployeePerformanceRow, 0, len(emps))
	var totals EmployeePerformanceTotals
	for _, e := range emps {
		row := EmployeePerformanceRow{
			EmployeeID:     e.EmployeeID,
			Name:           e.Name,
			Role:           e.Role,
			BranchName:     e.BranchName,
			LoansProcessed: approvalsByEmp[e.EmployeeID],
			Approvals:      approvalsByEmp[e.EmployeeID],
			CollectionsAmt: collByEmp[e.EmployeeID],
			RemindersSent:  remindersByEmp[e.EmployeeID],
		}
		rows = append(rows, row)
		totals.TotalLoansProcessed += row.LoansProcessed
		totals.TotalCollections += row.CollectionsAmt
	}
	return rows, totals, nil
}

// CommunicationHistory lists WhatsApp communication log entries in
// [from, to], optionally filtered by trigger type — GET
// /reports/communication-history. Reads from commlog (Part A).
func (s *Service) CommunicationHistory(ctx context.Context, f Filter, triggerType string) ([]CommunicationHistoryRow, CommunicationHistoryTotals, error) {
	from, to := dateRange(f)
	logFilter := commlog.Filter{From: &from, To: &to, TriggerType: triggerType}
	logs, err := s.commlogRepo.List(ctx, logFilter)
	if err != nil {
		return nil, CommunicationHistoryTotals{}, err
	}
	rows := make([]CommunicationHistoryRow, 0, len(logs))
	var totals CommunicationHistoryTotals
	for _, l := range logs {
		rows = append(rows, CommunicationHistoryRow{
			ID:             l.ID,
			RecipientName:  l.RecipientName,
			RecipientPhone: l.RecipientPhone,
			Channel:        l.Channel,
			TriggerType:    l.TriggerType,
			Status:         l.Status,
			SentAt:         l.CreatedAt,
		})
		totals.Count++
		if l.Status == commlog.StatusSent {
			totals.Sent++
		} else {
			totals.Failed++
		}
	}
	return rows, totals, nil
}
