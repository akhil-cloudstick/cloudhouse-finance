package controllers

import (
	"cloudhouse/backend/auth"
	common "cloudhouse/backend/common/controllers"
	"cloudhouse/backend/config"
	"cloudhouse/backend/modules/Cash/models"
	"context"
	"errors"
	"net/http"
	"strings"

	"github.com/labstack/echo/v4"

	"gorm.io/gorm"
)

type expenseCategoryRequest struct {
	Name string `json:"name"`
}

type categoryRequest struct {
	Name string `json:"name"`
	Type string `json:"type"`
}

func ensureLoanCategory(ctx context.Context, name string) error {
	if _, err := findByName(ctx, name); err == nil {
		return nil
	} else if !errors.Is(err, gorm.ErrRecordNotFound) {
		return err
	}
	return insertExpenseCategory(ctx, &models.ExpenseCategory{Name: name})
}

func findOrCreateCategory(ctx context.Context, name, typ string) (*models.Category, bool, error) {
	trimmed := strings.TrimSpace(name)
	if trimmed == "" {
		return nil, false, common.NewBadRequest("name is required")
	}
	existing, err := findByName(ctx, trimmed)
	if err == nil {
		if existing.Type != typ && !existing.IsCommon {
			if err := markCommon(ctx, existing); err != nil {
				return nil, false, err
			}
		}
		return existing, false, nil
	}
	if !errors.Is(err, gorm.ErrRecordNotFound) {
		return nil, false, err
	}
	rec := &models.Category{Type: typ, Name: trimmed}
	if err := insertCategory(ctx, rec); err != nil {
		return nil, false, err
	}
	return rec, true, nil
}

func validCategoryType(typ string) bool {
	return typ == models.CategoryCashIn || typ == models.CategoryExpense || typ == "self_transfer"
}

func categoryWhere(category string) (string, []interface{}) {
	switch category {
	case "loan":
		return "((source ILIKE ? OR purpose LIKE ? OR purpose LIKE ?) AND purpose NOT LIKE ?)", []interface{}{"Loan%", "Loan disbursement — %", "Loan top-up — %", "%PL-%"}
	case "auction":
		return "(source = ? OR purpose LIKE ?)", []interface{}{"Auction", "Auction surplus settlement%"}
	case "collection":
		return "(source = ? AND purpose NOT LIKE ?)", []interface{}{"Collection", "%PL-%"}
	case "expenses":
		return "(type = ? AND source IS DISTINCT FROM ? AND source IS DISTINCT FROM ? AND (purpose IS NULL OR (purpose NOT LIKE ? AND purpose NOT LIKE ? AND purpose NOT LIKE ? AND purpose NOT LIKE ? AND purpose NOT LIKE ?)))",
			[]interface{}{"out", "Loan", "Auction", "Loan disbursement — %", "Auction surplus settlement%", "Bank pledge release — %", "Loan top-up — %", "%— INV-%"}
	case "personal loan":
		return "(((source = ? OR source = ?) AND purpose LIKE ?) OR purpose LIKE ?)", []interface{}{"Loan", "Collection", "%PL-%", "Loan disbursement — PL-%"}
	case "investment":
		return "(source = ? OR purpose LIKE ?)", []interface{}{"Investment", "%INV-%"}
	}
	return "", nil
}

func missingLoanCategoryNames(ctx context.Context) ([]string, error) {
	var names []string
	err := config.DB.
		WithContext(ctx).Model(&models.Category{}).
		Where("principal_amount IS NOT NULL AND name ILIKE ? AND is_common = ?", "loan%", false).
		Pluck("name", &names).Error
	return names, err
}

func listCategories(ctx context.Context, typ, query string, limit, offset int) ([]models.Category, int64, error) {
	if !validCategoryType(typ) {
		return nil, 0, common.NewBadRequest("type must be cash_in, expense or self_transfer")
	}
	if offset == 0 {
		if err := ensureBuiltInCategories(ctx); err != nil {
			return nil, 0, err
		}
	}
	if typ == "self_transfer" && offset == 0 {
		if _, _, err := findOrCreateCategory(ctx, "Bank to Bank", "self_transfer"); err != nil {
			return nil, 0, err
		}
	}
	return findCategories(ctx, typ, query, limit, offset)
}

func findCategoryOrCreate(ctx context.Context, name, typ string) (*models.Category, bool, error) {
	if !validCategoryType(typ) {
		return nil, false, common.NewBadRequest("type must be cash_in, expense or self_transfer")
	}
	if typ == models.CategoryCashIn && strings.ToLower(strings.ReplaceAll(strings.TrimSpace(name), " ", "")) == "goldsale" {
		return nil, false, common.NewBadRequest("\"Gold Sale\" is a built-in source")
	}
	return findOrCreateCategory(ctx, name, typ)
}

func listExpenseCategories(ctx context.Context, query string, limit, offset int) ([]models.ExpenseCategory, int64, error) {
	// Every bank loan's repayment category must be pickable — create any that a loan opened earlier never got.
	if offset == 0 {
		if err := ensureBuiltInCategories(ctx); err != nil {
			return nil, 0, err
		}
		missing, err := missingLoanCategoryNames(ctx)
		if err != nil {
			return nil, 0, err
		}
		for _, name := range missing {
			if _, _, err := findExpenseCategoryOrCreate(ctx, name); err != nil {
				return nil, 0, err
			}
		}
	}
	return findExpenseCategories(ctx, query, limit, offset)
}

func findByID(ctx context.Context, id uint) (*models.ExpenseCategory, error) {
	return findCategoryByID(ctx, id)
}

func findExpenseCategoryOrCreate(ctx context.Context, name string) (*models.ExpenseCategory, bool, error) {
	return findOrCreateCategory(ctx, name, models.CategoryExpense)
}

func insertCategory(ctx context.Context, c *models.Category) error {
	if c.Type == "" {
		c.Type = models.CategoryCashIn
	}
	return config.DB.
		WithContext(ctx).Create(c).Error
}

func findCategories(ctx context.Context, typ, query string, limit, offset int) ([]models.Category, int64, error) {
	var cats []models.Category
	q := config.DB.
		WithContext(ctx).
		Order("CASE WHEN principal_amount IS NOT NULL THEN 0 ELSE 1 END, name asc")
	if query != "" {
		q = q.Where("LOWER(REPLACE(name, ' ', '')) LIKE ?", "%"+strings.ToLower(strings.ReplaceAll(query, " ", ""))+"%")
	} else {
		q = q.Where("(type = ? OR is_common = ?)", typ, true)
	}
	var total int64
	if limit > 0 {
		if err := q.Session(&gorm.Session{}).Model(&models.Category{}).Count(&total).Error; err != nil {
			return nil, 0, err
		}
		q = q.Limit(limit).Offset(offset)
	}
	err := q.Find(&cats).Error
	return cats, total, err
}

func findByName(ctx context.Context, name string) (*models.Category, error) {
	var c models.Category
	if err := config.DB.
		WithContext(ctx).Where("name ILIKE ?", name).First(&c).Error; err != nil {
		return nil, err
	}
	return &c, nil
}

func findCategoryByID(ctx context.Context, id uint) (*models.Category, error) {
	var c models.Category
	if err := config.DB.
		WithContext(ctx).First(&c, id).Error; err != nil {
		return nil, err
	}
	return &c, nil
}

func markCommon(ctx context.Context, c *models.Category) error {
	c.IsCommon = true
	return config.DB.
		WithContext(ctx).Model(&models.Category{}).Where("id = ?", c.ID).Update("is_common", true).Error
}

func saveLoanDetails(ctx context.Context, s *models.Category) error {
	s.IsCommon = true
	return config.DB.
		WithContext(ctx).Model(&models.Category{}).Where("id = ?", s.ID).
		Updates(map[string]interface{}{"loan_number": s.LoanNumber, "principal_amount": s.PrincipalAmount, "loan_opened_at": s.LoanOpenedAt, "is_common": true}).Error
}

func insertExpenseCategory(ctx context.Context, c *models.ExpenseCategory) error {
	c.Type = models.CategoryExpense
	return insertCategory(ctx, c)
}

func findExpenseCategories(ctx context.Context, query string, limit, offset int) ([]models.ExpenseCategory, int64, error) {
	return findCategories(ctx, models.CategoryExpense, query, limit, offset)
}

func ListExpenseCategories(c echo.Context) error {
	ctx := auth.RequestContext(c)
	page, limit, offset := common.PageParams(c)
	if limit == 0 {
		rec, _, err := listExpenseCategories(ctx, c.QueryParam("search"), 0, 0)
		if err != nil {
			return common.FailErr(c, err)
		}
		return common.SuccessAll(c, rec)
	}
	rec, total, err := listExpenseCategories(ctx, c.QueryParam("search"), limit, offset)
	if err != nil {
		return common.FailErr(c, err)
	}
	return common.SuccessPage(c, page, limit, total, rec)
}

func CreateExpenseCategory(c echo.Context) error {
	ctx := auth.RequestContext(c)
	var req expenseCategoryRequest
	if err := common.BindJSON(c, &req); err != nil {
		return c.JSON(http.StatusBadRequest, echo.Map{"success": false, "error": "Invalid input"})
	}
	rec, created, err := findExpenseCategoryOrCreate(ctx, req.Name)
	if err != nil {
		return common.FailErr(c, err)
	}
	if created {
		return common.Success(c, http.StatusOK, rec)
	}
	return common.Success(c, http.StatusOK, rec)
}

func GetExpenseCategoryLedger(c echo.Context) error {
	ctx := auth.RequestContext(c)
	id, err := common.IDParam(c, "id")
	if err != nil {
		return common.FailErr(c, err)
	}
	cat, err := findByID(ctx, id)
	if err != nil {
		return c.JSON(http.StatusNotFound, echo.Map{"success": false, "error": "expense category not found"})
	}
	if src := findLoanSource(ctx, cat.Name); src != nil {
		src, bal, err := getCashSource(ctx, src.ID)
		if err != nil {
			return common.FailErr(c, err)
		}
		respondLoanLedger(c, src, bal)
		return nil
	}
	if cat.Type == models.CategoryCashIn && !cat.IsCommon {
		respondCashInLedger(c, cat)
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
	rec, total, totals, err := listLedgerByCategory(ctx, cat.Name, auth.GetBranchScope(c), fromDate, toDate, limit, offset)
	if err != nil {
		return common.FailErr(c, err)
	}
	respondLedger(c, page, limit, export, "Expense Ledger — "+cat.Name, "expense-category-ledger.pdf", fromDate, toDate, rec, total, totals, echo.Map{"category_name": cat.Name})
	return nil
}

func ListCategories(c echo.Context) error {
	ctx := auth.RequestContext(c)
	page, limit, offset := common.PageParams(c)
	typ := c.QueryParam("type")
	if limit == 0 {
		rec, _, err := listCategories(ctx, typ, c.QueryParam("search"), 0, 0)
		if err != nil {
			return common.FailErr(c, err)
		}
		return common.SuccessAll(c, rec)
	}
	rec, total, err := listCategories(ctx, typ, c.QueryParam("search"), limit, offset)
	if err != nil {
		return common.FailErr(c, err)
	}
	return common.SuccessPage(c, page, limit, total, rec)
}

func CreateCategory(c echo.Context) error {
	ctx := auth.RequestContext(c)
	var req categoryRequest
	if err := common.BindJSON(c, &req); err != nil {
		return c.JSON(http.StatusBadRequest, echo.Map{"success": false, "error": "Invalid input"})
	}
	rec, created, err := findCategoryOrCreate(ctx, req.Name, req.Type)
	if err != nil {
		return common.FailErr(c, err)
	}
	if created {
		return common.Success(c, http.StatusOK, rec)
	}
	return common.Success(c, http.StatusOK, rec)
}
