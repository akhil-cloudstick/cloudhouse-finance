package controllers

import (
	"cloudhouse/backend/config"
	"cloudhouse/backend/modules/Dashboard/models"
	"context"
	"strings"
)

func pendingOtherApprovals(ctx context.Context, branchScope *uint, query string) ([]models.NeedsAttentionItem, error) {
	like := "%" + strings.TrimSpace(query) + "%"
	hasQuery := strings.TrimSpace(query) != ""
	items := []models.NeedsAttentionItem{}
	type loanRow struct {
		ID            uint
		LoanID        uint
		LoanNumber    string
		CustomerName  string
		Amount        float64
		ApprovalStage string
	}
	var topUps []loanRow
	tq := config.DB.
		WithContext(ctx).Table("loan_top_ups t").
		Select("t.id, t.loan_id, l.loan_number, c.name AS customer_name, t.amount, t.approval_stage").
		Joins("JOIN loans l ON l.id = t.loan_id AND l.deleted_at IS NULL").
		Joins("LEFT JOIN customers c ON c.id = l.customer_id").
		Where("t.status = ?", "Pending").
		Order("t.id")
	if branchScope != nil {
		tq = tq.Where("l.branch_id = ?", *branchScope)
	}
	if hasQuery {
		tq = tq.Where("l.loan_number ILIKE ? OR c.name ILIKE ? OR c.code ILIKE ?", like, like, like)
	}
	if err := tq.Scan(&topUps).Error; err != nil {
		return nil, err
	}
	for _, r := range topUps {
		items = append(items, models.NeedsAttentionItem{
			Kind: "approval", Flow: "loan_topup", EntityID: r.ID,
			LoanID: r.LoanID, LoanNumber: r.LoanNumber, CustomerName: r.CustomerName,
			Principal: r.Amount, ApprovalStage: r.ApprovalStage,
		})
	}
	var personal []loanRow
	pq := config.DB.
		WithContext(ctx).Table("personal_loans p").
		Select("p.id, p.loan_number, c.name AS customer_name, p.principal_amount AS amount, p.approval_stage").
		Joins("LEFT JOIN customers c ON c.id = p.customer_id").
		Where("p.status = ? AND p.deleted_at IS NULL", "Pending Approval").
		Order("p.id")
	if branchScope != nil {
		pq = pq.Where("p.branch_id = ?", *branchScope)
	}
	if hasQuery {
		pq = pq.Where("p.loan_number ILIKE ? OR c.name ILIKE ? OR c.code ILIKE ?", like, like, like)
	}
	if err := pq.Scan(&personal).Error; err != nil {
		return nil, err
	}
	for _, r := range personal {
		items = append(items, models.NeedsAttentionItem{
			Kind: "approval", Flow: "personal_loan", EntityID: r.ID,
			LoanNumber: r.LoanNumber, CustomerName: r.CustomerName,
			Principal: r.Amount, ApprovalStage: r.ApprovalStage,
		})
	}
	type expenseRow struct {
		ID            uint
		Category      string
		Payee         string
		Amount        float64
		ApprovalStage string
	}
	var expenses []expenseRow
	eq := config.DB.
		WithContext(ctx).Table("expenses e").
		Select("e.id, e.category, e.payee, e.amount, e.approval_stage").
		Where("e.status = ?", "Pending").
		Order("e.id")
	if branchScope != nil {
		eq = eq.Where("e.branch_id = ?", *branchScope)
	}
	if hasQuery {
		eq = eq.Where("e.category ILIKE ? OR e.payee ILIKE ?", like, like)
	}
	if err := eq.Scan(&expenses).Error; err != nil {
		return nil, err
	}
	for _, r := range expenses {
		items = append(items, models.NeedsAttentionItem{
			Kind: "approval", Flow: "expense", EntityID: r.ID,
			CustomerName: firstNonEmpty(r.Payee, r.Category), Detail: r.Category,
			Principal: r.Amount, ApprovalStage: r.ApprovalStage,
		})
	}
	return items, nil
}

func firstNonEmpty(vals ...string) string {
	for _, v := range vals {
		if v != "" {
			return v
		}
	}
	return ""
}
