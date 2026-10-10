package controllers

import (
	"cloudhouse/backend/auth"
	common "cloudhouse/backend/common/controllers"
	"cloudhouse/backend/config"
	"cloudhouse/backend/modules/Cash/models"
	"context"
	"errors"
	"net/http"
	"strconv"
	"strings"

	"github.com/labstack/echo/v4"

	"gorm.io/gorm"
)

type LoanSourceInput struct {
	BankID          uint
	LoanNumber      string
	PrincipalAmount float64
	InterestRate    *float64
	DurationMonths  *int
}

type loanSourceRequest struct {
	BankID          uint     `json:"bank_id"`
	LoanNumber      string   `json:"loan_number"`
	PrincipalAmount float64  `json:"principal_amount"`
	InterestRate    *float64 `json:"interest_rate"`
	DurationMonths  *int     `json:"duration_months"`
}

type cashSourceRequest struct {
	Name string `json:"name"`
}

func IsLoanSource(name string) bool {
	return strings.HasPrefix(strings.ToLower(strings.TrimSpace(name)), "loan")
}

func findLoanSource(ctx context.Context, name string) *models.CashSource {
	if !IsLoanSource(name) {
		return nil
	}
	src, err := findByName(ctx, strings.TrimSpace(name))
	if err != nil || !hasLoanDetails(src) {
		return nil
	}
	return src
}

func resolveLoanSource(ctx context.Context, name string) (*models.CashSource, error) {
	trimmed := strings.TrimSpace(name)
	src, err := findByName(ctx, trimmed)
	if err == nil {
		return src, nil
	}
	if !errors.Is(err, gorm.ErrRecordNotFound) {
		return nil, err
	}
	src = &models.CashSource{Name: trimmed}
	if err := insertCashSource(ctx, src); err != nil {
		return nil, err
	}
	return src, nil
}

func getCashSource(ctx context.Context, id uint) (*models.CashSource, LoanBalance, error) {
	src, err := findCategoryByID(ctx, id)
	if err != nil {
		return nil, LoanBalance{}, common.NewNotFound("cash source not found")
	}
	if !IsLoanSource(src.Name) || !hasLoanDetails(src) {
		return src, LoanBalance{}, nil
	}
	b, err := loanBalance(ctx, src, false)
	return src, b, err
}

func searchLoanSources(ctx context.Context, query string, bankID uint, limit, offset int) ([]models.LoanCashSource, error) {
	return searchDistinctLoans(ctx, query, bankID, limit, offset)
}

func loanSourcesByMovementIDs(ctx context.Context, ids []uint) map[uint]*models.LoanCashSource {
	return findByCashMovementIDs(ctx, ids)
}

func getLoanSource(ctx context.Context, movementID uint) *models.LoanCashSource {
	rec, err := findByCashMovementID(ctx, movementID)
	if err != nil {
		return nil
	}
	return rec
}

func (req movementRequest) toLoanSourceInput() *LoanSourceInput {
	if req.LoanSource == nil {
		return nil
	}
	return &LoanSourceInput{
		BankID:          req.LoanSource.BankID,
		LoanNumber:      req.LoanSource.LoanNumber,
		PrincipalAmount: req.LoanSource.PrincipalAmount,
		InterestRate:    req.LoanSource.InterestRate,
		DurationMonths:  req.LoanSource.DurationMonths,
	}
}

func withLoanSources(ctx context.Context, rows []models.CashMovement) []movementResponse {
	var ids []uint
	for _, m := range rows {
		if IsLoanSource(m.Source) {
			ids = append(ids, m.ID)
		}
	}
	sources := loanSourcesByMovementIDs(ctx, ids)
	out := make([]movementResponse, len(rows))
	for i := range rows {
		out[i] = movementResponse{CashMovement: &rows[i], LoanSource: sources[rows[i].ID]}
	}
	return out
}

func listCashSources(ctx context.Context, query string, limit, offset int) ([]models.CashSource, int64, error) {
	if offset == 0 {
		if err := ensureBuiltInCategories(ctx); err != nil {
			return nil, 0, err
		}
	}
	return findCashSources(ctx, query, limit, offset)
}

func findCashSourceOrCreate(ctx context.Context, name string) (*models.CashSource, bool, error) {
	trimmed := strings.TrimSpace(name)
	if trimmed == "" {
		return nil, false, common.NewBadRequest("name is required")
	}
	if strings.ToLower(strings.ReplaceAll(trimmed, " ", "")) == "goldsale" {
		return nil, false, common.NewBadRequest("\"Gold Sale\" is a built-in source")
	}
	return findOrCreateCategory(ctx, trimmed, models.CategoryCashIn)
}

func insertCashSource(ctx context.Context, s *models.CashSource) error {
	s.Type = models.CategoryCashIn
	return insertCategory(ctx, s)
}

func findCashSources(ctx context.Context, query string, limit, offset int) ([]models.CashSource, int64, error) {
	return findCategories(ctx, models.CategoryCashIn, query, limit, offset)
}

func insertLoanCashSource(ctx context.Context, rec *models.LoanCashSource) error {
	return config.DB.
		WithContext(ctx).Create(rec).Error
}

func searchDistinctLoans(ctx context.Context, query string, bankID uint, limit, offset int) ([]models.LoanCashSource, error) {
	var recs []models.LoanCashSource
	q := config.DB.
		WithContext(ctx).Model(&models.LoanCashSource{}).
		Select("DISTINCT ON (LOWER(loan_number)) *").
		Order("LOWER(loan_number), created_at DESC")
	if query != "" {
		q = q.Where("loan_number ILIKE ?", "%"+query+"%")
	}
	if bankID > 0 {
		q = q.Where("bank_id = ?", bankID)
	}
	if limit > 0 {
		q = q.Limit(limit).Offset(offset)
	}
	err := q.Preload("Bank").Find(&recs).Error
	return recs, err
}

func ListLoanSources(c echo.Context) error {
	ctx := auth.RequestContext(c)
	page, limit, offset := common.PageParams(c)
	bankID, _ := strconv.Atoi(c.QueryParam("bank_id"))
	fetch := 0
	if limit > 0 {
		fetch = limit + 1
	}
	if bankID < 0 {
		bankID = 0
	}
	rec, err := searchLoanSources(ctx, strings.TrimSpace(c.QueryParam("search")), uint(bankID), fetch, offset)
	if err != nil {
		return common.FailErr(c, err)
	}
	hasMore := limit > 0 && len(rec) > limit
	if hasMore {
		rec = rec[:limit]
	}
	if limit == 0 {
		return common.SuccessAll(c, rec)
	}
	return common.SuccessList(c, page, limit, common.NextPages(page, hasMore), rec)
}

func GetCashSourceById(c echo.Context) error {
	ctx := auth.RequestContext(c)
	id, err := common.IDParam(c, "id")
	if err != nil {
		return common.FailErr(c, err)
	}
	src, bal, err := getCashSource(ctx, id)
	if err != nil {
		return common.FailErr(c, err)
	}
	return common.Success(c, http.StatusOK, echo.Map{"source": src, "is_loan": IsLoanSource(src.Name), "balance": bal})
}

func GetCashSourceLedger(c echo.Context) error {
	ctx := auth.RequestContext(c)
	id, err := common.IDParam(c, "id")
	if err != nil {
		return common.FailErr(c, err)
	}
	src, bal, err := getCashSource(ctx, id)
	if err != nil {
		return common.FailErr(c, err)
	}
	if !IsLoanSource(src.Name) {
		respondCashInLedger(c, src)
		return nil
	}
	if !hasLoanDetails(src) {
		return c.JSON(http.StatusNotFound, echo.Map{"success": false, "error": "this loan has no details recorded yet"})
	}
	respondLoanLedger(c, src, bal)
	return nil
}

func ListCashSources(c echo.Context) error {
	ctx := auth.RequestContext(c)
	page, limit, offset := common.PageParams(c)
	if limit == 0 {
		rec, _, err := listCashSources(ctx, c.QueryParam("search"), 0, 0)
		if err != nil {
			return common.FailErr(c, err)
		}
		return common.SuccessAll(c, rec)
	}
	rec, total, err := listCashSources(ctx, c.QueryParam("search"), limit, offset)
	if err != nil {
		return common.FailErr(c, err)
	}
	return common.SuccessPage(c, page, limit, total, rec)
}

func CreateCashSource(c echo.Context) error {
	ctx := auth.RequestContext(c)
	var req cashSourceRequest
	if err := common.BindJSON(c, &req); err != nil {
		return c.JSON(http.StatusBadRequest, echo.Map{"success": false, "error": "Invalid input"})
	}
	rec, created, err := findCashSourceOrCreate(ctx, req.Name)
	if err != nil {
		return common.FailErr(c, err)
	}
	if created {
		return common.Success(c, http.StatusOK, rec)
	}
	return common.Success(c, http.StatusOK, rec)
}
