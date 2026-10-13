package controllers

import (
	"cloudhouse/backend/auth"
	common "cloudhouse/backend/common/controllers"
	"cloudhouse/backend/config"
	"cloudhouse/backend/modules/Cash/models"
	"context"
	"net/http"
	"strings"

	"github.com/labstack/echo/v4"
)

// expenseGroup is the expense and the other debit lines of its payment breakdown (only the still-pending
// ones when pendingOnly).
func expenseGroup(ctx context.Context, e *models.Expense, pendingOnly bool) ([]models.Expense, error) {
	if e.GroupID == "" {
		return []models.Expense{*e}, nil
	}
	var rows []models.Expense
	q := config.DB.WithContext(ctx).Preload("Branch").Where("group_id = ?", e.GroupID)
	if pendingOnly {
		q = q.Where("status = ?", "Pending")
	}
	if err := q.Order("id").Find(&rows).Error; err != nil {
		return nil, err
	}
	if len(rows) == 0 {
		return []models.Expense{*e}, nil
	}
	return rows, nil
}

// GetExpenseEntry is the Expense Register's counterpart of GetMovementEntry: the data its Edit form opens
// on, for a pending or approved expense (a pending one has no cash line yet).
func GetExpenseEntry(c echo.Context) error {
	ctx := auth.RequestContext(c)
	id, err := common.IDParam(c, "id")
	if err != nil {
		return common.FailErr(c, err)
	}
	e, err := getExpense(ctx, id, auth.GetBranchScope(c))
	if err != nil {
		return common.FailErr(c, err)
	}
	if !e.Editable {
		return common.FailErr(c, common.NewNotFound("this expense can't be edited"))
	}
	rows, err := expenseGroup(ctx, e, false)
	if err != nil {
		return common.FailErr(c, err)
	}
	var bankIDs []uint
	for _, r := range rows {
		if r.FromBankID != nil {
			bankIDs = append(bankIDs, *r.FromBankID)
		}
	}
	bankNames := map[uint]string{}
	if len(bankIDs) > 0 {
		var banks []struct {
			ID   uint
			Name string
		}
		if err := config.DB.WithContext(ctx).Table("banks").Select("id, name").Where("id IN ?", bankIDs).Scan(&banks).Error; err != nil {
			return common.FailErr(c, err)
		}
		for _, b := range banks {
			bankNames[b.ID] = b.Name
		}
	}
	first := rows[0]
	info := entryInfo{
		Kind: entryDebit, Editable: true, ViaExpense: true, MovementID: first.ID, Category: first.Category,
		OccurredOn: first.OccurredOn, RecordedAt: first.CreatedAt, Remarks: first.Remarks, BranchID: &first.BranchID,
		BranchName: first.Branch.Name, ReceiptImage: first.ReceiptImage, Status: first.Status, Lines: []entryLine{},
		ApprovedAt: first.ApprovedAt,
	}
	if first.ApprovedBy != nil {
		info.ApprovedBy = *first.ApprovedBy
	}
	for _, r := range rows {
		info.Amount = common.RoundMoney(info.Amount + r.Amount)
		line := entryLine{MovementID: r.ID, Mode: r.Mode, Amount: r.Amount, BankID: r.FromBankID}
		if r.FromBankID != nil {
			line.BankName = bankNames[*r.FromBankID]
		}
		info.Lines = append(info.Lines, line)
	}
	return common.Success(c, http.StatusOK, info)
}

// UpdateExpense edits an expense from the Expense Register. An approved one is edited like its ledger entry
// (the cash line is replaced too); a pending one is replaced in place and keeps waiting at its approval step.
func UpdateExpense(c echo.Context) error {
	ctx := auth.RequestContext(c)
	id, err := common.IDParam(c, "id")
	if err != nil {
		return common.FailErr(c, err)
	}
	var req updateEntryRequest
	if err := common.BindJSON(c, &req); err != nil {
		return c.JSON(http.StatusBadRequest, echo.Map{"success": false, "error": "Invalid input"})
	}
	e, err := getExpense(ctx, id, auth.GetBranchScope(c))
	if err != nil {
		return common.FailErr(c, err)
	}
	if !e.Editable {
		return common.FailErr(c, common.NewConflict("this expense can't be edited"))
	}
	if e.Status == "Approved" {
		if e.CashMovementID == nil {
			return common.FailErr(c, common.NewConflict("this expense can't be edited"))
		}
		m, err := getMovement(ctx, *e.CashMovementID, auth.GetBranchScope(c))
		if err != nil {
			return common.FailErr(c, err)
		}
		return applyEntryUpdate(c, ctx, m, req)
	}
	newID, err := editPendingExpense(c, ctx, e, req)
	if err != nil {
		return common.FailErr(c, err)
	}
	return common.Success(c, http.StatusOK, echo.Map{"id": newID})
}

func editPendingExpense(c echo.Context, ctx context.Context, e *models.Expense, req updateEntryRequest) (uint, error) {
	rows, err := expenseGroup(ctx, e, true)
	if err != nil {
		return 0, err
	}
	tmpl := rows[0]
	category := strings.TrimSpace(req.Category)
	if category == "" {
		category = tmpl.Category
	}
	occurred, err := editOccurredOn(req.OccurredOn, tmpl.OccurredOn)
	if err != nil {
		return 0, err
	}
	branchID := tmpl.BranchID
	if req.BranchID != nil {
		branchID = auth.EnforceBranchOnWrite(c, *req.BranchID)
	}
	receipt := tmpl.ReceiptImage
	if req.ReceiptImage != nil {
		receipt = *req.ReceiptImage
	}
	remarks := strings.TrimSpace(req.Remarks)
	var parts []SplitPart
	if len(req.Payments) > 0 {
		parts, err = paymentParts(req.Payments, req.Amount)
	} else {
		parts, err = paymentParts([]paymentPartRequest{{Mode: tmpl.Mode, Amount: req.Amount, BankID: tmpl.FromBankID}}, req.Amount)
	}
	if err != nil {
		return 0, err
	}
	ids := make([]uint, 0, len(rows))
	for _, r := range rows {
		ids = append(ids, r.ID)
	}
	if err := deleteByIDs(ctx, ids); err != nil {
		return 0, err
	}
	fail := func(created []*models.Expense, err error) (uint, error) {
		rollbackExpenses(ctx, created)
		restoreEntry(ctx, rows, nil)
		return 0, err
	}
	if err := ensureLoanRepayment(ctx, category, req.Amount, true); err != nil {
		return fail(nil, err)
	}
	groupID := common.NewTransactionGroupID()
	var created []*models.Expense
	for _, p := range parts {
		rec := &models.Expense{
			ApprovalStage: tmpl.ApprovalStage, OccurredOn: occurred, Category: category, Amount: p.Amount, Mode: p.Mode,
			Payee: tmpl.Payee, FromBankID: p.BankID, BranchID: branchID, Status: "Pending", Remarks: remarks,
			ReceiptImage: receipt, GroupID: groupID,
		}
		if err := insertExpense(ctx, rec); err != nil {
			return fail(created, err)
		}
		created = append(created, rec)
	}
	return created[0].ID, nil
}
