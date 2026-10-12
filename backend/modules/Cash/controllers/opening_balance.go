package controllers

import (
	"cloudhouse/backend/auth"
	common "cloudhouse/backend/common/controllers"
	"cloudhouse/backend/config"
	"cloudhouse/backend/modules/Cash/models"
	"context"
	"net/http"
	"strconv"
	"time"

	"github.com/labstack/echo/v4"
	"gorm.io/gorm"
)

type setOpeningBalanceRequest struct {
	BranchID   uint    `json:"branch_id" binding:"required"`
	Date       string  `json:"date"`
	Mode       string  `json:"mode"`
	BankID     *uint   `json:"bank_id"`
	FromBankID *uint   `json:"from_bank_id"`
	Amount     float64 `json:"amount"`
}

func normalizeOpeningMode(mode string, bankID *uint) (string, *uint, error) {
	if mode == "" {
		mode = models.CashModeCash
	}
	if !modeVocabulary[mode] {
		return "", nil, common.NewBadRequest("mode must be Cash, UPI or Bank Transfer")
	}
	if mode == models.CashModeCash {
		return mode, nil, nil
	}
	if bankID == nil || *bankID == 0 {
		return "", nil, common.NewBadRequest("bank is required when mode is UPI or Bank Transfer")
	}
	return mode, bankID, nil
}

func openingFor(ctx context.Context, branchID *uint, date time.Time) (float64, error) {
	cash, bank, err := balancesBefore(ctx, branchID, startOfDay(date))
	if err != nil {
		return 0, err
	}
	return cash + bank, nil
}

func latestBankOpenings(ctx context.Context, branchID *uint, date time.Time) ([]models.OpeningCashBalance, error) {
	q := config.DB.
		WithContext(ctx).
		Where("mode <> ? AND bank_id IS NOT NULL AND balance_date <= ?", "Cash", startOfDay(date)).
		Order("balance_date DESC, id DESC")
	if branchID != nil {
		q = q.Where("branch_id = ?", *branchID)
	}
	var rows []models.OpeningCashBalance
	if err := q.Find(&rows).Error; err != nil {
		return nil, err
	}
	type key struct {
		branch, bank uint
		mode         string
	}
	seen := map[key]bool{}
	out := rows[:0]
	for _, row := range rows {
		k := key{row.BranchID, *row.BankID, row.Mode}
		if seen[k] {
			continue
		}
		seen[k] = true
		out = append(out, row)
	}
	return out, nil
}

func SaveOpeningBalance(ctx context.Context, branchID uint, date time.Time, mode string, bankID, fromBankID *uint, amount float64) (*models.OpeningCashBalance, error) {
	if amount < 0 {
		return nil, common.NewBadRequest("amount must be zero or greater")
	}
	if branchID == 0 {
		return nil, common.NewBadRequest("branch is required")
	}
	if ok, err := common.BranchExists(ctx, branchID); err != nil {
		return nil, err
	} else if !ok {
		return nil, common.NewBadRequest("branch does not exist")
	}
	mode, bankID, err := normalizeOpeningMode(mode, bankID)
	if err != nil {
		return nil, err
	}
	if mode == models.CashModeCash {
		fromBankID = nil
	} else if fromBankID == nil || *fromBankID == 0 {
		return nil, common.NewBadRequest("from bank is required when mode is not Cash")
	}
	if date.IsZero() {
		date = time.Now()
	}
	rec := &models.OpeningCashBalance{BranchID: branchID, BalanceDate: date, Mode: mode, BankID: bankID, FromBankID: fromBankID, Amount: amount}
	if err := upsertOpeningBalance(ctx, rec); err != nil {
		return nil, err
	}
	rec.IsSet = true
	return rec, nil
}

func getOpeningBalance(ctx context.Context, branchID uint, date time.Time, mode string, bankID *uint) (*models.OpeningCashBalance, error) {
	mode, bankID, err := normalizeOpeningMode(mode, bankID)
	if err != nil {
		return nil, err
	}
	if date.IsZero() {
		date = time.Now()
	}
	rec, err := findByBranchDateMode(ctx, branchID, date, mode, bankID)
	if err != nil {
		return &models.OpeningCashBalance{BranchID: branchID, BalanceDate: date, Mode: mode, BankID: bankID, Amount: 0}, nil
	}
	rec.IsSet = true
	return rec, nil
}

func findByBranchDateMode(ctx context.Context, branchID uint, date time.Time, mode string, bankID *uint) (*models.OpeningCashBalance, error) {
	var rec models.OpeningCashBalance
	q := config.DB.
		WithContext(ctx).Preload("Bank").Preload("FromBank").
		Where("branch_id = ? AND balance_date = ? AND mode = ?", branchID, startOfDay(date), mode)
	if bankID == nil {
		q = q.Where("bank_id IS NULL")
	} else {
		q = q.Where("bank_id = ?", *bankID)
	}
	if err := q.First(&rec).Error; err != nil {
		return nil, err
	}
	return &rec, nil
}

func findLatestCashOnOrBefore(ctx context.Context, branchID uint, date time.Time) (*models.OpeningCashBalance, error) {
	var rec models.OpeningCashBalance
	err := config.DB.
		WithContext(ctx).
		Where("branch_id = ? AND mode = ? AND bank_id IS NULL AND balance_date <= ?", branchID, "Cash", startOfDay(date)).
		Order("balance_date DESC").
		First(&rec).Error
	if err != nil {
		return nil, err
	}
	return &rec, nil
}

func cashSeedBranchIDs(ctx context.Context, date time.Time) ([]uint, error) {
	var ids []uint
	err := config.DB.
		WithContext(ctx).Model(&models.OpeningCashBalance{}).
		Where("mode = ? AND bank_id IS NULL AND balance_date <= ?", "Cash", startOfDay(date)).
		Distinct().Pluck("branch_id", &ids).Error
	return ids, err
}

func upsertOpeningBalance(ctx context.Context, rec *models.OpeningCashBalance) error {
	rec.BalanceDate = startOfDay(rec.BalanceDate)
	existing, err := findByBranchDateMode(ctx, rec.BranchID, rec.BalanceDate, rec.Mode, rec.BankID)
	if err == nil {
		existing.Amount = rec.Amount
		existing.FromBankID = rec.FromBankID
		existing.FromBank = nil
		if err := config.DB.
			WithContext(ctx).Save(existing).Error; err != nil {
			return err
		}
		*rec = *existing
		return nil
	}
	if err != gorm.ErrRecordNotFound {
		return err
	}
	return config.DB.
		WithContext(ctx).Create(rec).Error
}

func SetOpeningBalance(c echo.Context) error {
	ctx := auth.RequestContext(c)
	var req setOpeningBalanceRequest
	if err := common.BindJSON(c, &req); err != nil {
		return c.JSON(http.StatusBadRequest, echo.Map{"success": false, "error": "Invalid input"})
	}
	date, err := parseOptionalDate(req.Date)
	if err != nil {
		return c.JSON(http.StatusBadRequest, echo.Map{"success": false, "error": "invalid date: expected YYYY-MM-DD"})
	}
	if _, ok := auth.NarrowBranch(c, &req.BranchID); !ok {
		return common.FailErr(c, common.NewForbidden("that branch is outside your current branch selection"))
	}
	rec, err := SaveOpeningBalance(ctx, req.BranchID, date, req.Mode, req.BankID, req.FromBankID, req.Amount)
	if err != nil {
		return common.FailErr(c, err)
	}
	return common.Success(c, http.StatusOK, rec)
}

func GetOpeningBalance(c echo.Context) error {
	ctx := auth.RequestContext(c)
	branchIDStr := c.QueryParam("branch_id")
	if branchIDStr == "" {
		return c.JSON(http.StatusBadRequest, echo.Map{"success": false, "error": "branch_id is required"})
	}
	branchID, err := strconv.ParseUint(branchIDStr, 10, 64)
	if err != nil {
		return c.JSON(http.StatusBadRequest, echo.Map{"success": false, "error": "invalid branch_id"})
	}
	date, err := parseQueryDate(c)
	if err != nil {
		return c.JSON(http.StatusBadRequest, echo.Map{"success": false, "error": "invalid date: expected YYYY-MM-DD"})
	}
	var bankID *uint
	if raw := c.QueryParam("bank_id"); raw != "" {
		v, err := strconv.ParseUint(raw, 10, 64)
		if err != nil {
			return c.JSON(http.StatusBadRequest, echo.Map{"success": false, "error": "Invalid bank_id, please pick a bank from the list"})
		}
		id := uint(v)
		bankID = &id
	}
	requested := uint(branchID)
	if _, ok := auth.NarrowBranch(c, &requested); !ok {
		return common.FailErr(c, common.NewForbidden("that branch is outside your current branch selection"))
	}
	rec, err := getOpeningBalance(ctx, requested, date, c.QueryParam("mode"), bankID)
	if err != nil {
		return common.FailErr(c, err)
	}
	return common.Success(c, http.StatusOK, rec)
}
