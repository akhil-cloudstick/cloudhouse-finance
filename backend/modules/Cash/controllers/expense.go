package controllers

import (
	"cloudhouse/backend/auth"
	common "cloudhouse/backend/common/controllers"
	commonModels "cloudhouse/backend/common/models"
	"cloudhouse/backend/config"
	"cloudhouse/backend/modules/Cash/models"
	"context"
	"net/http"
	"strconv"
	"strings"
	"time"

	"gorm.io/gorm"

	"github.com/labstack/echo/v4"
)

var expenseEmployeeName = func(ctx context.Context, employeeID uint) string {
	if e, err := common.FindEmployeeByID(ctx, employeeID); err == nil {
		return e.Name
	}
	return ""
}

type RecordExpenseInput struct {
	OccurredOn   time.Time
	Category     string
	Amount       float64
	Mode         string
	Payee        string
	FromBankID   *uint
	ToBankID     *uint
	BranchID     uint
	Remarks      string
	ReceiptImage string
}

type ExpenseActor struct {
	EmployeeID uint
	RoleID     uint
	Name       string
}

type expenseDecision struct {
	rec   *models.Expense
	chain *common.Chain
	step  common.StageDef
	name  string
}

type expenseRequest struct {
	OccurredOn   string  `json:"occurred_on"`
	Category     string  `json:"category" binding:"required"`
	Amount       float64 `json:"amount" binding:"required"`
	Mode         string  `json:"mode" binding:"required"`
	Payee        string  `json:"payee"`
	FromBankID   *uint   `json:"from_bank_id"`
	ToBankID     *uint   `json:"to_bank_id"`
	BranchID     uint    `json:"branch_id" binding:"required"`
	Remarks      string  `json:"remarks"`
	ReceiptImage string  `json:"receipt_image"`
}

type approveExpenseRequest struct {
	ApprovedBy string `json:"approved_by"`
}

type rejectExpenseRequest struct {
	ApprovedBy string `json:"approved_by"`
	Remarks    string `json:"remarks" binding:"required"`
}

func recordExpenseCashOut(ctx context.Context, expenseID uint, category, mode string, fromBankID, toBankID *uint, amount float64, branchID uint, occurredOn time.Time, receiptImage string) (uint, error) {
	rec := &models.CashMovement{
		Type:         "out",
		Purpose:      "Expense — " + category,
		Mode:         mode,
		BankID:       fromBankID,
		ToBankID:     toBankID,
		Amount:       amount,
		BranchID:     &branchID,
		ExpenseID:    &expenseID,
		ReceiptImage: receiptImage,
	}
	if occurredOn.IsZero() {
		rec.OccurredOn = time.Now()
	} else {
		rec.OccurredOn = occurredOn
	}
	if err := insertMovement(ctx, rec); err != nil {
		return 0, err
	}
	return rec.ID, nil
}

func RecordBankPledgeReleaseExpense(ctx context.Context, loanID uint, bankName string, amount float64, occurredOn time.Time, branchID uint) (uint, error) {
	hoID, err := HeadOfficeBranchID(ctx)
	if err != nil {
		return 0, err
	}
	return recordSystemExpense(ctx, "Bank Pledge Release", bankName, amount, occurredOn, hoID)
}

func recordSystemExpense(ctx context.Context, category, bankName string, amount float64, occurredOn time.Time, branchID uint) (uint, error) {
	now := time.Now()
	rec := &models.Expense{
		Category:   category,
		Amount:     amount,
		Mode:       "Bank",
		Payee:      bankName,
		BranchID:   branchID,
		Status:     "Approved",
		Remarks:    "Auto-recorded from bank pledge workflow",
		ApprovedBy: strPtr("System"),
		ApprovedAt: &now,
	}
	if occurredOn.IsZero() {
		rec.OccurredOn = now
	} else {
		rec.OccurredOn = occurredOn
	}
	if err := insertExpense(ctx, rec); err != nil {
		return 0, err
	}
	return rec.ID, nil
}

func expenseActor(c echo.Context, fallbackName string) ExpenseActor {
	employeeID, role, roleID := auth.ActorFromContext(c)
	if fallbackName == "" {
		fallbackName = role
	}
	return ExpenseActor{EmployeeID: employeeID, RoleID: roleID, Name: fallbackName}
}

func authorizeDecision(ctx context.Context, id uint, actor ExpenseActor, branchID *uint) (*expenseDecision, error) {
	rec, err := getExpense(ctx, id, branchID)
	if err != nil {
		return nil, err
	}
	if rec.Status != "Pending" {
		return nil, common.NewConflict("expense has already been approved or rejected")
	}
	chain, err := common.WorkflowChain(ctx, common.FlowExpense)
	if err != nil {
		return nil, err
	}
	step, _ := chain.ByPending(rec.ApprovalStage)
	if !common.CanAct(ctx, actor.RoleID, common.FlowExpense, step.Key) {
		return nil, common.NewForbidden("your role may not approve or reject expenses")
	}
	name := actor.Name
	if (expenseEmployeeName != nil && !config.IsDemoRun(ctx)) &&
		actor.EmployeeID != 0 {
		if n := expenseEmployeeName(ctx, actor.EmployeeID); n != "" {
			name = n
		}
	}
	return &expenseDecision{rec: rec, chain: chain, step: step, name: name}, nil
}

func approveAs(ctx context.Context, id uint, actor ExpenseActor, branchID *uint) (*models.Expense, error) {
	d, err := authorizeDecision(ctx, id, actor, branchID)
	if err != nil {
		return nil, err
	}
	common.RecordAction(ctx, &commonModels.ApprovalAction{
		Flow: common.FlowExpense, EntityID: id, Stage: d.step.Key, Action: "Approved",
		ActorEmployeeID: actor.EmployeeID, ActorRole: d.step.Role,
	})
	if next, ok := d.chain.Next(d.step.Key); ok && d.step.Key != "" {
		d.rec.ApprovalStage = next.Pending
		if err := persistExpense(ctx, d.rec); err != nil {
			return nil, err
		}
		return findExpenseByID(ctx, id)
	}
	return SaveExpenseApproval(ctx, id, d.name, branchID)
}

func rejectAs(ctx context.Context, id uint, actor ExpenseActor, remarks string, branchID *uint) (*models.Expense, error) {
	d, err := authorizeDecision(ctx, id, actor, branchID)
	if err != nil {
		return nil, err
	}
	rec, err := SaveExpenseRejection(ctx, id, d.name, remarks, branchID)
	if err == nil {
		common.RecordAction(ctx, &commonModels.ApprovalAction{
			Flow: common.FlowExpense, EntityID: id, Stage: d.step.Key, Action: commonModels.ActionRejected,
			ActorEmployeeID: actor.EmployeeID, ActorRole: d.step.Role, Remarks: remarks,
		})
	}
	return rec, err
}

func SaveExpense(ctx context.Context, in RecordExpenseInput) (*models.Expense, error) {
	if in.Amount <= 0 {
		return nil, common.NewBadRequest("amount must be greater than zero")
	}
	if in.Category == "" {
		return nil, common.NewBadRequest("category is required")
	}
	if in.Mode == "" {
		return nil, common.NewBadRequest("mode is required")
	}
	if in.BranchID == 0 {
		return nil, common.NewBadRequest("branch is required")
	}
	if ok, err := common.BranchExists(ctx, in.BranchID); err != nil {
		return nil, err
	} else if !ok {
		return nil, common.NewBadRequest("branch does not exist")
	}
	if in.Mode == "Bank" {
		in.Mode = models.CashModeBankTransfer
	}
	if (in.Mode == models.CashModeUPI || in.Mode == models.CashModeBankTransfer) && in.FromBankID == nil {
		return nil, common.NewBadRequest("from bank is required when mode is UPI or Bank")
	}
	if err := ensureLoanRepayment(ctx, in.Category, in.Amount, true); err != nil {
		return nil, err
	}
	chain, err := common.WorkflowChain(ctx, common.FlowExpense)
	if err != nil {
		return nil, err
	}
	if chain.Off() && in.Mode == models.CashModeCash &&
		!config.IsDemoRun(ctx) {
		if err := EnsureCashInHand(ctx, in.BranchID, in.Amount); err != nil {
			return nil, err
		}
	}
	now := time.Now()
	occurredOn := in.OccurredOn
	if occurredOn.IsZero() {
		occurredOn = now
	}
	if first, ok := chain.First(); ok {
		rec := &models.Expense{
			ApprovalStage: first.Pending,
			OccurredOn:    occurredOn,
			Category:      in.Category,
			Amount:        in.Amount,
			Mode:          in.Mode,
			Payee:         in.Payee,
			FromBankID:    in.FromBankID,
			ToBankID:      in.ToBankID,
			BranchID:      in.BranchID,
			Status:        "Pending",
			Remarks:       in.Remarks,
			ReceiptImage:  in.ReceiptImage,
		}
		if err := insertExpense(ctx, rec); err != nil {
			return nil, err
		}
		return findExpenseByID(ctx, rec.ID)
	}
	rec := &models.Expense{
		OccurredOn:   occurredOn,
		Category:     in.Category,
		Amount:       in.Amount,
		Mode:         in.Mode,
		Payee:        in.Payee,
		FromBankID:   in.FromBankID,
		ToBankID:     in.ToBankID,
		BranchID:     in.BranchID,
		Status:       "Approved",
		ApprovedAt:   &now,
		Remarks:      in.Remarks,
		ReceiptImage: in.ReceiptImage,
	}
	if err := insertExpense(ctx, rec); err != nil {
		return nil, err
	}
	movementID, err := recordExpenseCashOut(ctx, rec.ID, rec.Category, rec.Mode, rec.FromBankID, rec.ToBankID, rec.Amount, rec.BranchID, rec.OccurredOn, rec.ReceiptImage)
	if err != nil {
		return nil, err
	}
	rec.CashMovementID = &movementID
	if err := persistExpense(ctx, rec); err != nil {
		return nil, err
	}
	return findExpenseByID(ctx, rec.ID)
}

func listExpenses(ctx context.Context, branchID *uint, search string, limit, offset int) ([]models.Expense, int64, error) {
	return findExpenses(ctx, branchID, search, limit, offset)
}

func getExpense(ctx context.Context, id uint, branchID *uint) (*models.Expense, error) {
	rec, err := findExpenseByID(ctx, id)
	if err != nil {
		return nil, common.NewNotFound("expense not found")
	}
	if branchID != nil && rec.BranchID != *branchID {
		return nil, common.NewNotFound("expense not found")
	}
	return rec, nil
}

func SaveExpenseApproval(ctx context.Context, id uint, approvedBy string, branchID *uint) (*models.Expense, error) {
	rec, err := findExpenseByID(ctx, id)
	if err != nil {
		return nil, common.NewNotFound("expense not found")
	}
	if branchID != nil && rec.BranchID != *branchID {
		return nil, common.NewNotFound("expense not found")
	}
	if rec.Status != "Pending" {
		return nil, common.NewConflict("expense has already been approved or rejected")
	}
	if rec.Mode == models.CashModeCash &&
		!config.IsDemoRun(ctx) {
		if err := EnsureCashInHand(ctx, rec.BranchID, rec.Amount); err != nil {
			return nil, err
		}
	}
	if err := ensureLoanRepayment(ctx, rec.Category, rec.Amount, false); err != nil {
		return nil, err
	}
	now := time.Now()
	rec.Status = "Approved"
	if approvedBy != "" {
		rec.ApprovedBy = &approvedBy
	}
	rec.ApprovedAt = &now
	movementID, err := recordExpenseCashOut(ctx, rec.ID, rec.Category, rec.Mode, rec.FromBankID, rec.ToBankID, rec.Amount, rec.BranchID, rec.OccurredOn, rec.ReceiptImage)
	if err != nil {
		return nil, err
	}
	rec.CashMovementID = &movementID
	if err := persistExpense(ctx, rec); err != nil {
		return nil, err
	}
	return rec, nil
}

func SaveExpenseRejection(ctx context.Context, id uint, approvedBy, remarks string, branchID *uint) (*models.Expense, error) {
	if remarks == "" {
		return nil, common.NewBadRequest("remarks are required when rejecting an expense")
	}
	rec, err := findExpenseByID(ctx, id)
	if err != nil {
		return nil, common.NewNotFound("expense not found")
	}
	if branchID != nil && rec.BranchID != *branchID {
		return nil, common.NewNotFound("expense not found")
	}
	if rec.Status != "Pending" {
		return nil, common.NewConflict("expense has already been approved or rejected")
	}
	now := time.Now()
	rec.Status = "Rejected"
	rec.Remarks = remarks
	if approvedBy != "" {
		rec.ApprovedBy = &approvedBy
	}
	rec.ApprovedAt = &now
	if err := persistExpense(ctx, rec); err != nil {
		return nil, err
	}
	return rec, nil
}

func (req expenseRequest) toInput() (RecordExpenseInput, error) {
	occurred, err := parseOccurredOn(req.OccurredOn)
	if err != nil {
		return RecordExpenseInput{}, common.NewBadRequest("invalid occurred_on: expected YYYY-MM-DD")
	}
	return RecordExpenseInput{
		OccurredOn: occurred, Category: req.Category, Amount: req.Amount,
		Mode: req.Mode, Payee: req.Payee, FromBankID: req.FromBankID, ToBankID: req.ToBankID,
		BranchID: req.BranchID, Remarks: req.Remarks, ReceiptImage: req.ReceiptImage,
	}, nil
}

func deleteByIDs(ctx context.Context, ids []uint) error {
	if len(ids) == 0 {
		return nil
	}
	return config.DB.
		WithContext(ctx).Where("id IN ?", ids).Delete(&models.Expense{}).Error
}

func insertExpense(ctx context.Context, e *models.Expense) error {
	return config.DB.
		WithContext(ctx).Create(e).Error
}

func findExpenses(ctx context.Context, branchID *uint, search string, limit, offset int) ([]models.Expense, int64, error) {
	var expenses []models.Expense
	q := config.DB.
		WithContext(ctx).Preload("Branch").Order("occurred_on desc, id desc")
	if branchID != nil {
		q = q.Where("branch_id = ?", *branchID)
	}
	if search != "" {
		like := "%" + search + "%"
		q = q.Where("category ILIKE ? OR payee ILIKE ? OR remarks ILIKE ?", like, like, like)
	}
	var total int64
	if limit > 0 {
		if err := q.Session(&gorm.Session{}).Model(&models.Expense{}).Count(&total).Error; err != nil {
			return nil, 0, err
		}
		q = q.Limit(limit)
	}
	if offset > 0 {
		q = q.Offset(offset)
	}
	err := q.Find(&expenses).Error
	return expenses, total, err
}

func sumExpenseFiltered(ctx context.Context, branchID *uint, search string) (float64, error) {
	q := config.DB.
		WithContext(ctx).Model(&models.Expense{})
	if branchID != nil {
		q = q.Where("branch_id = ?", *branchID)
	}
	if search != "" {
		like := "%" + search + "%"
		q = q.Where("category ILIKE ? OR payee ILIKE ? OR remarks ILIKE ?", like, like, like)
	}
	var sum float64
	err := q.Select("COALESCE(SUM(amount), 0)").Scan(&sum).Error
	return sum, err
}

func findExpenseByID(ctx context.Context, id uint) (*models.Expense, error) {
	var e models.Expense
	if err := config.DB.
		WithContext(ctx).Preload("Branch").First(&e, id).Error; err != nil {
		return nil, err
	}
	return &e, nil
}

func persistExpense(ctx context.Context, e *models.Expense) error {
	return config.DB.
		WithContext(ctx).Save(e).Error
}

func sumCashByDate(ctx context.Context, branchID *uint, date time.Time) (float64, error) {
	return sumCashBetween(ctx, branchID, nil, startOfDay(date), startOfDay(date).AddDate(0, 0, 1))
}

func sumCashBetween(ctx context.Context, branchID *uint, excludeBranchIDs []uint, from, to time.Time) (float64, error) {
	q := config.DB.
		WithContext(ctx).Model(&models.Expense{}).
		Where("mode = ?", "Cash").
		Where("status = ?", "Approved").
		Where("occurred_on < ?", to)
	if !from.IsZero() {
		q = q.Where("occurred_on >= ?", from)
	}
	if branchID != nil {
		q = q.Where("branch_id = ?", *branchID)
	}
	if len(excludeBranchIDs) > 0 {
		q = q.Where("branch_id NOT IN ?", excludeBranchIDs)
	}
	var total float64
	if err := q.Select("COALESCE(SUM(amount), 0)").Scan(&total).Error; err != nil {
		return 0, err
	}
	return total, nil
}

func sumAllByDate(ctx context.Context, branchID *uint, date time.Time) (float64, error) {
	q := config.DB.
		WithContext(ctx).Model(&models.Expense{}).
		Where("status = ?", "Approved").
		Where("occurred_on >= ? AND occurred_on < ?", startOfDay(date), startOfDay(date).AddDate(0, 0, 1))
	if branchID != nil {
		q = q.Where("branch_id = ?", *branchID)
	}
	var total float64
	if err := q.Select("COALESCE(SUM(amount), 0)").Scan(&total).Error; err != nil {
		return 0, err
	}
	return total, nil
}

func sumByBank(ctx context.Context, to time.Time) (map[uint]float64, error) {
	var rows []struct {
		FromBankID uint
		Total      float64
	}
	err := config.DB.
		WithContext(ctx).Model(&models.Expense{}).
		Select("from_bank_id, COALESCE(SUM(amount), 0) AS total").
		Where("status = ? AND occurred_on < ? AND from_bank_id IS NOT NULL", "Approved", to).
		Where("mode IN ? AND to_bank_id IS NULL", bankModes).
		Group("from_bank_id").Scan(&rows).Error
	if err != nil {
		return nil, err
	}
	out := make(map[uint]float64, len(rows))
	for _, rw := range rows {
		out[rw.FromBankID] = rw.Total
	}
	return out, nil
}

func sumByScope(ctx context.Context, s BalanceScope) (float64, error) {
	q := config.DB.
		WithContext(ctx).Model(&models.Expense{}).
		Where("status = ?", "Approved").
		Where("occurred_on < ?", s.To)
	if s.Bank {
		q = q.Where("mode IN ?", bankModes).Where("to_bank_id IS NULL")
		if s.BankID != nil {
			q = q.Where("from_bank_id = ?", *s.BankID)
		}
		if s.Mode != "" {
			q = q.Where("mode = ?", s.Mode)
		}
	} else {
		q = q.Where("mode = ?", models.CashModeCash)
	}
	if !s.From.IsZero() {
		q = q.Where("occurred_on >= ?", s.From)
	}
	branchCol := "branch_id"
	if s.Bank {
		branchCol = bankSideBranch("expenses", "from_bank_id")
	}
	if s.BranchID != nil {
		q = q.Where(branchCol+" = ?", *s.BranchID)
	}
	if len(s.ExcludeBranches) > 0 {
		q = q.Where(branchCol+" NOT IN ?", s.ExcludeBranches)
	}
	var total float64
	if err := q.Select("COALESCE(SUM(amount), 0)").Scan(&total).Error; err != nil {
		return 0, err
	}
	return total, nil
}

func RecordExpense(c echo.Context) error {
	ctx := auth.RequestContext(c)
	var req expenseRequest
	if err := common.BindJSON(c, &req); err != nil {
		return c.JSON(http.StatusBadRequest, echo.Map{"success": false, "error": "Invalid input"})
	}
	input, err := req.toInput()
	if err != nil {
		return common.FailErr(c, err)
	}
	input.BranchID = auth.EnforceBranchOnWrite(c, input.BranchID)
	rec, err := SaveExpense(ctx, input)
	if err != nil {
		return common.FailErr(c, err)
	}
	return common.Success(c, http.StatusOK, rec)
}

func ListExpenses(c echo.Context) error {
	ctx := auth.RequestContext(c)
	branchID := auth.GetBranchScope(c)
	search := strings.TrimSpace(c.QueryParam("search"))
	page, limit, offset := common.PageParams(c)
	if limit > 0 {
		rec, total, err := listExpenses(ctx, branchID, search, limit, offset)
		if err != nil {
			return common.FailErr(c, err)
		}
		totalAmount, err := sumExpenseFiltered(ctx, branchID, search)
		if err != nil {
			return common.FailErr(c, err)
		}
		return common.SuccessPage(c, page, limit, total, rec, echo.Map{"total_amount": totalAmount})
	}
	rec, _, err := listExpenses(ctx, branchID, search, 0, 0)
	if err != nil {
		return common.FailErr(c, err)
	}
	return common.SuccessAll(c, rec)
}

func ExportExpense(c echo.Context) error {
	ctx := auth.RequestContext(c)
	branchID := auth.GetBranchScope(c)
	rows, _, err := listExpenses(ctx, branchID, "", 0, 0)
	if err != nil {
		return common.FailErr(c, err)
	}
	tableRows := make([][]string, len(rows))
	for i, e := range rows {
		tableRows[i] = []string{
			e.OccurredOn.Format("2006-01-02"),
			e.Category,
			e.Mode,
			e.Branch.Name,
			strconv.FormatFloat(e.Amount, 'f', 2, 64),
			e.Status,
			e.Remarks,
		}
	}
	headers, tableRows := branchColumnFor(c, []string{"Date", "Category", "Mode", "Branch", "Amount", "Status", "Remarks"}, tableRows)
	pdfBytes, err := renderTablePDF(
		"Expense Register",
		"",
		headers,
		tableRows,
	)
	if err != nil {
		return common.FailWith(c, http.StatusBadRequest, "Could not generate the document, please try again", err)
	}
	c.Response().Header().Set("Content-Disposition", `attachment; filename="expense-register.pdf"`)
	return c.Blob(http.StatusOK, "application/pdf", pdfBytes)
}

func GetExpenseById(c echo.Context) error {
	ctx := auth.RequestContext(c)
	id, err := common.IDParam(c, "id")
	if err != nil {
		return common.FailErr(c, err)
	}
	rec, err := getExpense(ctx, id, auth.GetBranchScope(c))
	if err != nil {
		return common.FailErr(c, err)
	}
	return common.Success(c, http.StatusOK, rec)
}

func ApproveExpense(c echo.Context) error {
	ctx := auth.RequestContext(c)
	id, err := common.IDParam(c, "id")
	if err != nil {
		return common.FailErr(c, err)
	}
	var req approveExpenseRequest
	_ = common.BindJSON(c, &req)
	rec, err := approveAs(ctx, id, expenseActor(c, req.ApprovedBy), auth.GetBranchScope(c))
	if err != nil {
		return common.FailErr(c, err)
	}
	return common.Success(c, http.StatusOK, rec)
}

func RejectExpense(c echo.Context) error {
	ctx := auth.RequestContext(c)
	id, err := common.IDParam(c, "id")
	if err != nil {
		return common.FailErr(c, err)
	}
	var req rejectExpenseRequest
	if err := common.BindJSON(c, &req); err != nil {
		return c.JSON(http.StatusBadRequest, echo.Map{"success": false, "error": "Invalid input"})
	}
	rec, err := rejectAs(ctx, id, expenseActor(c, req.ApprovedBy), req.Remarks, auth.GetBranchScope(c))
	if err != nil {
		return common.FailErr(c, err)
	}
	return common.Success(c, http.StatusOK, rec)
}
