package controllers

import (
	"cloudhouse/backend/auth"
	common "cloudhouse/backend/common/controllers"
	"cloudhouse/backend/config"
	"cloudhouse/backend/modules/Cash/models"
	"context"
	"net/http"
	"strings"
	"time"

	"github.com/labstack/echo/v4"
	"gorm.io/gorm/clause"
)

const (
	entryCashIn       = "cash_in"
	entryDebit        = "debit"
	entrySelfTransfer = "self_transfer"
	entryGoldSale     = "gold_sale"

	debitPurposePrefix = "Expense — "
	selfPurposePrefix  = "Self transfer — "
)

// paymentPartRequest is one line of a payment breakdown: how much was paid in which mode (and through which
// bank for UPI / Bank Transfer).
type paymentPartRequest struct {
	Mode   string  `json:"mode"`
	Amount float64 `json:"amount"`
	BankID *uint   `json:"bank_id"`
}

type updateEntryRequest struct {
	Category     string               `json:"category"`
	Amount       float64              `json:"amount" binding:"required"`
	OccurredOn   string               `json:"occurred_on"`
	Remarks      string               `json:"remarks"`
	ReceiptImage *string              `json:"receipt_image"`
	BranchID     *uint                `json:"branch_id"`
	Payments     []paymentPartRequest `json:"payments"`
	FromBankID   uint                 `json:"from_bank_id"`
	FromBank     string               `json:"from_bank"`
	ToBankID     uint                 `json:"to_bank_id"`
	ToBank       string               `json:"to_bank"`
	Mode         string               `json:"mode"`
	// A gold sale edit: the ornament, what it cost, and the one bank its proceeds landed in.
	OrnamentType string  `json:"ornament_type"`
	CostAmount   float64 `json:"cost_amount"`
	BankID       *uint   `json:"bank_id"`
}

type entryLine struct {
	MovementID uint    `json:"movement_id"`
	Mode       string  `json:"mode"`
	Amount     float64 `json:"amount"`
	BankID     *uint   `json:"bank_id"`
	BankName   string  `json:"bank_name"`
}

// entryInfo is everything the ledger's info popup shows about a cash-in, a debit or a self transfer.
type entryInfo struct {
	Kind         string      `json:"kind"`
	ViaExpense   bool        `json:"via_expense,omitempty"`
	Editable     bool        `json:"editable"`
	MovementID   uint        `json:"movement_id"`
	Category     string      `json:"category"`
	Amount       float64     `json:"amount"`
	OccurredOn   time.Time   `json:"occurred_on"`
	RecordedAt   time.Time   `json:"recorded_at"`
	Remarks      string      `json:"remarks"`
	BranchID     *uint       `json:"branch_id"`
	BranchName   string      `json:"branch_name"`
	ReceiptImage string      `json:"receipt_image,omitempty"`
	Lines        []entryLine `json:"lines"`
	FromBankID   *uint       `json:"from_bank_id,omitempty"`
	FromBank     string      `json:"from_bank,omitempty"`
	ToBankID     *uint       `json:"to_bank_id,omitempty"`
	ToBank       string      `json:"to_bank,omitempty"`
	Status       string      `json:"status,omitempty"`
	OrnamentType string      `json:"ornament_type,omitempty"`
	// A draw on a loan: the loan's number and its principal.
	LoanNumber      string     `json:"loan_number,omitempty"`
	PrincipalAmount float64    `json:"principal_amount,omitempty"`
	CostAmount      float64    `json:"cost_amount,omitempty"`
	ApprovedBy      string     `json:"approved_by,omitempty"`
	ApprovedAt      *time.Time `json:"approved_at,omitempty"`
}

// paymentParts checks a payment breakdown and turns it into split parts: every mode must be Cash, UPI or
// Bank Transfer, a bank is needed for the two bank modes, and the lines must add up to the entry's amount.
func paymentParts(reqs []paymentPartRequest, total float64) ([]SplitPart, error) {
	parts := make([]SplitPart, 0, len(reqs))
	for _, r := range reqs {
		if r.Amount <= 0 {
			return nil, common.NewBadRequest("every payment amount must be greater than zero")
		}
		if !modeVocabulary[r.Mode] {
			return nil, common.NewBadRequest("payment mode must be Cash, UPI or Bank Transfer")
		}
		p := SplitPart{Mode: r.Mode, Amount: common.RoundMoney(r.Amount)}
		if r.Mode != models.CashModeCash {
			if r.BankID == nil || *r.BankID == 0 {
				return nil, common.NewBadRequest("bank is required when mode is UPI or Bank Transfer")
			}
			p.BankID = r.BankID
		}
		parts = append(parts, p)
	}
	parts = mergeSplitParts(parts)
	if len(parts) == 0 {
		return nil, common.NewBadRequest("payment breakdown is required")
	}
	if sum := SumSplitParts(parts); sum != common.RoundMoney(total) {
		return nil, common.NewBadRequest("payment breakdown must add up to the amount")
	}
	return parts, nil
}

// SaveMovementParts books a cash-in as one line per payment part, all under one transaction group, so each
// mode shows as its own ledger entry. A failure part-way removes the lines already written.
func SaveMovementParts(ctx context.Context, in RecordMovementInput, loan *LoanSourceInput, parts []SplitPart) (*models.CashMovement, error) {
	groupID := common.NewTransactionGroupID()
	var first *models.CashMovement
	var created []uint
	for _, p := range parts {
		line := in
		line.Amount, line.Mode, line.BankID, line.GroupID = p.Amount, p.Mode, p.BankID, groupID
		rec, err := SaveMovement(ctx, line, loan)
		if err != nil {
			for _, id := range created {
				_ = removeMovement(ctx, id)
			}
			return nil, err
		}
		created = append(created, rec.ID)
		if first == nil {
			first = rec
		}
	}
	return first, nil
}

// SaveExpenseParts files a debit as one expense per payment part, all sharing a group id, so each mode shows
// as its own entry and the group is approved (or rejected) together. A failure part-way removes the rows
// already written.
func SaveExpenseParts(ctx context.Context, in RecordExpenseInput, parts []SplitPart) (*models.Expense, error) {
	groupID := common.NewTransactionGroupID()
	var created []*models.Expense
	for _, p := range parts {
		line := in
		line.Amount, line.Mode, line.FromBankID, line.GroupID = p.Amount, p.Mode, p.BankID, groupID
		rec, err := SaveExpense(ctx, line)
		if err != nil {
			rollbackExpenses(ctx, created)
			return nil, err
		}
		created = append(created, rec)
	}
	return created[0], nil
}

func rollbackExpenses(ctx context.Context, recs []*models.Expense) {
	ids := make([]uint, 0, len(recs))
	for _, r := range recs {
		ids = append(ids, r.ID)
	}
	if len(ids) == 0 {
		return
	}
	_ = config.DB.WithContext(ctx).Where("expense_id IN ?", ids).Delete(&models.CashMovement{}).Error
	_ = deleteByIDs(ctx, ids)
}

// entryMovements is every cash line of the entry a movement belongs to: the other payment parts of a cash-in
// or debit, both legs of a self transfer.
func entryMovements(ctx context.Context, m *models.CashMovement) ([]models.CashMovement, error) {
	if m.TransactionGroupID == "" {
		return []models.CashMovement{*m}, nil
	}
	var rows []models.CashMovement
	err := config.DB.WithContext(ctx).
		Preload("Branch").Preload("BankRef").Preload("CounterBankRef").
		Where("transaction_group_id = ? AND is_manual = ?", m.TransactionGroupID, true).
		Order("id").Find(&rows).Error
	if err != nil {
		return nil, err
	}
	if len(rows) == 0 {
		return []models.CashMovement{*m}, nil
	}
	return rows, nil
}

func entryKind(m *models.CashMovement) string {
	switch {
	case m.Source == SelfTransferSource:
		return entrySelfTransfer
	case m.Source == goldSaleSource && m.Type == "in":
		return entryGoldSale
	case m.ExpenseID != nil:
		return entryDebit
	case m.Type == "in":
		return entryCashIn
	}
	return ""
}

// GetMovementEntry returns the info popup's data for one cash-in, debit or self transfer.
func GetMovementEntry(c echo.Context) error {
	ctx := auth.RequestContext(c)
	id, err := common.IDParam(c, "id")
	if err != nil {
		return common.FailErr(c, err)
	}
	m, err := getMovement(ctx, id, auth.GetBranchScope(c))
	if err != nil {
		return common.FailErr(c, err)
	}
	kind := entryKind(m)
	if !m.IsManual || kind == "" {
		return systemEntryInfo(c, ctx, m)
	}
	rows, err := entryMovements(ctx, m)
	if err != nil {
		return common.FailErr(c, err)
	}
	first := rows[0]
	info := entryInfo{
		Kind: kind, Editable: true, MovementID: first.ID, OccurredOn: first.OccurredOn, RecordedAt: first.CreatedAt,
		Remarks: first.Remarks, BranchID: first.BranchID, ReceiptImage: first.ReceiptImage, Lines: []entryLine{},
	}
	if first.Branch != nil {
		info.BranchName = first.Branch.Name
	}
	for _, r := range rows {
		bankName := r.Bank
		if r.BankRef != nil {
			bankName = r.BankRef.Name
		}
		if kind == entrySelfTransfer {
			if r.Type == "out" {
				info.FromBankID, info.FromBank = r.BankID, bankName
				info.Amount = r.Amount
				info.Lines = append(info.Lines, entryLine{MovementID: r.ID, Mode: r.Mode, Amount: r.Amount, BankID: r.BankID, BankName: bankName})
			} else {
				info.ToBankID, info.ToBank = r.BankID, bankName
			}
			continue
		}
		info.Amount = common.RoundMoney(info.Amount + r.Amount)
		info.Lines = append(info.Lines, entryLine{MovementID: r.ID, Mode: r.Mode, Amount: r.Amount, BankID: r.BankID, BankName: bankName})
	}
	switch kind {
	case entrySelfTransfer:
		info.Category = strings.TrimPrefix(first.Purpose, selfPurposePrefix)
		if len(info.Lines) == 0 {
			info.Amount = first.Amount
		}
	case entryDebit:
		info.Category = strings.TrimPrefix(first.Purpose, debitPurposePrefix)
		if first.ExpenseID != nil {
			if e, err := findExpenseByID(ctx, *first.ExpenseID); err == nil {
				info.Status, info.ApprovedAt = e.Status, e.ApprovedAt
				if e.ApprovedBy != nil {
					info.ApprovedBy = *e.ApprovedBy
				}
			}
		}
	case entryGoldSale:
		info.Category = "Gold Sale"
		var gs models.GoldSale
		if err := config.DB.WithContext(ctx).Where("cash_movement_id = ?", first.ID).First(&gs).Error; err != nil || gs.CostCashMovementID != nil {
			return common.FailErr(c, common.NewNotFound("this gold sale can't be edited"))
		}
		info.OrnamentType, info.CostAmount, info.Remarks, info.ReceiptImage = gs.OrnamentType, gs.CostAmount, gs.Remarks, gs.ReceiptImage
	default:
		info.Category = first.Source
		if src := findLoanSource(ctx, first.Source); src != nil {
			info.LoanNumber = src.LoanNumber
			if src.PrincipalAmount != nil {
				info.PrincipalAmount = *src.PrincipalAmount
			}
		}
	}
	return common.Success(c, http.StatusOK, info)
}

// systemEntryInfo is the read-only info popup for a movement the system recorded itself (loan
// disbursement, repayment, auction, etc.): it never offers Edit.
func systemEntryInfo(c echo.Context, ctx context.Context, m *models.CashMovement) error {
	category := m.Purpose
	if category == "" {
		category = m.Source
	}
	info := entryInfo{
		Kind: "system", Editable: false, MovementID: m.ID, Category: category, Amount: m.Amount,
		OccurredOn: m.OccurredOn, RecordedAt: m.CreatedAt, Remarks: m.Remarks,
		BranchID: m.BranchID, ReceiptImage: m.ReceiptImage,
	}
	if m.Branch != nil {
		info.BranchName = m.Branch.Name
	}
	bankName := m.Bank
	if m.BankRef != nil {
		bankName = m.BankRef.Name
	}
	info.Lines = []entryLine{{MovementID: m.ID, Mode: m.Mode, Amount: m.Amount, BankID: m.BankID, BankName: bankName}}
	if src := findLoanSource(ctx, m.Source); src != nil {
		info.LoanNumber = src.LoanNumber
		if src.PrincipalAmount != nil {
			info.PrincipalAmount = *src.PrincipalAmount
		}
	}
	return common.Success(c, http.StatusOK, info)
}

// editOccurredOn keeps the recorded time of day when the date was not changed.
func editOccurredOn(raw string, old time.Time) (time.Time, error) {
	if raw == "" {
		return old, nil
	}
	t, err := time.ParseInLocation("2006-01-02", raw, time.Local)
	if err != nil {
		return time.Time{}, common.NewBadRequest("invalid occurred_on: expected YYYY-MM-DD")
	}
	oy, om, od := old.In(time.Local).Date()
	if ty, tm, td := t.Date(); ty == oy && tm == om && td == od {
		return old, nil
	}
	return parseOccurredOn(raw)
}

func removeMovementRows(ctx context.Context, rows []models.CashMovement) error {
	ids := make([]uint, 0, len(rows))
	for _, r := range rows {
		ids = append(ids, r.ID)
	}
	return config.DB.WithContext(ctx).Where("id IN ?", ids).Delete(&models.CashMovement{}).Error
}

// restoreEntry puts the rows an edit removed back, with their original ids, when the new version was refused.
func restoreEntry(ctx context.Context, expenses []models.Expense, rows []models.CashMovement) {
	// Omit the preloaded branch / bank records: only the rows themselves are put back.
	for i := range expenses {
		_ = config.DB.WithContext(ctx).Omit(clause.Associations).Create(&expenses[i]).Error
	}
	for i := range rows {
		_ = config.DB.WithContext(ctx).Omit(clause.Associations).Create(&rows[i]).Error
	}
}

// UpdateMovement edits a cash-in, a debit or a self transfer from the ledger. The entry (every payment part,
// or both legs of a self transfer) is replaced by the edited version; if the new version is refused the
// original is put back untouched.
func UpdateMovement(c echo.Context) error {
	ctx := auth.RequestContext(c)
	id, err := common.IDParam(c, "id")
	if err != nil {
		return common.FailErr(c, err)
	}
	var req updateEntryRequest
	if err := common.BindJSON(c, &req); err != nil {
		return c.JSON(http.StatusBadRequest, echo.Map{"success": false, "error": "Invalid input"})
	}
	m, err := getMovement(ctx, id, auth.GetBranchScope(c))
	if err != nil {
		return common.FailErr(c, err)
	}
	return applyEntryUpdate(c, ctx, m, req)
}

// applyEntryUpdate replaces the entry a movement belongs to with the edited version in req.
func applyEntryUpdate(c echo.Context, ctx context.Context, m *models.CashMovement, req updateEntryRequest) error {
	kind := entryKind(m)
	if !m.IsManual || kind == "" {
		return common.FailErr(c, common.NewConflict("this entry can't be edited"))
	}
	old, err := entryMovements(ctx, m)
	if err != nil {
		return common.FailErr(c, err)
	}
	occurred, err := editOccurredOn(req.OccurredOn, old[0].OccurredOn)
	if err != nil {
		return common.FailErr(c, err)
	}
	branchID := old[0].BranchID
	if req.BranchID != nil {
		b := auth.EnforceBranchOnWrite(c, *req.BranchID)
		branchID = &b
	}
	receipt := old[0].ReceiptImage
	if req.ReceiptImage != nil {
		receipt = *req.ReceiptImage
	}
	remarks := strings.TrimSpace(req.Remarks)
	var newID uint
	switch kind {
	case entrySelfTransfer:
		newID, err = editSelfTransfer(ctx, old, RecordSelfTransferInput{
			Category: req.Category, Amount: req.Amount, FromBankID: req.FromBankID, FromBank: req.FromBank,
			ToBankID: req.ToBankID, ToBank: req.ToBank, Mode: req.Mode, ReceiptImage: receipt,
			BranchID: branchID, OccurredOn: occurred, Remarks: remarks,
		})
	case entryDebit:
		newID, err = editDebit(ctx, old, req, occurred, branchID, receipt, remarks)
	case entryGoldSale:
		newID, err = editGoldSale(ctx, old[0], req, occurred, branchID, receipt, remarks)
	default:
		newID, err = editCashIn(ctx, old, req, occurred, branchID, receipt, remarks)
	}
	if err != nil {
		return common.FailErr(c, err)
	}
	return common.Success(c, http.StatusOK, echo.Map{"id": newID})
}

// editParts is the payment breakdown an edit sends, or, when it sends none, the entry's single original mode.
func editParts(req updateEntryRequest, old models.CashMovement) ([]SplitPart, error) {
	if len(req.Payments) > 0 {
		return paymentParts(req.Payments, req.Amount)
	}
	return paymentParts([]paymentPartRequest{{Mode: old.Mode, Amount: req.Amount, BankID: old.BankID}}, req.Amount)
}

func editSelfTransfer(ctx context.Context, old []models.CashMovement, in RecordSelfTransferInput) (uint, error) {
	if err := removeMovementRows(ctx, old); err != nil {
		return 0, err
	}
	rows, err := recordSelfTransfer(ctx, in)
	if err != nil {
		restoreEntry(ctx, nil, old)
		return 0, err
	}
	return rows[0].ID, nil
}

func editCashIn(ctx context.Context, old []models.CashMovement, req updateEntryRequest, occurred time.Time, branchID *uint, receipt, remarks string) (uint, error) {
	category := strings.TrimSpace(req.Category)
	if category == "" {
		category = old[0].Source
	}
	// A draw on a loan stays on that loan.
	isLoan := IsLoanSource(old[0].Source)
	if isLoan {
		category = old[0].Source
	}
	parts, err := editParts(req, old[0])
	if err != nil {
		return 0, err
	}
	oldIDs := make([]uint, 0, len(old))
	for _, r := range old {
		oldIDs = append(oldIDs, r.ID)
	}
	var loanRows []models.LoanCashSource
	if isLoan {
		if err := config.DB.WithContext(ctx).Where("cash_movement_id IN ?", oldIDs).Find(&loanRows).Error; err != nil {
			return 0, err
		}
		if err := config.DB.WithContext(ctx).Where("cash_movement_id IN ?", oldIDs).Delete(&models.LoanCashSource{}).Error; err != nil {
			return 0, err
		}
	}
	restoreLoan := func() {
		restoreEntry(ctx, nil, old)
		for i := range loanRows {
			_ = config.DB.WithContext(ctx).Omit(clause.Associations).Create(&loanRows[i]).Error
		}
	}
	if err := removeMovementRows(ctx, old); err != nil {
		restoreLoan()
		return 0, err
	}
	rec, err := SaveMovementParts(ctx, RecordMovementInput{
		Type: "in", Source: category, Amount: req.Amount, ReceiptImage: receipt, BranchID: branchID,
		OccurredOn: occurred, Remarks: remarks, Manual: true,
	}, nil, parts)
	if err != nil {
		restoreLoan()
		return 0, err
	}
	return rec.ID, nil
}

func editDebit(ctx context.Context, old []models.CashMovement, req updateEntryRequest, occurred time.Time, branchID *uint, receipt, remarks string) (uint, error) {
	expenseIDs := make([]uint, 0, len(old))
	for _, r := range old {
		if r.ExpenseID != nil {
			expenseIDs = append(expenseIDs, *r.ExpenseID)
		}
	}
	var oldExpenses []models.Expense
	if err := config.DB.WithContext(ctx).Where("id IN ?", expenseIDs).Order("id").Find(&oldExpenses).Error; err != nil {
		return 0, err
	}
	if len(oldExpenses) == 0 || oldExpenses[0].Status != "Approved" {
		return 0, common.NewConflict("only an approved expense can be edited")
	}
	tmpl := oldExpenses[0]
	category := strings.TrimSpace(req.Category)
	if category == "" {
		category = tmpl.Category
	}
	if branchID == nil {
		b := tmpl.BranchID
		branchID = &b
	}
	parts, err := editParts(req, old[0])
	if err != nil {
		return 0, err
	}
	if err := removeMovementRows(ctx, old); err != nil {
		return 0, err
	}
	if err := deleteByIDs(ctx, expenseIDs); err != nil {
		restoreEntry(ctx, nil, old)
		return 0, err
	}
	fail := func(created []*models.Expense, err error) (uint, error) {
		rollbackExpenses(ctx, created)
		restoreEntry(ctx, oldExpenses, old)
		return 0, err
	}
	if err := ensureLoanRepayment(ctx, category, req.Amount, false); err != nil {
		return fail(nil, err)
	}
	groupID := common.NewTransactionGroupID()
	var created []*models.Expense
	for _, p := range parts {
		if p.Mode == models.CashModeCash && !config.IsDemoRun(ctx) {
			if err := EnsureCashInHand(ctx, *branchID, p.Amount); err != nil {
				return fail(created, err)
			}
		}
		if err := ensureExpenseBank(ctx, p.Mode, p.BankID, p.Amount); err != nil {
			return fail(created, err)
		}
		rec := &models.Expense{
			OccurredOn: occurred, Category: category, Amount: p.Amount, Mode: p.Mode, Payee: tmpl.Payee,
			FromBankID: p.BankID, BranchID: *branchID, Status: "Approved", ApprovalStage: tmpl.ApprovalStage,
			Remarks: remarks, ApprovedBy: tmpl.ApprovedBy, ApprovedAt: tmpl.ApprovedAt, ReceiptImage: receipt, GroupID: groupID,
		}
		if err := insertExpense(ctx, rec); err != nil {
			return fail(created, err)
		}
		created = append(created, rec)
		movementID, err := recordExpenseLine(ctx, rec)
		if err != nil {
			return fail(created, err)
		}
		rec.CashMovementID = &movementID
		if err := persistExpense(ctx, rec); err != nil {
			return fail(created, err)
		}
	}
	return *created[0].CashMovementID, nil
}
