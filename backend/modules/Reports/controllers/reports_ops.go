package controllers

import (
	common "cloudhouse/backend/common/controllers"
	commonModels "cloudhouse/backend/common/models"
	"cloudhouse/backend/config"
	"cloudhouse/backend/modules/Reports/models"
	"context"
	"math"
	"sort"
	"time"
)

func expenseCashflow(ctx context.Context, f models.Filter) ([]models.ExpenseCashflowRow, models.ExpenseCashflowTotals, error) {
	from, to := dateRange(f)
	type movementRow struct {
		Date       time.Time
		BranchName string
		BranchID   *uint
		Type       string
		Amount     float64
	}
	mq := config.DB.
		WithContext(ctx).Table("cash_movements m").
		Select(`date(m.occurred_on) as date, b.name as branch_name, m.branch_id, m.type,
			COALESCE(sum(m.amount), 0) as amount`).
		Joins("LEFT JOIN branches b ON b.id = m.branch_id").
		Where("m.occurred_on >= ? AND m.occurred_on < ?", from, to).
		Where("m.expense_id IS NULL").
		Group("date(m.occurred_on), b.name, m.branch_id, m.type")
	if f.BranchID != nil {
		mq = mq.Where("m.branch_id = ?", *f.BranchID)
	}
	var movements []movementRow
	if err := mq.Scan(&movements).Error; err != nil {
		return nil, models.ExpenseCashflowTotals{}, err
	}
	type expenseRow struct {
		Date       time.Time
		BranchName string
		BranchID   uint
		Amount     float64
	}
	eq := config.DB.
		WithContext(ctx).Table("expenses e").
		Select(`date(e.occurred_on) as date, b.name as branch_name, e.branch_id,
			COALESCE(sum(e.amount), 0) as amount`).
		Joins("LEFT JOIN branches b ON b.id = e.branch_id").
		Where("e.occurred_on >= ? AND e.occurred_on < ?", from, to).
		Where("e.mode = ?", "Cash").
		Where("e.status = ?", "Approved").
		Group("date(e.occurred_on), b.name, e.branch_id")
	if f.BranchID != nil {
		eq = eq.Where("e.branch_id = ?", *f.BranchID)
	}
	var expenses []expenseRow
	if err := eq.Scan(&expenses).Error; err != nil {
		return nil, models.ExpenseCashflowTotals{}, err
	}
	type key struct {
		Date       string
		BranchName string
	}
	agg := map[key]*models.ExpenseCashflowRow{}
	get := func(date time.Time, branchName string) *models.ExpenseCashflowRow {
		k := key{Date: date.Format("2006-01-02"), BranchName: branchName}
		if row, ok := agg[k]; ok {
			return row
		}
		row := &models.ExpenseCashflowRow{Date: date, BranchName: branchName}
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
	rows := make([]models.ExpenseCashflowRow, 0, len(agg))
	for _, row := range agg {
		rows = append(rows, *row)
	}
	sort.Slice(rows, func(i, j int) bool {
		if !rows[i].Date.Equal(rows[j].Date) {
			return rows[i].Date.After(rows[j].Date)
		}
		return rows[i].BranchName < rows[j].BranchName
	})
	// Summed in that fixed order and rounded to the paisa, so the totals never vary by float summation order
	var totals models.ExpenseCashflowTotals
	for _, row := range rows {
		totals.TotalCollections += row.Collections
		totals.TotalDisbursements += row.Disbursements
		totals.TotalExpenses += row.CashExpenses
	}
	paisa := func(v float64) float64 { return math.Round(v*100) / 100 }
	totals.TotalCollections = paisa(totals.TotalCollections)
	totals.TotalDisbursements = paisa(totals.TotalDisbursements)
	totals.TotalExpenses = paisa(totals.TotalExpenses)
	totals.NetCashflow = paisa(totals.TotalCollections - totals.TotalDisbursements - totals.TotalExpenses)
	return rows, totals, nil
}

func kycReport(ctx context.Context, f models.Filter) ([]models.KYCRow, models.KYCTotals, error) {
	q := config.DB.
		WithContext(ctx).Table("customers c").
		Select("c.id as customer_id, c.code, c.name, c.phone, c.kyc_status, c.pan_status, c.aadhaar_status").
		Where("c.deleted_at IS NULL").
		Order("c.name asc")
	if f.BranchID != nil {
		q = q.Where("c.branch_id = ?", *f.BranchID)
	}
	var rows []models.KYCRow
	if err := q.Scan(&rows).Error; err != nil {
		return nil, models.KYCTotals{}, err
	}
	rows = MatchRows(rows, f.Q)
	totals := models.KYCTotals{Count: len(rows)}
	for _, r := range rows {
		if r.KYCStatus == "Verified" {
			totals.Verified++
		} else {
			totals.Pending++
		}
	}
	return rows, totals, nil
}

func employeePerformance(ctx context.Context, f models.Filter) ([]models.EmployeePerformanceRow, models.EmployeePerformanceTotals, error) {
	from, to := dateRange(f)
	type empRow struct {
		EmployeeID uint
		Name       string
		Role       string
		BranchName string
	}
	eq := config.DB.
		WithContext(ctx).Table("employees e").
		Select("e.id as employee_id, e.name, e.role, b.name as branch_name").
		Joins("LEFT JOIN branches b ON b.id = e.branch_id").
		Where("e.deleted_at IS NULL")
	if f.BranchID != nil {
		eq = eq.Where("e.branch_id = ?", *f.BranchID)
	}
	var emps []empRow
	if err := eq.Scan(&emps).Error; err != nil {
		return nil, models.EmployeePerformanceTotals{}, err
	}
	type countRow struct {
		EmployeeID uint
		Count      int
	}
	approvalsByEmp := map[uint]int{}
	var approvals []countRow
	if err := config.DB.
		WithContext(ctx).Table("loan_approvals a").
		Select("a.actor_employee_id as employee_id, count(*) as count").
		Where("a.action IN ?", []string{"Approved", "Verified"}).
		Where("a.created_at >= ? AND a.created_at < ?", from, to).
		Group("a.actor_employee_id").
		Scan(&approvals).Error; err != nil {
		return nil, models.EmployeePerformanceTotals{}, err
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
	if err := config.DB.
		WithContext(ctx).Table("loan_payments p").
		Select("p.received_by_employee_id as employee_id, COALESCE(sum(p.amount), 0) as amount").
		Where("p.paid_on >= ? AND p.paid_on < ?", from, to).
		Group("p.received_by_employee_id").
		Scan(&colls).Error; err != nil {
		return nil, models.EmployeePerformanceTotals{}, err
	}
	for _, c := range colls {
		collByEmp[c.EmployeeID] = c.Amount
	}
	remindersByEmp := map[uint]int{}
	var reminders []countRow
	if err := config.DB.
		WithContext(ctx).Table("reminders r").
		Select("r.created_by_employee_id as employee_id, count(*) as count").
		Where("r.created_at >= ? AND r.created_at < ?", from, to).
		Where("r.deleted_at IS NULL").
		Group("r.created_by_employee_id").
		Scan(&reminders).Error; err != nil {
		return nil, models.EmployeePerformanceTotals{}, err
	}
	for _, r := range reminders {
		remindersByEmp[r.EmployeeID] = r.Count
	}
	rows := make([]models.EmployeePerformanceRow, 0, len(emps))
	var totals models.EmployeePerformanceTotals
	for _, e := range emps {
		row := models.EmployeePerformanceRow{
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

func communicationHistory(ctx context.Context, f models.Filter, triggerType string) ([]models.CommunicationHistoryRow, models.CommunicationHistoryTotals, error) {
	from, to := dateRange(f)
	logFilter := common.CommLogFilter{From: &from, To: &to, TriggerType: triggerType}
	logs, err := common.FindCommLogs(ctx, logFilter)
	if err != nil {
		return nil, models.CommunicationHistoryTotals{}, err
	}
	rows := make([]models.CommunicationHistoryRow, 0, len(logs))
	var totals models.CommunicationHistoryTotals
	for _, l := range logs {
		rows = append(rows, models.CommunicationHistoryRow{
			ID:             l.ID,
			RecipientName:  l.RecipientName,
			RecipientPhone: l.RecipientPhone,
			Channel:        l.Channel,
			TriggerType:    l.TriggerType,
			Status:         l.Status,
			SentAt:         l.CreatedAt,
		})
		totals.Count++
		if l.Status == commonModels.StatusSent {
			totals.Sent++
		} else {
			totals.Failed++
		}
	}
	return rows, totals, nil
}
