package controllers

import (
	"cloudhouse/backend/auth"
	common "cloudhouse/backend/common/controllers"
	"cloudhouse/backend/config"
	"cloudhouse/backend/modules/Cash/models"
	reports "cloudhouse/backend/modules/Reports/controllers"
	"context"
	"fmt"
	"net/http"
	"strconv"
	"strings"
	"time"

	"github.com/labstack/echo/v4"

	"gorm.io/gorm"
)

type RecordMovementInput struct {
	Type         string
	Source       string
	Purpose      string
	Mode         string
	Bank         string
	BankID       *uint
	ToBankID     *uint
	Amount       float64
	ReceiptImage string
	BranchID     *uint
	OccurredOn   time.Time
}

type movementRequest struct {
	Type         string             `json:"type" binding:"required"`
	Source       string             `json:"source"`
	Purpose      string             `json:"purpose"`
	Mode         string             `json:"mode"`
	Bank         string             `json:"bank"`
	BankID       *uint              `json:"bank_id"`
	ToBankID     *uint              `json:"to_bank_id"`
	Amount       float64            `json:"amount" binding:"required"`
	ReceiptImage string             `json:"receipt_image"`
	BranchID     *uint              `json:"branch_id"`
	OccurredOn   string             `json:"occurred_on"`
	LoanSource   *loanSourceRequest `json:"loan_source"`
}

type movementResponse struct {
	*models.CashMovement
	LoanSource *models.LoanCashSource `json:"loan_source,omitempty"`
}

type MovementFilter struct {
	BranchIDs   []uint
	CustomerIDs []uint
	Categories  []string
}

func listCashMovementsByBank(ctx context.Context, bankID uint, fromDate, toDate time.Time, limit, offset int) ([]models.CashMovement, int64, PartyTotals, error) {
	rows, total, err := listByBank(ctx, bankID, fromDate, toDate, limit, offset)
	if err != nil {
		return nil, 0, PartyTotals{}, err
	}
	all, _, err := listByBank(ctx, bankID, fromDate, toDate, 0, 0)
	if err != nil {
		return nil, 0, PartyTotals{}, err
	}
	return rows, total, sumPartyTotals(all), nil
}

func listCashMovementsByCustomer(ctx context.Context, customerID uint, fromDate, toDate time.Time, loanNumbers []string, limit, offset int) ([]models.CashMovement, int64, PartyTotals, error) {
	rows, total, err := listByCustomer(ctx, customerID, fromDate, toDate, loanNumbers, limit, offset)
	if err != nil {
		return nil, 0, PartyTotals{}, err
	}
	all, _, err := listByCustomer(ctx, customerID, fromDate, toDate, loanNumbers, 0, 0)
	if err != nil {
		return nil, 0, PartyTotals{}, err
	}
	return rows, total, sumPartyTotals(all), nil
}

func listCashMovementsByBranch(ctx context.Context, branchID uint, fromDate, toDate time.Time, limit, offset int) ([]models.CashMovement, int64, PartyTotals, error) {
	rows, total, err := listByBranch(ctx, branchID, fromDate, toDate, limit, offset)
	if err != nil {
		return nil, 0, PartyTotals{}, err
	}
	all, _, err := listByBranch(ctx, branchID, fromDate, toDate, 0, 0)
	if err != nil {
		return nil, 0, PartyTotals{}, err
	}
	return rows, total, sumPartyTotals(all), nil
}

func recordSplitCashMovement(ctx context.Context, base models.CashMovement, amount float64, components []splitComponent) (uint, string, error) {
	groupID := common.NewTransactionGroupID()
	var firstID uint
	var wrote int
	for _, c := range components {
		if c.amount <= 0 {
			continue
		}
		rec := base
		rec.Mode = c.mode
		rec.Amount = c.amount
		rec.TransactionGroupID = groupID
		if c.mode == models.CashModeCash {
			rec.BankID = nil
		}
		if err := insertMovement(ctx, &rec); err != nil {
			return 0, "", err
		}
		if wrote == 0 {
			firstID = rec.ID
		}
		wrote++
	}
	if wrote == 0 {
		rec := base
		rec.Amount = amount
		rec.TransactionGroupID = groupID
		if err := insertMovement(ctx, &rec); err != nil {
			return 0, "", err
		}
		firstID = rec.ID
	}
	return firstID, groupID, nil
}

func DeleteCashMovement(ctx context.Context, id uint) error {
	return removeMovement(ctx, id)
}

func DeleteLoanDisbursementCashMovements(ctx context.Context, loanNumber string) error {
	return deleteByPurposes(ctx, []string{
		"Loan disbursement — " + loanNumber,
		"Service charge — " + loanNumber,
	})
}

func movementQueryFilter(c echo.Context) MovementFilter {
	return MovementFilter{
		BranchIDs:   parseUintCSV(c.QueryParam("branch_ids")),
		CustomerIDs: parseUintCSV(c.QueryParam("customer_ids")),
		Categories:  parseStringCSV(c.QueryParam("types")),
	}
}

func filteredMovements(ctx context.Context, branchID *uint, fromDate, toDate time.Time, filter MovementFilter, search string) *gorm.DB {
	q := config.DB.
		WithContext(ctx).Model(&models.CashMovement{})
	if branchID != nil {
		q = q.Where("branch_id = ?", *branchID)
	}
	if len(filter.BranchIDs) > 0 {
		q = q.Where("branch_id IN ?", filter.BranchIDs)
	}
	if len(filter.CustomerIDs) > 0 {
		q = q.Where("party_customer_id IN ?", filter.CustomerIDs)
	}
	if !fromDate.IsZero() {
		q = q.Where("occurred_on >= ?", fromDate)
	}
	if !toDate.IsZero() {
		q = q.Where("occurred_on < ?", toDate.AddDate(0, 0, 1))
	}
	if len(filter.Categories) > 0 {
		orQ := config.DB.
			WithContext(ctx)
		any := false
		for _, cat := range filter.Categories {
			clause, args := categoryWhere(cat)
			if clause == "" {
				continue
			}
			orQ = orQ.Or(clause, args...)
			any = true
		}
		if any {
			q = q.Where(orQ)
		}
	}
	if search != "" {
		like := "%" + search + "%"
		q = q.Where("purpose ILIKE ? OR source ILIKE ? OR bank ILIKE ?", like, like, like)
	}
	return q
}

func findByCashMovementIDs(ctx context.Context, ids []uint) map[uint]*models.LoanCashSource {
	out := map[uint]*models.LoanCashSource{}
	if len(ids) == 0 {
		return out
	}
	var recs []models.LoanCashSource
	if err := config.DB.
		WithContext(ctx).Preload("Bank").Where("cash_movement_id IN ?", ids).Find(&recs).Error; err != nil {
		return out
	}
	for i := range recs {
		out[recs[i].CashMovementID] = &recs[i]
	}
	return out
}

func findByCashMovementID(ctx context.Context, cashMovementID uint) (*models.LoanCashSource, error) {
	var rec models.LoanCashSource
	if err := config.DB.
		WithContext(ctx).Preload("Bank").Where("cash_movement_id = ?", cashMovementID).First(&rec).Error; err != nil {
		return nil, err
	}
	return &rec, nil
}

func loanBalance(ctx context.Context, src *models.CashSource, includePending bool) (LoanBalance, error) {
	var b LoanBalance
	if src.PrincipalAmount != nil {
		b.Principal = *src.PrincipalAmount
	}
	since := src.CreatedAt
	if src.LoanOpenedAt != nil {
		since = *src.LoanOpenedAt
	}
	var err error
	if b.Drawn, err = loanDrawn(ctx, src.Name, since); err != nil {
		return b, err
	}
	if b.Repaid, err = loanRepaid(ctx, src.Name, since, includePending); err != nil {
		return b, err
	}
	b.Balance = b.Principal - b.Drawn + b.Repaid
	return b, nil
}

func ensureLoanRepayment(ctx context.Context, category string, amount float64, includePending bool) error {
	src := findLoanSource(ctx, category)
	if src == nil {
		return nil
	}
	b, err := loanBalance(ctx, src, includePending)
	if err != nil {
		return err
	}
	if room := b.Principal - b.Balance; amount > room+0.005 {
		return common.NewBadRequest(fmt.Sprintf("repayment exceeds the loan principal — only ₹%.2f is still owed on %s", max(room, 0), src.Name))
	}
	return nil
}

func SaveMovement(ctx context.Context, in RecordMovementInput, loanSource *LoanSourceInput) (*models.CashMovement, error) {
	if in.Amount <= 0 {
		return nil, common.NewBadRequest("amount must be greater than zero")
	}
	if in.Type != "in" && in.Type != "out" {
		return nil, common.NewBadRequest("type must be \"in\" or \"out\"")
	}
	if in.BranchID != nil {
		ok, err := common.BranchExists(ctx, *in.BranchID)
		if err != nil {
			return nil, err
		}
		if !ok {
			return nil, common.NewBadRequest("branch does not exist")
		}
	}
	rec := &models.CashMovement{
		Type:         in.Type,
		Amount:       in.Amount,
		Mode:         in.Mode,
		Bank:         in.Bank,
		BankID:       in.BankID,
		ToBankID:     in.ToBankID,
		BranchID:     in.BranchID,
		ReceiptImage: in.ReceiptImage,
	}
	if in.OccurredOn.IsZero() {
		rec.OccurredOn = time.Now()
	} else {
		rec.OccurredOn = in.OccurredOn
	}
	if in.Type == "in" {
		if in.Source == "" {
			return nil, common.NewBadRequest("source is required for cash-in movements")
		}
		if in.Mode == "" {
			return nil, common.NewBadRequest("mode of cash is required for cash-in movements")
		}
		if (in.Mode == models.CashModeUPI || in.Mode == models.CashModeBankTransfer) && in.BankID == nil && in.Bank == "" {
			return nil, common.NewBadRequest("bank is required when mode is UPI or Bank Transfer")
		}
		rec.Source = in.Source
	} else {
		if in.Purpose == "" {
			return nil, common.NewBadRequest("purpose is required for cash-out movements")
		}
		rec.Purpose = in.Purpose
	}
	isLoan := in.Type == "in" && IsLoanSource(in.Source)
	var src *models.CashSource
	newLoan := false
	if isLoan {
		var err error
		if src, err = resolveLoanSource(ctx, in.Source); err != nil {
			return nil, err
		}
		if !hasLoanDetails(src) {
			if loanSource == nil || loanSource.BankID == 0 {
				return nil, common.NewBadRequest("bank is required for a loan-sourced cash entry")
			}
			if strings.TrimSpace(loanSource.LoanNumber) == "" {
				return nil, common.NewBadRequest("loan number is required for a loan-sourced cash entry")
			}
			if loanSource.PrincipalAmount <= 0 {
				return nil, common.NewBadRequest("principal amount must be greater than zero for a loan-sourced cash entry")
			}
			bankID, principal, opened := loanSource.BankID, loanSource.PrincipalAmount, time.Now()
			src.BankID, src.LoanNumber, src.PrincipalAmount = &bankID, strings.TrimSpace(loanSource.LoanNumber), &principal
			src.LoanOpenedAt = &opened
			newLoan = true
		}
		b, err := loanBalance(ctx, src, false)
		if err != nil {
			return nil, err
		}
		if in.Amount > b.Balance+0.005 {
			return nil, common.NewBadRequest(fmt.Sprintf("amount exceeds the loan balance — only ₹%.2f is left to draw on %s", max(b.Balance, 0), src.Name))
		}
		rec.Source = src.Name
		rec.Status = "Open"
		rec.Purpose = "Loan no. " + src.LoanNumber
		if rec.Bank == "" && src.Bank != nil {
			rec.Bank = src.Bank.Name
		}
		if rec.BankID == nil {
			bankID := *src.BankID
			rec.BankID = &bankID
		}
	}
	if err := insertMovement(ctx, rec); err != nil {
		return nil, err
	}
	if isLoan {
		if newLoan {
			if err := saveLoanDetails(ctx, src); err != nil {
				return nil, err
			}
			if err := ensureLoanCategory(ctx, src.Name); err != nil {
				return nil, err
			}
		}
		loanRec := &models.LoanCashSource{
			CashMovementID:  rec.ID,
			BankID:          *src.BankID,
			LoanNumber:      src.LoanNumber,
			PrincipalAmount: *src.PrincipalAmount,
		}
		if err := insertLoanCashSource(ctx, loanRec); err != nil {
			return nil, err
		}
	}
	return findMovementByID(ctx, rec.ID)
}

func recordSelfTransfer(ctx context.Context, in RecordSelfTransferInput) ([]models.CashMovement, error) {
	category := strings.TrimSpace(in.Category)
	if category == "" {
		return nil, common.NewBadRequest("category is required")
	}
	if in.Amount <= 0 {
		return nil, common.NewBadRequest("amount must be greater than zero")
	}
	if in.BranchID != nil {
		ok, err := common.BranchExists(ctx, *in.BranchID)
		if err != nil {
			return nil, err
		}
		if !ok {
			return nil, common.NewBadRequest("branch does not exist")
		}
	}
	toBankID, toBank := in.ToBankID, in.ToBank
	if IsLoanSource(category) {
		src, err := resolveLoanSource(ctx, category)
		if err != nil {
			return nil, err
		}
		if !hasLoanDetails(src) {
			return nil, common.NewBadRequest("this loan has no bank recorded yet — add cash from it first")
		}
		toBankID = *src.BankID
		if src.Bank != nil {
			toBank = src.Bank.Name
		}
		category = src.Name
		if err := ensureLoanRepayment(ctx, category, in.Amount, false); err != nil {
			return nil, err
		}
	}
	if in.FromBankID == 0 || toBankID == 0 {
		return nil, common.NewBadRequest("from bank and to bank are required")
	}
	if in.FromBankID == toBankID {
		return nil, common.NewBadRequest("from bank and to bank must be different")
	}
	mode := in.Mode
	switch mode {
	case "":
		mode = models.CashModeBankTransfer
	case models.CashModeBankTransfer, models.CashModeUPI, models.CashModeCash:
	default:
		return nil, common.NewBadRequest("mode must be Bank Transfer, UPI or Cash")
	}
	occurred := in.OccurredOn
	if occurred.IsZero() {
		occurred = time.Now()
	}
	groupID := common.NewTransactionGroupID()
	purpose := "Self transfer — " + category
	fromID, toID := in.FromBankID, toBankID
	debit := &models.CashMovement{
		Type: "out", Source: SelfTransferSource, Purpose: purpose, Mode: mode, ReceiptImage: in.ReceiptImage,
		Bank: in.FromBank, BankID: &fromID, CounterBankID: &toID, Amount: in.Amount, BranchID: in.BranchID,
		OccurredOn: occurred, TransactionGroupID: groupID,
	}
	credit := &models.CashMovement{
		Type: "in", Source: SelfTransferSource, Purpose: purpose, Mode: mode, ReceiptImage: in.ReceiptImage,
		Bank: toBank, BankID: &toID, CounterBankID: &fromID, Amount: in.Amount, BranchID: in.BranchID,
		OccurredOn: occurred, TransactionGroupID: groupID,
	}
	if err := insertMovement(ctx, debit); err != nil {
		return nil, err
	}
	if err := insertMovement(ctx, credit); err != nil {
		_ = removeMovement(ctx, debit.ID)
		return nil, err
	}
	d, err := findMovementByID(ctx, debit.ID)
	if err != nil {
		return nil, err
	}
	c, err := findMovementByID(ctx, credit.ID)
	if err != nil {
		return nil, err
	}
	return []models.CashMovement{*d, *c}, nil
}

func listMovements(ctx context.Context, branchID *uint, fromDate, toDate time.Time, category, search string, limit, offset int) ([]models.CashMovement, int64, error) {
	return findMovements(ctx, branchID, fromDate, toDate, category, search, limit, offset)
}

func listFiltered(ctx context.Context, branchID *uint, fromDate, toDate time.Time, filter MovementFilter, search string, limit, offset int) ([]models.CashMovement, int64, error) {
	return findAllFiltered(ctx, branchID, fromDate, toDate, filter, search, limit, offset)
}

func sumMovementFiltered(ctx context.Context, branchID *uint, fromDate, toDate time.Time, filter MovementFilter, search string) (float64, float64, error) {
	return sumFilteredRows(ctx, branchID, fromDate, toDate, filter, search)
}

func netMovementOfNewest(ctx context.Context, branchID *uint, fromDate, toDate time.Time, filter MovementFilter, search string, n int) (float64, error) {
	return netOfNewestRows(ctx, branchID, fromDate, toDate, filter, search, n)
}

func getMovement(ctx context.Context, id uint, branchID *uint) (*models.CashMovement, error) {
	rec, err := findMovementByID(ctx, id)
	if err != nil {
		return nil, common.NewNotFound("cash movement not found")
	}
	if branchID != nil && (rec.BranchID == nil || *rec.BranchID != *branchID) {
		return nil, common.NewNotFound("cash movement not found")
	}
	return rec, nil
}

func RecordBankPledgeCashIn(ctx context.Context, loanID uint, loanNumber, bankName string, amount, cashAmount, upiAmount, bankTransferAmount, chequeAmount float64, bankID *uint, occurredOn time.Time) (uint, error) {
	hoID, err := pledgeBranchID(ctx, bankID, upiAmount+bankTransferAmount+chequeAmount)
	if err != nil {
		return 0, err
	}
	base := models.CashMovement{
		Type:     "in",
		Source:   "Bank",
		Purpose:  "Bank pledge — " + bankName + " — " + loanNumber,
		Bank:     bankName,
		BankID:   bankID,
		BranchID: &hoID,
	}
	if occurredOn.IsZero() {
		base.OccurredOn = time.Now()
	} else {
		base.OccurredOn = occurredOn
	}
	if cashAmount+upiAmount+bankTransferAmount+chequeAmount == 0 {
		cashAmount = amount
	}
	id, _, err := recordSplitCashMovement(ctx, base, amount, []splitComponent{
		{models.CashModeCash, cashAmount},
		{models.CashModeUPI, upiAmount},
		{models.CashModeBankTransfer, bankTransferAmount},
		{models.CashModeCheque, chequeAmount},
	})
	return id, err
}

func RecordServiceChargeCashIn(ctx context.Context, loanID uint, loanNumber string, amount, cashAmount, upiAmount, bankTransferAmount, chequeAmount float64, branchID uint, occurredOn time.Time, bankID *uint) (uint, error) {
	base := models.CashMovement{
		Type:     "in",
		Source:   "Service Charge",
		Purpose:  "Service charge — " + loanNumber,
		BranchID: &branchID,
		BankID:   bankID,
	}
	if occurredOn.IsZero() {
		base.OccurredOn = time.Now()
	} else {
		base.OccurredOn = occurredOn
	}
	id, _, err := recordSplitCashMovement(ctx, base, amount, []splitComponent{
		{models.CashModeCash, cashAmount},
		{models.CashModeUPI, upiAmount},
		{models.CashModeBankTransfer, bankTransferAmount},
		{models.CashModeCheque, chequeAmount},
	})
	return id, err
}

func RecordLoanDisbursementCashOut(ctx context.Context, loanID uint, loanNumber string, amount, cashAmount, upiAmount, bankTransferAmount, chequeAmount float64, branchID uint, occurredOn time.Time, customerID uint, bankID *uint) (uint, string, error) {
	base := models.CashMovement{
		Type:     "out",
		Purpose:  "Loan disbursement — " + loanNumber,
		BranchID: &branchID,
		BankID:   bankID,
	}
	if occurredOn.IsZero() {
		base.OccurredOn = time.Now()
	} else {
		base.OccurredOn = occurredOn
	}
	if customerID != 0 {
		base.PartyCustomerID = &customerID
	}
	return recordSplitCashMovement(ctx, base, amount, []splitComponent{
		{models.CashModeCash, cashAmount},
		{models.CashModeUPI, upiAmount},
		{models.CashModeBankTransfer, bankTransferAmount},
		{models.CashModeCheque, chequeAmount},
	})
}

func RecordLoanTopUpCashOut(ctx context.Context, loanID uint, loanNumber string, amount, cashAmount, upiAmount, bankTransferAmount, chequeAmount float64, branchID uint, occurredOn time.Time, customerID uint) (uint, string, error) {
	base := models.CashMovement{
		Type:     "out",
		Purpose:  "Loan top-up — " + loanNumber,
		BranchID: &branchID,
	}
	if occurredOn.IsZero() {
		base.OccurredOn = time.Now()
	} else {
		base.OccurredOn = occurredOn
	}
	if customerID != 0 {
		base.PartyCustomerID = &customerID
	}
	return recordSplitCashMovement(ctx, base, amount, []splitComponent{
		{models.CashModeCash, cashAmount},
		{models.CashModeUPI, upiAmount},
		{models.CashModeBankTransfer, bankTransferAmount},
		{models.CashModeCheque, chequeAmount},
	})
}

func RecordLoanPaymentCashIn(ctx context.Context, loanID uint, loanNumber string, amount, cashAmount, upiAmount, bankTransferAmount, chequeAmount float64, branchID uint, occurredOn time.Time, paymentType string, customerID uint, bankID *uint) (uint, string, error) {
	base := models.CashMovement{
		Type:     "in",
		Source:   "Collection",
		Purpose:  fmt.Sprintf("%s — %s", paymentType, loanNumber),
		BranchID: &branchID,
		BankID:   bankID,
	}
	if occurredOn.IsZero() {
		base.OccurredOn = time.Now()
	} else {
		base.OccurredOn = occurredOn
	}
	if customerID != 0 {
		base.PartyCustomerID = &customerID
	}
	return recordSplitCashMovement(ctx, base, amount, []splitComponent{
		{models.CashModeCash, cashAmount},
		{models.CashModeUPI, upiAmount},
		{models.CashModeBankTransfer, bankTransferAmount},
		{models.CashModeCheque, chequeAmount},
	})
}

func RecordBankPledgeCashOut(ctx context.Context, loanID uint, loanNumber, bankName string, amount, cashAmount, upiAmount, bankTransferAmount, chequeAmount float64, bankID *uint, occurredOn time.Time, branchID uint) (uint, error) {
	hoID, err := pledgeBranchID(ctx, bankID, upiAmount+bankTransferAmount+chequeAmount)
	if err != nil {
		return 0, err
	}
	base := models.CashMovement{
		Type:     "out",
		Purpose:  "Bank pledge release — " + bankName + " — " + loanNumber,
		Bank:     bankName,
		BankID:   bankID,
		BranchID: &hoID,
	}
	if occurredOn.IsZero() {
		base.OccurredOn = time.Now()
	} else {
		base.OccurredOn = occurredOn
	}
	if cashAmount+upiAmount+bankTransferAmount+chequeAmount == 0 {
		cashAmount = amount
	}
	id, _, err := recordSplitCashMovement(ctx, base, amount, []splitComponent{
		{models.CashModeCash, cashAmount},
		{models.CashModeUPI, upiAmount},
		{models.CashModeBankTransfer, bankTransferAmount},
		{models.CashModeCheque, chequeAmount},
	})
	return id, err
}

func RecordInvestmentDepositCashIn(ctx context.Context, investmentID uint, investmentNumber string, amount, cashAmount, upiAmount, bankTransferAmount, chequeAmount float64, bankID *uint, branchID uint, occurredOn time.Time, customerID uint) (uint, error) {
	base := models.CashMovement{
		Type:     "in",
		Source:   "Investment",
		Purpose:  "Investment deposit — " + investmentNumber,
		BankID:   bankID,
		BranchID: &branchID,
	}
	if customerID != 0 {
		base.PartyCustomerID = &customerID
	}
	if occurredOn.IsZero() {
		base.OccurredOn = time.Now()
	} else {
		base.OccurredOn = occurredOn
	}
	if cashAmount+upiAmount+bankTransferAmount+chequeAmount == 0 {
		cashAmount = amount
	}
	id, _, err := recordSplitCashMovement(ctx, base, amount, []splitComponent{
		{models.CashModeCash, cashAmount},
		{models.CashModeUPI, upiAmount},
		{models.CashModeBankTransfer, bankTransferAmount},
		{models.CashModeCheque, chequeAmount},
	})
	return id, err
}

func RecordInvestmentPayoutCashOut(ctx context.Context, investmentID uint, investmentNumber string, amount, cashAmount, upiAmount, bankTransferAmount, chequeAmount float64, branchID uint, occurredOn time.Time, payoutType string, customerID uint, bankID *uint) (uint, string, error) {
	base := models.CashMovement{
		Type:     "out",
		Purpose:  fmt.Sprintf("%s — %s", payoutType, investmentNumber),
		BankID:   bankID,
		BranchID: &branchID,
	}
	if occurredOn.IsZero() {
		base.OccurredOn = time.Now()
	} else {
		base.OccurredOn = occurredOn
	}
	if customerID != 0 {
		base.PartyCustomerID = &customerID
	}
	return recordSplitCashMovement(ctx, base, amount, []splitComponent{
		{models.CashModeCash, cashAmount},
		{models.CashModeUPI, upiAmount},
		{models.CashModeBankTransfer, bankTransferAmount},
		{models.CashModeCheque, chequeAmount},
	})
}

func RecordAuctionSaleCashIn(ctx context.Context, loanID uint, loanNumber string, amount float64, branchID uint, occurredOn time.Time) (uint, error) {
	rec := &models.CashMovement{
		Type:     "in",
		Source:   "Auction",
		Purpose:  "Auction sale proceeds — " + loanNumber,
		Amount:   amount,
		Mode:     models.CashModeCash,
		BranchID: &branchID,
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

func RecordAuctionSurplusCashOut(ctx context.Context, loanID uint, loanNumber string, amount float64, branchID uint, occurredOn time.Time) (uint, error) {
	rec := &models.CashMovement{
		Type:     "out",
		Purpose:  "Auction surplus refunded to customer — " + loanNumber,
		Amount:   amount,
		Mode:     models.CashModeCash,
		BranchID: &branchID,
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

func pledgeBranchID(ctx context.Context, bankID *uint, bankAmount float64) (uint, error) {
	if bankID != nil && bankAmount > 0 {
		var branchID uint
		if err := config.DB.
			WithContext(ctx).Table("banks").Select("branch_id").
			Where("id = ?", *bankID).Scan(&branchID).Error; err != nil {
			return 0, err
		}
		if branchID != 0 {
			return branchID, nil
		}
	}
	return HeadOfficeBranchID(ctx)
}

func HeadOfficeBranchID(ctx context.Context) (uint, error) {
	b, err := common.FindHeadOffice(ctx)
	if err != nil {
		return 0, fmt.Errorf("finding the Head Office branch for the bank pledge: %w", err)
	}
	return b.ID, nil
}

func DeleteAllLoanCashEntries(ctx context.Context, loanNumber string, movementIDs, expenseIDs []uint) error {
	if err := deleteByPurposeSuffixOrIDs(ctx, " — "+loanNumber, movementIDs); err != nil {
		return err
	}
	return deleteByIDs(ctx, expenseIDs)
}

func setLoanStatus(ctx context.Context, id uint, status string, branchID *uint) (*models.CashMovement, error) {
	if status != "Open" && status != "Closed" {
		return nil, common.NewBadRequest("status must be \"Open\" or \"Closed\"")
	}
	rec, err := findMovementByID(ctx, id)
	if err != nil {
		return nil, common.NewNotFound("cash movement not found")
	}
	if branchID != nil && (rec.BranchID == nil || *rec.BranchID != *branchID) {
		return nil, common.NewNotFound("cash movement not found")
	}
	rec.Status = status
	if err := persistMovement(ctx, rec); err != nil {
		return nil, err
	}
	return rec, nil
}

func (req movementRequest) toInput() (RecordMovementInput, error) {
	occurred, err := parseOccurredOn(req.OccurredOn)
	if err != nil {
		return RecordMovementInput{}, common.NewBadRequest("invalid occurred_on: expected YYYY-MM-DD")
	}
	return RecordMovementInput{
		Type: req.Type, Source: req.Source, Purpose: req.Purpose, Mode: req.Mode,
		Bank: req.Bank, BankID: req.BankID, ToBankID: req.ToBankID,
		Amount: req.Amount, BranchID: req.BranchID, OccurredOn: occurred, ReceiptImage: req.ReceiptImage,
	}, nil
}

func ownsParty(c echo.Context, ctx context.Context, table string, id uint, notFound string) bool {
	ok, err := config.ExistsInTenant(ctx, config.DB, table, id)
	if err != nil {
		common.FailErr(c, err)
		return false
	}
	if ok {
		ok, err = partyInBranchScope(c, ctx, table, id)
		if err != nil {
			common.FailErr(c, err)
			return false
		}
	}
	if !ok {
		c.JSON(http.StatusNotFound, echo.Map{"success": false, "error": notFound})
		return false
	}
	return true
}

func partyInBranchScope(c echo.Context, ctx context.Context, table string, id uint) (bool, error) {
	scope := auth.GetBranchScope(c)
	if scope == nil {
		return true, nil
	}
	if table == "branches" {
		return id == *scope, nil
	}
	var branchID uint
	if err := config.DB.
		WithContext(ctx).Table(table).Select("branch_id").
		Where("id = ?", id).Scan(&branchID).Error; err != nil {
		return false, err
	}
	return branchID == *scope, nil
}

func insertMovement(ctx context.Context, m *models.CashMovement) error {
	if strings.TrimSpace(m.Mode) == "" {
		m.Mode = models.CashModeCash
	}
	return config.DB.
		WithContext(ctx).Create(m).Error
}

func findMovements(ctx context.Context, branchID *uint, fromDate, toDate time.Time, category, search string, limit, offset int) ([]models.CashMovement, int64, error) {
	categories := []string{}
	if category != "" {
		categories = []string{category}
	}
	return findAllFiltered(ctx, branchID, fromDate, toDate, MovementFilter{Categories: categories}, search, limit, offset)
}

func findAllFiltered(ctx context.Context, branchID *uint, fromDate, toDate time.Time, filter MovementFilter, search string, limit, offset int) ([]models.CashMovement, int64, error) {
	var movements []models.CashMovement
	q := filteredMovements(ctx, branchID, fromDate, toDate, filter, search).Preload("Branch").
		Preload("PartyCustomer", func(db *gorm.DB) *gorm.DB { return db.Select("id", "tenant_id", "name", "code") }).
		Preload("BankRef").Preload("CounterBankRef").
		Order("DATE(occurred_on) desc, created_at desc, id desc")
	var total int64
	if limit > 0 {
		if err := q.Session(&gorm.Session{}).Model(&models.CashMovement{}).Count(&total).Error; err != nil {
			return nil, 0, err
		}
		q = q.Limit(limit)
	}
	if offset > 0 {
		q = q.Offset(offset)
	}
	err := q.Find(&movements).Error
	return movements, total, err
}

func sumFilteredRows(ctx context.Context, branchID *uint, fromDate, toDate time.Time, filter MovementFilter, search string) (debit, credit float64, err error) {
	var row struct{ Debit, Credit float64 }
	err = filteredMovements(ctx, branchID, fromDate, toDate, filter, search).
		Select(`COALESCE(SUM(CASE WHEN type = 'out' THEN amount ELSE 0 END), 0) AS debit,
			COALESCE(SUM(CASE WHEN type = 'in' THEN amount ELSE 0 END), 0) AS credit`).
		Scan(&row).Error
	return row.Debit, row.Credit, err
}

func netOfNewestRows(ctx context.Context, branchID *uint, fromDate, toDate time.Time, filter MovementFilter, search string, n int) (float64, error) {
	if n <= 0 {
		return 0, nil
	}
	var rows []struct {
		Type   string
		Amount float64
	}
	err := filteredMovements(ctx, branchID, fromDate, toDate, filter, search).
		Select("type", "amount").
		Order("DATE(occurred_on) desc, created_at desc, id desc").
		Limit(n).Scan(&rows).Error
	net := 0.0
	for _, m := range rows {
		if m.Type == "out" {
			net -= m.Amount
		} else {
			net += m.Amount
		}
	}
	return net, err
}

func listByBank(ctx context.Context, bankID uint, fromDate, toDate time.Time, limit, offset int) ([]models.CashMovement, int64, error) {
	q := config.DB.
		WithContext(ctx).Preload("Branch").Model(&models.CashMovement{}).
		Where("bank_id = ?", bankID).
		Order("occurred_on desc, id desc")
	if !fromDate.IsZero() {
		q = q.Where("occurred_on >= ?", fromDate)
	}
	if !toDate.IsZero() {
		q = q.Where("occurred_on < ?", toDate.AddDate(0, 0, 1))
	}
	var total int64
	if limit > 0 {
		if err := q.Session(&gorm.Session{}).Model(&models.CashMovement{}).Count(&total).Error; err != nil {
			return nil, 0, err
		}
		q = q.Limit(limit)
	}
	if offset > 0 {
		q = q.Offset(offset)
	}
	var movements []models.CashMovement
	err := q.Find(&movements).Error
	return movements, total, err
}

func listByCustomer(ctx context.Context, customerID uint, fromDate, toDate time.Time, loanNumbers []string, limit, offset int) ([]models.CashMovement, int64, error) {
	q := config.DB.
		WithContext(ctx).Preload("Branch").Model(&models.CashMovement{}).
		Where("party_customer_id = ?", customerID).
		Order("occurred_on desc, id desc")
	if !fromDate.IsZero() {
		q = q.Where("occurred_on >= ?", fromDate)
	}
	if !toDate.IsZero() {
		q = q.Where("occurred_on < ?", toDate.AddDate(0, 0, 1))
	}
	if len(loanNumbers) > 0 {
		orQ := config.DB.
			WithContext(ctx)
		for _, ln := range loanNumbers {
			orQ = orQ.Or("purpose LIKE ?", "%"+ln)
		}
		q = q.Where(orQ)
	}
	var total int64
	if limit > 0 {
		if err := q.Session(&gorm.Session{}).Model(&models.CashMovement{}).Count(&total).Error; err != nil {
			return nil, 0, err
		}
		q = q.Limit(limit)
	}
	if offset > 0 {
		q = q.Offset(offset)
	}
	var movements []models.CashMovement
	err := q.Find(&movements).Error
	return movements, total, err
}

func listByBranch(ctx context.Context, branchID uint, fromDate, toDate time.Time, limit, offset int) ([]models.CashMovement, int64, error) {
	q := config.DB.
		WithContext(ctx).Preload("Branch").Model(&models.CashMovement{}).
		Where("branch_id = ?", branchID).
		Order("occurred_on desc, id desc")
	if !fromDate.IsZero() {
		q = q.Where("occurred_on >= ?", fromDate)
	}
	if !toDate.IsZero() {
		q = q.Where("occurred_on < ?", toDate.AddDate(0, 0, 1))
	}
	var total int64
	if limit > 0 {
		if err := q.Session(&gorm.Session{}).Model(&models.CashMovement{}).Count(&total).Error; err != nil {
			return nil, 0, err
		}
		q = q.Limit(limit)
	}
	if offset > 0 {
		q = q.Offset(offset)
	}
	var movements []models.CashMovement
	err := q.Find(&movements).Error
	return movements, total, err
}

func findMovementByID(ctx context.Context, id uint) (*models.CashMovement, error) {
	var m models.CashMovement
	if err := config.DB.
		WithContext(ctx).Preload("Branch").First(&m, id).Error; err != nil {
		return nil, err
	}
	return &m, nil
}

func persistMovement(ctx context.Context, m *models.CashMovement) error {
	return config.DB.
		WithContext(ctx).Save(m).Error
}

func removeMovement(ctx context.Context, id uint) error {
	return config.DB.
		WithContext(ctx).Delete(&models.CashMovement{}, id).Error
}

func deleteByPurposes(ctx context.Context, purposes []string) error {
	if len(purposes) == 0 {
		return nil
	}
	return config.DB.
		WithContext(ctx).Where("purpose IN ?", purposes).Delete(&models.CashMovement{}).Error
}

func deleteByPurposeSuffixOrIDs(ctx context.Context, suffix string, ids []uint) error {
	esc := strings.NewReplacer(`\`, `\\`, `%`, `\%`, `_`, `\_`).Replace(suffix)
	q := config.DB.
		WithContext(ctx)
	if len(ids) == 0 {
		return q.Where(`purpose LIKE ? ESCAPE '\'`, "%"+esc).Delete(&models.CashMovement{}).Error
	}
	return q.Where(`purpose LIKE ? ESCAPE '\' OR id IN ?`, "%"+esc, ids).Delete(&models.CashMovement{}).Error
}

func sumByTypeAndDate(ctx context.Context, branchID *uint, date time.Time) (in float64, out float64, err error) {
	return sumByTypeBetween(ctx, branchID, nil, startOfDay(date), startOfDay(date).AddDate(0, 0, 1))
}

func sumByTypeBetween(ctx context.Context, branchID *uint, excludeBranchIDs []uint, from, to time.Time) (in float64, out float64, err error) {
	type row struct {
		Type string
		Sum  float64
	}
	q := config.DB.
		WithContext(ctx).Model(&models.CashMovement{}).
		Where("occurred_on < ?", to).
		Where("expense_id IS NULL")
	if !from.IsZero() {
		q = q.Where("occurred_on >= ?", from)
	}
	if branchID != nil {
		q = q.Where("branch_id = ?", *branchID)
	}
	if len(excludeBranchIDs) > 0 {
		q = q.Where("(branch_id IS NULL OR branch_id NOT IN ?)", excludeBranchIDs)
	}
	var rows []row
	if err := q.Select("type, COALESCE(SUM(amount), 0) as sum").Group("type").Scan(&rows).Error; err != nil {
		return 0, 0, err
	}
	for _, r := range rows {
		switch r.Type {
		case "in":
			in = r.Sum
		case "out":
			out = r.Sum
		}
	}
	return in, out, nil
}

func sumBreakdownByDate(ctx context.Context, branchID *uint, date time.Time) (CashInBreakdown, CashOutBreakdown, error) {
	type row struct {
		Type    string
		Source  string
		Purpose string
		Amount  float64
	}
	q := config.DB.
		WithContext(ctx).Model(&models.CashMovement{}).
		Where("occurred_on >= ? AND occurred_on < ?", startOfDay(date), startOfDay(date).AddDate(0, 0, 1)).
		Where("expense_id IS NULL")
	if branchID != nil {
		q = q.Where("branch_id = ?", *branchID)
	}
	var rows []row
	if err := q.Select("type, source, purpose, amount").Scan(&rows).Error; err != nil {
		return CashInBreakdown{}, CashOutBreakdown{}, err
	}
	var in CashInBreakdown
	var out CashOutBreakdown
	for _, rw := range rows {
		if rw.Source == SelfTransferSource {
			continue
		}
		switch rw.Type {
		case "in":
			switch rw.Source {
			case "Collection":
				in.Repayments += rw.Amount
			case "Bank":
				in.Pledges += rw.Amount
			case "Auction":
				in.Auctions += rw.Amount
			case "GoldSale":
				in.GoldSales += rw.Amount
			default:
				in.TopUps += rw.Amount
			}
		case "out":
			switch {
			case strings.HasPrefix(rw.Purpose, "Loan disbursement — "):
				out.LoanDisbursements += rw.Amount
			case strings.HasPrefix(rw.Purpose, "Bank pledge release — "):
				out.BankReleases += rw.Amount
			case strings.HasPrefix(rw.Purpose, "Auction surplus refunded"):
				out.AuctionRefunds += rw.Amount
			case strings.HasPrefix(rw.Purpose, "Gold purchase cost — "):
				out.GoldPurchases += rw.Amount
			default:
				out.Withdrawals += rw.Amount
			}
		}
	}
	return in, out, nil
}

func SumNet(ctx context.Context, branchID *uint) (float64, error) {
	q := config.DB.
		WithContext(ctx).Model(&models.CashMovement{})
	if branchID != nil {
		q = q.Where("branch_id = ?", *branchID)
	}
	var net float64
	err := q.Select("COALESCE(SUM(CASE WHEN type = 'in' THEN amount WHEN type = 'out' THEN -amount ELSE 0 END), 0)").
		Scan(&net).Error
	return net, err
}

func loanDrawn(ctx context.Context, name string, since time.Time) (float64, error) {
	var total float64
	err := config.DB.
		WithContext(ctx).Model(&models.CashMovement{}).
		Select("COALESCE(SUM(amount), 0)").
		Where("type = ? AND source ILIKE ? AND created_at >= ?", "in", name, since).
		Scan(&total).Error
	return total, err
}

func loanRepaid(ctx context.Context, name string, since time.Time, includePending bool) (float64, error) {
	statuses := []string{"Approved"}
	if includePending {
		statuses = append(statuses, "Pending")
	}
	var total float64
	err := config.DB.
		WithContext(ctx).Model(&models.Expense{}).
		Select("COALESCE(SUM(amount), 0)").
		Where("category ILIKE ? AND status IN ? AND created_at >= ?", name, statuses, since).
		Scan(&total).Error
	if err != nil {
		return 0, err
	}
	var transferred float64
	err = config.DB.
		WithContext(ctx).Model(&models.CashMovement{}).
		Select("COALESCE(SUM(amount), 0)").
		Where("type = ? AND source = ? AND LOWER(purpose) = LOWER(?) AND created_at >= ?",
			"out", SelfTransferSource, "Self transfer — "+name, since).
		Scan(&transferred).Error
	return total + transferred, err
}

func NetByDay(ctx context.Context, branchID *uint, from, to time.Time) (map[string]float64, error) {
	type row struct {
		Type       string
		Amount     float64
		OccurredOn time.Time
	}
	q := config.DB.
		WithContext(ctx).Model(&models.CashMovement{}).
		Where("occurred_on >= ? AND occurred_on < ?", from, to)
	if branchID != nil {
		q = q.Where("branch_id = ?", *branchID)
	}
	var rows []row
	if err := q.Select("type, amount, occurred_on").Scan(&rows).Error; err != nil {
		return nil, err
	}
	out := map[string]float64{}
	for _, rw := range rows {
		key := rw.OccurredOn.In(time.Local).Format("2006-01-02")
		switch rw.Type {
		case "in":
			out[key] += rw.Amount
		case "out":
			out[key] -= rw.Amount
		}
	}
	return out, nil
}

func netByBank(ctx context.Context, to time.Time) (map[uint]float64, error) {
	var rows []struct {
		BankID uint
		Net    float64
	}
	err := config.DB.
		WithContext(ctx).Model(&models.CashMovement{}).
		Select("bank_id, COALESCE(SUM(CASE WHEN type = 'in' THEN amount ELSE -amount END), 0) AS net").
		Where("occurred_on < ? AND expense_id IS NULL AND bank_id IS NOT NULL", to).
		Where("mode IN ? AND to_bank_id IS NULL", bankModes).
		Group("bank_id").Scan(&rows).Error
	if err != nil {
		return nil, err
	}
	out := make(map[uint]float64, len(rows))
	for _, rw := range rows {
		out[rw.BankID] = rw.Net
	}
	return out, nil
}

func netByScope(ctx context.Context, s BalanceScope) (float64, error) {
	q := config.DB.
		WithContext(ctx).Model(&models.CashMovement{}).
		Where("occurred_on < ?", s.To).
		Where("expense_id IS NULL")
	if s.Bank {
		q = q.Where("mode IN ?", bankModes).Where("to_bank_id IS NULL")
		if s.BankID != nil {
			q = q.Where("bank_id = ?", *s.BankID)
		}
		if s.Mode != "" {
			q = q.Where("mode = ?", s.Mode)
		}
	} else {
		q = q.Where("(mode IS NULL OR mode NOT IN ?)", bankModes)
	}
	if !s.From.IsZero() {
		q = q.Where("occurred_on >= ?", s.From)
	}
	branchCol := "branch_id"
	if s.Bank {
		branchCol = bankSideBranch("cash_movements", "bank_id")
	}
	if s.BranchID != nil {
		q = q.Where(branchCol+" = ?", *s.BranchID)
	}
	if len(s.ExcludeBranches) > 0 {
		q = q.Where("("+branchCol+" IS NULL OR "+branchCol+" NOT IN ?)", s.ExcludeBranches)
	}
	var net float64
	if err := q.Select("COALESCE(SUM(CASE WHEN type = 'in' THEN amount ELSE -amount END), 0)").Scan(&net).Error; err != nil {
		return 0, err
	}
	return net, nil
}

func RecordMovement(c echo.Context) error {
	ctx := auth.RequestContext(c)
	var req movementRequest
	if err := common.BindJSON(c, &req); err != nil {
		return c.JSON(http.StatusBadRequest, echo.Map{"success": false, "error": "Invalid input"})
	}
	input, err := req.toInput()
	if err != nil {
		return common.FailErr(c, err)
	}
	if input.BranchID != nil {
		branchID := auth.EnforceBranchOnWrite(c, *input.BranchID)
		input.BranchID = &branchID
	} else if scope := auth.GetBranchScope(c); scope != nil {
		input.BranchID = scope
	}
	rec, err := SaveMovement(ctx, input, req.toLoanSourceInput())
	if err != nil {
		return common.FailErr(c, err)
	}
	return common.Success(c, http.StatusOK, movementResponse{CashMovement: rec, LoanSource: getLoanSource(ctx, rec.ID)})
}

func RecordSelfTransfer(c echo.Context) error {
	ctx := auth.RequestContext(c)
	var req selfTransferRequest
	if err := common.BindJSON(c, &req); err != nil {
		return c.JSON(http.StatusBadRequest, echo.Map{"success": false, "error": "Invalid input"})
	}
	occurred, err := parseOccurredOn(req.OccurredOn)
	if err != nil {
		return c.JSON(http.StatusBadRequest, echo.Map{"success": false, "error": "invalid occurred_on: expected YYYY-MM-DD"})
	}
	branchID := req.BranchID
	if branchID != nil {
		b := auth.EnforceBranchOnWrite(c, *branchID)
		branchID = &b
	} else if scope := auth.GetBranchScope(c); scope != nil {
		branchID = scope
	}
	rows, err := recordSelfTransfer(ctx, RecordSelfTransferInput{
		Category: req.Category, Amount: req.Amount,
		FromBankID: req.FromBankID, FromBank: req.FromBank,
		ToBankID: req.ToBankID, ToBank: req.ToBank, Mode: req.Mode, ReceiptImage: req.ReceiptImage,
		BranchID: branchID, OccurredOn: occurred,
	})
	if err != nil {
		return common.FailErr(c, err)
	}
	return common.Success(c, http.StatusOK, rows)
}

func ListMovements(c echo.Context) error {
	ctx := auth.RequestContext(c)
	branchID := auth.GetBranchScope(c)
	search := strings.TrimSpace(c.QueryParam("search"))
	page, limit, offset := common.PageParams(c)
	fromDate, err := parseOptionalDate(c.QueryParam("from_date"))
	if err != nil {
		return c.JSON(http.StatusBadRequest, echo.Map{"success": false, "error": "Invalid from_date, please use the YYYY-MM-DD format"})
	}
	toDate, err := parseOptionalDate(c.QueryParam("to_date"))
	if err != nil {
		return c.JSON(http.StatusBadRequest, echo.Map{"success": false, "error": "Invalid to_date, please use the YYYY-MM-DD format"})
	}
	filter := movementQueryFilter(c)
	if limit > 0 {
		rec, total, err := listFiltered(ctx, branchID, fromDate, toDate, filter, search, limit, offset)
		if err != nil {
			return common.FailErr(c, err)
		}
		debit, credit, err := sumMovementFiltered(ctx, branchID, fromDate, toDate, filter, search)
		if err != nil {
			return common.FailErr(c, err)
		}
		ahead, err := netMovementOfNewest(ctx, branchID, fromDate, toDate, filter, search, offset)
		if err != nil {
			return common.FailErr(c, err)
		}
		return common.SuccessPage(c, page, limit, total, withLoanSources(ctx, rec), echo.Map{"total_debit": debit, "total_credit": credit, "page_balance": (credit - debit) - ahead})
	}
	rec, _, err := listFiltered(ctx, branchID, fromDate, toDate, filter, search, 0, 0)
	if err != nil {
		return common.FailErr(c, err)
	}
	return common.SuccessAll(c, withLoanSources(ctx, rec))
}

func GetCashLedger(c echo.Context) error {
	ctx := auth.RequestContext(c)
	branchID := auth.GetBranchScope(c)
	branchIDs := parseUintCSV(c.QueryParam("branch_ids"))
	fromDate, err := parseOptionalDate(c.QueryParam("from_date"))
	if err != nil {
		return c.JSON(http.StatusBadRequest, echo.Map{"success": false, "error": "Invalid from_date, please use the YYYY-MM-DD format"})
	}
	toDate, err := parseOptionalDate(c.QueryParam("to_date"))
	if err != nil {
		return c.JSON(http.StatusBadRequest, echo.Map{"success": false, "error": "Invalid to_date, please use the YYYY-MM-DD format"})
	}
	page, limit, offset, export := ledgerPaging(c)
	rec, total, totals, err := listCashModeLedger(ctx, branchID, branchIDs, fromDate, toDate, limit, offset)
	if err != nil {
		return common.FailErr(c, err)
	}
	respondLedger(c, page, limit, export, "Cash Ledger", "cash-ledger.pdf", fromDate, toDate, rec, total, totals, nil)
	return nil
}

func GetModeLedger(c echo.Context) error {
	ctx := auth.RequestContext(c)
	mode := c.QueryParam("mode")
	if !modeVocabulary[mode] {
		return c.JSON(http.StatusBadRequest, echo.Map{"success": false, "error": "invalid mode: expected Cash, UPI, Bank Transfer or Cheque"})
	}
	var bankID *uint
	if raw := c.QueryParam("bank_id"); raw != "" {
		id, err := strconv.ParseUint(raw, 10, 64)
		if err != nil {
			return c.JSON(http.StatusBadRequest, echo.Map{"success": false, "error": "Invalid bank_id, please pick a bank from the list"})
		}
		v := uint(id)
		bankID = &v
	}
	branchID := auth.GetBranchScope(c)
	branchIDs := parseUintCSV(c.QueryParam("branch_ids"))
	fromDate, err := parseOptionalDate(c.QueryParam("from_date"))
	if err != nil {
		return c.JSON(http.StatusBadRequest, echo.Map{"success": false, "error": "Invalid from_date, please use the YYYY-MM-DD format"})
	}
	toDate, err := parseOptionalDate(c.QueryParam("to_date"))
	if err != nil {
		return c.JSON(http.StatusBadRequest, echo.Map{"success": false, "error": "Invalid to_date, please use the YYYY-MM-DD format"})
	}
	page, limit, offset, export := ledgerPaging(c)
	rec, total, totals, err := listModeLedger(ctx, mode, bankID, branchID, branchIDs, parseStringCSV(c.QueryParam("types")), fromDate, toDate, limit, offset)
	if err != nil {
		return common.FailErr(c, err)
	}
	slug := strings.ToLower(strings.ReplaceAll(mode, " ", "-"))
	respondLedger(c, page, limit, export, mode+" Ledger", slug+"-ledger.pdf", fromDate, toDate, rec, total, totals, nil)
	return nil
}

func ListMovementsByBank(c echo.Context) error {
	ctx := auth.RequestContext(c)
	page, limit, offset := common.PageParams(c)
	bankID, err := common.IDParam(c, "bank_id")
	if err != nil {
		return common.FailErr(c, err)
	}
	if !ownsParty(c, ctx, "banks", bankID, "bank not found") {
		return nil
	}
	fromDate, err := parseOptionalDate(c.QueryParam("from_date"))
	if err != nil {
		return c.JSON(http.StatusBadRequest, echo.Map{"success": false, "error": "Invalid from_date, please use the YYYY-MM-DD format"})
	}
	toDate, err := parseOptionalDate(c.QueryParam("to_date"))
	if err != nil {
		return c.JSON(http.StatusBadRequest, echo.Map{"success": false, "error": "Invalid to_date, please use the YYYY-MM-DD format"})
	}
	if limit == 0 {
		page, limit = 1, 12
	}
	rec, total, totals, err := listCashMovementsByBank(ctx, bankID, fromDate, toDate, limit, offset)
	if err != nil {
		return common.FailErr(c, err)
	}
	return common.SuccessPage(c, page, limit, total, rec, echo.Map{"totals": totals})
}

func ListMovementsByCustomer(c echo.Context) error {
	ctx := auth.RequestContext(c)
	customerID, err := common.IDParam(c, "customer_id")
	if err != nil {
		return common.FailErr(c, err)
	}
	if !ownsParty(c, ctx, "customers", customerID, "customer not found") {
		return nil
	}
	fromDate, err := parseOptionalDate(c.QueryParam("from_date"))
	if err != nil {
		return c.JSON(http.StatusBadRequest, echo.Map{"success": false, "error": "Invalid from_date, please use the YYYY-MM-DD format"})
	}
	toDate, err := parseOptionalDate(c.QueryParam("to_date"))
	if err != nil {
		return c.JSON(http.StatusBadRequest, echo.Map{"success": false, "error": "Invalid to_date, please use the YYYY-MM-DD format"})
	}
	page, limit, offset, export := ledgerPaging(c)
	rec, total, totals, err := listCombinedLedgerByCustomer(ctx, customerID, loanNumbersFromQuery(c), fromDate, toDate, limit, offset)
	if err != nil {
		return common.FailErr(c, err)
	}
	respondLedger(c, page, limit, export, "Customer Ledger", "customer-ledger.pdf", fromDate, toDate, rec, total, totals, nil)
	return nil
}

func GetBankLedger(c echo.Context) error {
	ctx := auth.RequestContext(c)
	bankID, err := common.IDParam(c, "id")
	if err != nil {
		return common.FailErr(c, err)
	}
	if !ownsParty(c, ctx, "banks", bankID, "bank not found") {
		return nil
	}
	fromDate, err := parseOptionalDate(c.QueryParam("from_date"))
	if err != nil {
		return c.JSON(http.StatusBadRequest, echo.Map{"success": false, "error": "Invalid from_date, please use the YYYY-MM-DD format"})
	}
	toDate, err := parseOptionalDate(c.QueryParam("to_date"))
	if err != nil {
		return c.JSON(http.StatusBadRequest, echo.Map{"success": false, "error": "Invalid to_date, please use the YYYY-MM-DD format"})
	}
	page, limit, offset, export := ledgerPaging(c)
	rec, total, totals, err := listCombinedLedgerByBank(ctx, bankID, splitCSV(c.QueryParam("modes")), fromDate, toDate, limit, offset)
	if err != nil {
		return common.FailErr(c, err)
	}
	respondLedger(c, page, limit, export, "Bank Ledger", "bank-ledger.pdf", fromDate, toDate, rec, total, totals, nil)
	return nil
}

func ListMovementsByBranch(c echo.Context) error {
	ctx := auth.RequestContext(c)
	page, limit, offset := common.PageParams(c)
	branchID, err := common.IDParam(c, "id")
	if err != nil {
		return common.FailErr(c, err)
	}
	if !ownsParty(c, ctx, "branches", branchID, "branch not found") {
		return nil
	}
	fromDate, err := parseOptionalDate(c.QueryParam("from_date"))
	if err != nil {
		return c.JSON(http.StatusBadRequest, echo.Map{"success": false, "error": "Invalid from_date, please use the YYYY-MM-DD format"})
	}
	toDate, err := parseOptionalDate(c.QueryParam("to_date"))
	if err != nil {
		return c.JSON(http.StatusBadRequest, echo.Map{"success": false, "error": "Invalid to_date, please use the YYYY-MM-DD format"})
	}
	if limit == 0 {
		page, limit = 1, 12
	}
	rec, total, totals, err := listCashMovementsByBranch(ctx, branchID, fromDate, toDate, limit, offset)
	if err != nil {
		return common.FailErr(c, err)
	}
	return common.SuccessPage(c, page, limit, total, rec, echo.Map{"totals": totals})
}

func ExportMovementsByBank(c echo.Context) error {
	ctx := auth.RequestContext(c)
	bankID, err := common.IDParam(c, "bank_id")
	if err != nil {
		return common.FailErr(c, err)
	}
	if !ownsParty(c, ctx, "banks", bankID, "bank not found") {
		return nil
	}
	fromDate, err := parseOptionalDate(c.QueryParam("from_date"))
	if err != nil {
		return c.JSON(http.StatusBadRequest, echo.Map{"success": false, "error": "Invalid from_date, please use the YYYY-MM-DD format"})
	}
	toDate, err := parseOptionalDate(c.QueryParam("to_date"))
	if err != nil {
		return c.JSON(http.StatusBadRequest, echo.Map{"success": false, "error": "Invalid to_date, please use the YYYY-MM-DD format"})
	}
	rows, _, err := listByBank(ctx, bankID, fromDate, toDate, 0, 0)
	if err != nil {
		return common.FailErr(c, err)
	}
	headers, tableRows := branchColumnFor(c, []string{"Date", "Type", "Source", "Purpose", "Mode", "Bank", "Branch", "Amount", "Status"}, partyStatementRows(rows))
	pdfBytes, err := renderTablePDF(
		"Party Transactions",
		partyStatementNote(fromDate, toDate),
		headers,
		tableRows,
	)
	if err != nil {
		return common.FailWith(c, http.StatusBadRequest, "Could not generate the document, please try again", err)
	}
	c.Response().Header().Set("Content-Disposition", `attachment; filename="party-transactions.pdf"`)
	return c.Blob(http.StatusOK, "application/pdf", pdfBytes)
}

func ExportMovementsByBranch(c echo.Context) error {
	ctx := auth.RequestContext(c)
	branchID, err := common.IDParam(c, "id")
	if err != nil {
		return common.FailErr(c, err)
	}
	if !ownsParty(c, ctx, "branches", branchID, "branch not found") {
		return nil
	}
	fromDate, err := parseOptionalDate(c.QueryParam("from_date"))
	if err != nil {
		return c.JSON(http.StatusBadRequest, echo.Map{"success": false, "error": "Invalid from_date, please use the YYYY-MM-DD format"})
	}
	toDate, err := parseOptionalDate(c.QueryParam("to_date"))
	if err != nil {
		return c.JSON(http.StatusBadRequest, echo.Map{"success": false, "error": "Invalid to_date, please use the YYYY-MM-DD format"})
	}
	rows, _, err := listByBranch(ctx, branchID, fromDate, toDate, 0, 0)
	if err != nil {
		return common.FailErr(c, err)
	}
	headers, tableRows := branchColumnFor(c, []string{"Date", "Type", "Source", "Purpose", "Mode", "Bank", "Branch", "Amount", "Status"}, partyStatementRows(rows))
	pdfBytes, err := renderTablePDF(
		"Party Transactions",
		partyStatementNote(fromDate, toDate),
		headers,
		tableRows,
	)
	if err != nil {
		return common.FailWith(c, http.StatusBadRequest, "Could not generate the document, please try again", err)
	}
	c.Response().Header().Set("Content-Disposition", `attachment; filename="party-transactions.pdf"`)
	return c.Blob(http.StatusOK, "application/pdf", pdfBytes)
}

func ExportMovementsByCustomer(c echo.Context) error {
	ctx := auth.RequestContext(c)
	customerID, err := common.IDParam(c, "customer_id")
	if err != nil {
		return common.FailErr(c, err)
	}
	if !ownsParty(c, ctx, "customers", customerID, "customer not found") {
		return nil
	}
	fromDate, err := parseOptionalDate(c.QueryParam("from_date"))
	if err != nil {
		return c.JSON(http.StatusBadRequest, echo.Map{"success": false, "error": "Invalid from_date, please use the YYYY-MM-DD format"})
	}
	toDate, err := parseOptionalDate(c.QueryParam("to_date"))
	if err != nil {
		return c.JSON(http.StatusBadRequest, echo.Map{"success": false, "error": "Invalid to_date, please use the YYYY-MM-DD format"})
	}
	rows, _, err := listByCustomer(ctx, customerID, fromDate, toDate, loanNumbersFromQuery(c), 0, 0)
	if err != nil {
		return common.FailErr(c, err)
	}
	headers, tableRows := branchColumnFor(c, []string{"Date", "Type", "Source", "Purpose", "Mode", "Bank", "Branch", "Amount", "Status"}, partyStatementRows(rows))
	pdfBytes, err := renderTablePDF(
		"Party Transactions",
		partyStatementNote(fromDate, toDate),
		headers,
		tableRows,
	)
	if err != nil {
		return common.FailWith(c, http.StatusBadRequest, "Could not generate the document, please try again", err)
	}
	c.Response().Header().Set("Content-Disposition", `attachment; filename="party-transactions.pdf"`)
	return c.Blob(http.StatusOK, "application/pdf", pdfBytes)
}

func ExportMovements(c echo.Context) error {
	ctx := auth.RequestContext(c)
	branchID := auth.GetBranchScope(c)
	fromDate, err := parseOptionalDate(c.QueryParam("from_date"))
	if err != nil {
		return c.JSON(http.StatusBadRequest, echo.Map{"success": false, "error": "Invalid from_date, please use the YYYY-MM-DD format"})
	}
	toDate, err := parseOptionalDate(c.QueryParam("to_date"))
	if err != nil {
		return c.JSON(http.StatusBadRequest, echo.Map{"success": false, "error": "Invalid to_date, please use the YYYY-MM-DD format"})
	}
	filter := movementQueryFilter(c)
	rows, _, err := listFiltered(ctx, branchID, fromDate, toDate, filter, "", 0, 0)
	if err != nil {
		return common.FailErr(c, err)
	}
	var noteParts []string
	if !fromDate.IsZero() || !toDate.IsZero() {
		from, to := "…", "…"
		if !fromDate.IsZero() {
			from = fromDate.Format("02 Jan 2006")
		}
		if !toDate.IsZero() {
			to = toDate.Format("02 Jan 2006")
		}
		noteParts = append(noteParts, from+" – "+to)
	}
	if len(filter.Categories) > 0 {
		noteParts = append(noteParts, "type: "+strings.Join(filter.Categories, ", "))
	}
	headers := []string{"Date", "Type", "Source", "Purpose", "Mode", "Bank", "Branch", "Amount", "Loan Status"}
	tableRows := make([][]string, len(rows))
	for i, m := range rows {
		branchName := ""
		if m.Branch != nil {
			branchName = m.Branch.Name
		}
		tableRows[i] = []string{
			m.OccurredOn.Format("2006-01-02"),
			m.Type,
			m.Source,
			m.Purpose,
			m.Mode,
			m.Bank,
			branchName,
			strconv.FormatFloat(m.Amount, 'f', 2, 64),
			m.Status,
		}
	}
	headers, tableRows = branchColumnFor(c, headers, tableRows)
	if c.QueryParam("format") == "xlsx" {
		xlsxBytes, err := reports.BuildXLSX("Cash Movements", headers, tableRows)
		if err != nil {
			return common.FailWith(c, http.StatusBadRequest, "Could not generate the document, please try again", err)
		}
		c.Response().Header().Set("Content-Disposition", `attachment; filename="cash-movements.xlsx"`)
		return c.Blob(http.StatusOK, "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", xlsxBytes)
	}
	pdfBytes, err := renderTablePDF(
		"Cash Movements",
		strings.Join(noteParts, " · "),
		headers,
		tableRows,
	)
	if err != nil {
		return common.FailWith(c, http.StatusBadRequest, "Could not generate the document, please try again", err)
	}
	c.Response().Header().Set("Content-Disposition", `attachment; filename="cash-movements.pdf"`)
	return c.Blob(http.StatusOK, "application/pdf", pdfBytes)
}

func GetMovementById(c echo.Context) error {
	ctx := auth.RequestContext(c)
	id, err := common.IDParam(c, "id")
	if err != nil {
		return common.FailErr(c, err)
	}
	rec, err := getMovement(ctx, id, auth.GetBranchScope(c))
	if err != nil {
		return common.FailErr(c, err)
	}
	return common.Success(c, http.StatusOK, movementResponse{CashMovement: rec, LoanSource: getLoanSource(ctx, rec.ID)})
}

func UpdateMovementStatus(c echo.Context) error {
	ctx := auth.RequestContext(c)
	id, err := common.IDParam(c, "id")
	if err != nil {
		return common.FailErr(c, err)
	}
	var req setStatusRequest
	if err := common.BindJSON(c, &req); err != nil {
		return c.JSON(http.StatusBadRequest, echo.Map{"success": false, "error": "Invalid input"})
	}
	rec, err := setLoanStatus(ctx, id, req.Status, auth.GetBranchScope(c))
	if err != nil {
		return common.FailErr(c, err)
	}
	return common.Success(c, http.StatusOK, rec)
}
