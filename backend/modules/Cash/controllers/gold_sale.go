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
	"gorm.io/gorm"
)

// goldSaleSource is the source of the cash-in line a gold sale books.
const goldSaleSource = "GoldSale"

type RecordGoldSaleInput struct {
	OrnamentType string
	SoldAmount   float64
	CostAmount   float64
	SoldOn       time.Time
	BranchID     uint
	Mode         string
	BankID       *uint
	CostMode     string
	CostBankID   *uint
	Remarks      string
	ReceiptImage string
}

type goldSaleRequest struct {
	OrnamentType string  `json:"ornament_type" binding:"required"`
	SoldAmount   float64 `json:"sold_amount" binding:"required"`
	CostAmount   float64 `json:"cost_amount"`
	SoldOn       string  `json:"sold_on"`
	BranchID     uint    `json:"branch_id" binding:"required"`
	Mode         string  `json:"mode"`
	BankID       *uint   `json:"bank_id"`
	CostMode     string  `json:"cost_mode"`
	CostBankID   *uint   `json:"cost_bank_id"`
	Remarks      string  `json:"remarks"`
	ReceiptImage string  `json:"receipt_image"`
}

// costPayment checks how a gold sale's cost to acquire was paid. With no cost there is nothing to pay, so the mode
// and bank are dropped; otherwise the mode defaults to Cash and a UPI / Bank Transfer cost names its bank.
func costPayment(cost float64, mode string, bankID *uint) (string, *uint, error) {
	if cost <= 0 {
		return "", nil, nil
	}
	if mode == "" {
		mode = models.CashModeCash
	}
	if !modeVocabulary[mode] {
		return "", nil, common.NewBadRequest("cost mode must be Cash, UPI or Bank Transfer")
	}
	if mode == models.CashModeCash {
		return mode, nil, nil
	}
	if bankID == nil || *bankID == 0 {
		return "", nil, common.NewBadRequest("cost bank is required when the cost mode is UPI or Bank Transfer")
	}
	return mode, bankID, nil
}

type GoldSaleTotals struct {
	TotalSold   float64 `json:"total_sold"`
	TotalCost   float64 `json:"total_cost"`
	TotalProfit float64 `json:"total_profit"`
}

func recordGoldSaleCashIn(ctx context.Context, ornamentType string, amount float64, branchID uint, occurredOn time.Time, mode string, bankID *uint, remarks, receipt string) (uint, error) {
	rec := &models.CashMovement{
		Type:         "in",
		Source:       goldSaleSource,
		Purpose:      "Gold sale — " + ornamentType,
		Amount:       amount,
		Mode:         mode,
		BankID:       bankID,
		BranchID:     &branchID,
		Remarks:      strings.TrimSpace(remarks),
		ReceiptImage: receipt,
		IsManual:     true,
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

// recordGoldSaleCostOut books a gold sale's cost to acquire as an ordinary cash-out in the mode (and bank) it was paid.
func recordGoldSaleCostOut(ctx context.Context, ornamentType string, amount float64, branchID uint, occurredOn time.Time, mode string, bankID *uint) (uint, error) {
	rec := goldSaleCostMovement(ornamentType, amount, branchID, occurredOn, mode, bankID)
	if err := insertMovement(ctx, &rec); err != nil {
		return 0, err
	}
	return rec.ID, nil
}

func goldSaleCostMovement(ornamentType string, amount float64, branchID uint, occurredOn time.Time, mode string, bankID *uint) models.CashMovement {
	rec := models.CashMovement{
		Type:     "out",
		Purpose:  "Gold purchase cost — " + ornamentType,
		Mode:     mode,
		BankID:   bankID,
		Amount:   amount,
		BranchID: &branchID,
	}
	if occurredOn.IsZero() {
		rec.OccurredOn = time.Now()
	} else {
		rec.OccurredOn = occurredOn
	}
	return rec
}

func createGoldSale(ctx context.Context, in RecordGoldSaleInput) (*models.GoldSale, error) {
	if in.OrnamentType == "" {
		return nil, common.NewBadRequest("ornament type is required")
	}
	if in.SoldAmount <= 0 {
		return nil, common.NewBadRequest("sold amount must be greater than zero")
	}
	if in.CostAmount < 0 {
		return nil, common.NewBadRequest("cost amount must be zero or greater")
	}
	if in.BranchID == 0 {
		return nil, common.NewBadRequest("branch is required")
	}
	if ok, err := common.BranchExists(ctx, in.BranchID); err != nil {
		return nil, err
	} else if !ok {
		return nil, common.NewBadRequest("branch does not exist")
	}
	mode := in.Mode
	if mode == "" {
		mode = models.CashModeCash
	}
	if !modeVocabulary[mode] {
		return nil, common.NewBadRequest("mode must be Cash, UPI or Bank Transfer")
	}
	if (mode == models.CashModeUPI || mode == models.CashModeBankTransfer) && in.BankID == nil {
		return nil, common.NewBadRequest("bank is required when mode is UPI or Bank Transfer")
	}
	costMode, costBankID, err := costPayment(in.CostAmount, in.CostMode, in.CostBankID)
	if err != nil {
		return nil, err
	}
	soldOn := in.SoldOn
	if soldOn.IsZero() {
		soldOn = time.Now()
	}
	// The cost to acquire is a cash-out in the mode it was paid, like any other debit, and the profit is what is left.
	// It is booked first so the ledgers list the debit before the sale's credit.
	var costMovementID *uint
	if in.CostAmount > 0 {
		id, err := recordGoldSaleCostOut(ctx, in.OrnamentType, in.CostAmount, in.BranchID, soldOn, costMode, costBankID)
		if err != nil {
			return nil, err
		}
		costMovementID = &id
	}
	movementID, err := recordGoldSaleCashIn(ctx, in.OrnamentType, in.SoldAmount, in.BranchID, soldOn, mode, in.BankID, in.Remarks, in.ReceiptImage)
	if err != nil {
		if costMovementID != nil {
			_ = removeMovement(ctx, *costMovementID)
		}
		return nil, err
	}
	rec := &models.GoldSale{
		OrnamentType:       in.OrnamentType,
		SoldAmount:         in.SoldAmount,
		CostAmount:         in.CostAmount,
		Profit:             in.SoldAmount - in.CostAmount,
		SoldOn:             soldOn,
		BranchID:           in.BranchID,
		Mode:               mode,
		BankID:             in.BankID,
		CostMode:           costMode,
		CostBankID:         costBankID,
		CashMovementID:     &movementID,
		CostCashMovementID: costMovementID,
		Remarks:            in.Remarks,
		ReceiptImage:       in.ReceiptImage,
	}
	if err := insertGoldSale(ctx, rec); err != nil {
		_ = removeMovement(ctx, movementID)
		if costMovementID != nil {
			_ = removeMovement(ctx, *costMovementID)
		}
		return nil, err
	}
	return findGoldSaleByID(ctx, rec.ID)
}

func listGoldSales(ctx context.Context, branchID *uint, fromDate, toDate time.Time, search string, limit, offset int) ([]models.GoldSale, int64, error) {
	return findGoldSales(ctx, branchID, fromDate, toDate, search, limit, offset)
}

func getGoldSale(ctx context.Context, id uint, branchID *uint) (*models.GoldSale, error) {
	rec, err := findGoldSaleByID(ctx, id)
	if err != nil {
		return nil, common.NewNotFound("gold sale not found")
	}
	if branchID != nil && rec.BranchID != *branchID {
		return nil, common.NewNotFound("gold sale not found")
	}
	return rec, nil
}

func (req goldSaleRequest) toInput() (RecordGoldSaleInput, error) {
	soldOn, err := parseOccurredOn(req.SoldOn)
	if err != nil {
		return RecordGoldSaleInput{}, common.NewBadRequest("invalid sold_on: expected YYYY-MM-DD")
	}
	return RecordGoldSaleInput{
		OrnamentType: req.OrnamentType, SoldAmount: req.SoldAmount, CostAmount: req.CostAmount,
		SoldOn: soldOn, BranchID: req.BranchID, Mode: req.Mode, BankID: req.BankID, CostMode: req.CostMode, CostBankID: req.CostBankID, Remarks: req.Remarks, ReceiptImage: req.ReceiptImage,
	}, nil
}

func insertGoldSale(ctx context.Context, rec *models.GoldSale) error {
	return config.DB.
		WithContext(ctx).Create(rec).Error
}

func findGoldSaleByID(ctx context.Context, id uint) (*models.GoldSale, error) {
	var rec models.GoldSale
	if err := config.DB.
		WithContext(ctx).Preload("Branch").Preload("BankRef").First(&rec, id).Error; err != nil {
		return nil, err
	}
	return &rec, nil
}

func findGoldSales(ctx context.Context, branchID *uint, fromDate, toDate time.Time, search string, limit, offset int) ([]models.GoldSale, int64, error) {
	var sales []models.GoldSale
	q := config.DB.
		WithContext(ctx).Preload("Branch").Preload("BankRef").Order("sold_on desc, id desc")
	if branchID != nil {
		q = q.Where("branch_id = ?", *branchID)
	}
	if !fromDate.IsZero() {
		q = q.Where("sold_on >= ?", fromDate)
	}
	if !toDate.IsZero() {
		q = q.Where("sold_on < ?", toDate.AddDate(0, 0, 1))
	}
	if search != "" {
		like := "%" + search + "%"
		q = q.Where("ornament_type ILIKE ? OR remarks ILIKE ?", like, like)
	}
	var total int64
	if limit > 0 {
		if err := q.Session(&gorm.Session{}).Model(&models.GoldSale{}).Count(&total).Error; err != nil {
			return nil, 0, err
		}
		q = q.Limit(limit)
	}
	if offset > 0 {
		q = q.Offset(offset)
	}
	err := q.Find(&sales).Error
	return sales, total, err
}

func sumGoldSaleFiltered(ctx context.Context, branchID *uint, fromDate, toDate time.Time, search string) (GoldSaleTotals, error) {
	q := config.DB.
		WithContext(ctx).Model(&models.GoldSale{})
	if branchID != nil {
		q = q.Where("branch_id = ?", *branchID)
	}
	if !fromDate.IsZero() {
		q = q.Where("sold_on >= ?", fromDate)
	}
	if !toDate.IsZero() {
		q = q.Where("sold_on < ?", toDate.AddDate(0, 0, 1))
	}
	if search != "" {
		like := "%" + search + "%"
		q = q.Where("ornament_type ILIKE ? OR remarks ILIKE ?", like, like)
	}
	var t GoldSaleTotals
	err := q.Select(`COALESCE(SUM(sold_amount), 0) AS total_sold, COALESCE(SUM(cost_amount), 0) AS total_cost,
		COALESCE(SUM(profit), 0) AS total_profit`).Scan(&t).Error
	return t, err
}

func RecordGoldSale(c echo.Context) error {
	ctx := auth.RequestContext(c)
	var req goldSaleRequest
	if err := common.BindJSON(c, &req); err != nil {
		return c.JSON(http.StatusBadRequest, echo.Map{"success": false, "error": "Invalid input"})
	}
	input, err := req.toInput()
	if err != nil {
		return common.FailErr(c, err)
	}
	input.BranchID = auth.EnforceBranchOnWrite(c, input.BranchID)
	rec, err := createGoldSale(ctx, input)
	if err != nil {
		return common.FailErr(c, err)
	}
	return common.Success(c, http.StatusOK, rec)
}

func ListGoldSales(c echo.Context) error {
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
	if limit > 0 {
		rec, total, err := listGoldSales(ctx, branchID, fromDate, toDate, search, limit, offset)
		if err != nil {
			return common.FailErr(c, err)
		}
		totals, err := sumGoldSaleFiltered(ctx, branchID, fromDate, toDate, search)
		if err != nil {
			return common.FailErr(c, err)
		}
		return common.SuccessPage(c, page, limit, total, rec, echo.Map{
			"total_sold": totals.TotalSold, "total_cost": totals.TotalCost, "total_profit": totals.TotalProfit})
	}
	rec, _, err := listGoldSales(ctx, branchID, fromDate, toDate, search, 0, 0)
	if err != nil {
		return common.FailErr(c, err)
	}
	return common.SuccessAll(c, rec)
}

func GetGoldSaleById(c echo.Context) error {
	ctx := auth.RequestContext(c)
	id, err := common.IDParam(c, "id")
	if err != nil {
		return common.FailErr(c, err)
	}
	rec, err := getGoldSale(ctx, id, auth.GetBranchScope(c))
	if err != nil {
		return common.FailErr(c, err)
	}
	return common.Success(c, http.StatusOK, rec)
}
