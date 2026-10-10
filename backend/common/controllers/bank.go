package controllers

import (
	"cloudhouse/backend/auth"
	commonModels "cloudhouse/backend/common/models"
	"cloudhouse/backend/config"
	"context"
	"errors"
	"fmt"
	"net/http"
	"regexp"
	"strings"

	"github.com/labstack/echo/v4"
	"gorm.io/gorm"
	"gorm.io/gorm/clause"
)

var bankRefColumns = []struct{ table, column string }{
	{"cash_movements", "bank_id"},
	{"cash_movements", "to_bank_id"},
	{"expenses", "from_bank_id"},
	{"expenses", "to_bank_id"},
	{"bank_pledge_records", "bank_id"},
	{"loan_cash_sources", "bank_id"},
	{"gold_sales", "bank_id"},
	{"loan_payments", "bank_id"},
	{"personal_loan_payments", "bank_id"},
	{"opening_cash_balances", "bank_id"},
}

var bankPhoneRe = regexp.MustCompile(`^\d{10}$`)

type bankRequest struct {
	Name      string `json:"name"`
	BranchID  uint   `json:"branch_id"`
	Branch    string `json:"branch"`
	Ifsc      string `json:"ifsc"`
	AccountNo string `json:"account_no"`
	Phone     string `json:"phone"`
}

type mergeRequest struct {
	TargetID uint `json:"target_id" binding:"required"`
}

type BankCreateInput struct {
	Name      string
	BranchID  uint
	Branch    string
	Ifsc      string
	AccountNo string
	Phone     string
}

type HeadOfficeFinder interface {
	FindHeadOffice(ctx context.Context) (*commonModels.Branch, error)
}

type BalanceSource interface {
	BankBalances(ctx context.Context, branchID *uint) (map[uint]float64, float64, error)
}

type BankView struct {
	commonModels.Bank
	BranchName string  `json:"branch_name"`
	Balance    float64 `json:"balance"`
}

func insertBank(ctx context.Context, b *commonModels.Bank) error {
	return config.DB.
		WithContext(ctx).Omit(clause.Associations).Create(b).Error
}

func findBanks(ctx context.Context, query string, branchID *uint, limit, offset int) ([]commonModels.Bank, int64, error) {
	var banks []commonModels.Bank
	q := config.DB.
		WithContext(ctx).Preload("BusinessBranch").Order("name asc")
	if query != "" {
		q = q.Where("name ILIKE ?", "%"+query+"%")
	}
	if branchID != nil {
		q = q.Where("branch_id = ?", *branchID)
	}
	var total int64
	if limit > 0 {
		if err := q.Session(&gorm.Session{}).Model(&commonModels.Bank{}).Count(&total).Error; err != nil {
			return nil, 0, err
		}
		q = q.Limit(limit).Offset(offset)
	}
	err := q.Find(&banks).Error
	return banks, total, err
}

func findBankByName(ctx context.Context, name string) (*commonModels.Bank, error) {
	var b commonModels.Bank
	if err := config.DB.
		WithContext(ctx).Where("name ILIKE ?", name).First(&b).Error; err != nil {
		return nil, err
	}
	return &b, nil
}

func findBankByID(ctx context.Context, id uint) (*commonModels.Bank, error) {
	var b commonModels.Bank
	if err := config.DB.
		WithContext(ctx).Preload("BusinessBranch").First(&b, id).Error; err != nil {
		return nil, err
	}
	return &b, nil
}

func persistBank(ctx context.Context, b *commonModels.Bank) error {
	return config.DB.
		WithContext(ctx).Omit(clause.Associations).Save(b).Error
}

func countBankReferences(ctx context.Context, bankID uint) (int64, error) {
	var count int64
	for _, ref := range bankRefColumns {
		var c int64
		if err := config.DB.
			WithContext(ctx).Table(ref.table).Where(ref.column+" = ?", bankID).Count(&c).Error; err != nil {
			return 0, err
		}
		count += c
	}
	return count, nil
}

func removeBank(ctx context.Context, id uint) error {
	return config.DB.
		WithContext(ctx).Delete(&commonModels.Bank{}, id).Error
}

func reassignBankID(ctx context.Context, fromID, toID uint) error {
	for _, ref := range bankRefColumns {
		if err := config.DB.
			WithContext(ctx).Table(ref.table).Where(ref.column+" = ?", fromID).Update(ref.column, toID).Error; err != nil {
			return err
		}
	}
	return nil
}

func listBanks(ctx context.Context, query string, branchID *uint, limit, offset int) ([]commonModels.Bank, int64, error) {
	return findBanks(ctx, query, branchID, limit, offset)
}

func listWithBalances(ctx context.Context, query string, branchID *uint, limit, offset int) (views []BankView, count int64, total, unassigned float64, err error) {
	rows, count, err := findBanks(ctx, query, branchID, limit, offset)
	if err != nil {
		return nil, 0, 0, 0, err
	}
	var balances map[uint]float64
	var bankSide float64
	if BankBalances != nil &&
		!config.IsDemoRun(ctx) {
		if balances, bankSide, err = BankBalances(ctx, branchID); err != nil {
			return nil, 0, 0, 0, err
		}
	}
	views = make([]BankView, len(rows))
	for i, b := range rows {
		views[i] = BankView{Bank: b, Balance: balances[b.ID]}
		if b.BusinessBranch != nil {
			views[i].BranchName = b.BusinessBranch.Name
		}
	}
	all := rows
	if limit > 0 {
		if all, _, err = findBanks(ctx, query, branchID, 0, 0); err != nil {
			return nil, 0, 0, 0, err
		}
	}
	for _, b := range all {
		total += balances[b.ID]
	}
	if query == "" && (BankBalances != nil &&
		!config.IsDemoRun(ctx)) {
		unassigned = bankSide - total
	}
	return views, count, total, unassigned, nil
}

func resolveBranch(ctx context.Context, branchID uint) (uint, error) {
	if branchID != 0 ||
		config.IsDemoRun(ctx) {
		return branchID, nil
	}
	ho, err := FindHeadOffice(ctx)
	if err != nil {
		return 0, NewBadRequest("select the branch this bank account belongs to")
	}
	return ho.ID, nil
}

func FindBankOrCreate(ctx context.Context, in BankCreateInput) (*commonModels.Bank, bool, error) {
	trimmed := strings.TrimSpace(in.Name)
	if trimmed == "" {
		return nil, false, NewBadRequest("name is required")
	}
	phone := strings.TrimSpace(in.Phone)
	if phone != "" && !bankPhoneRe.MatchString(phone) {
		return nil, false, NewBadRequest("phone number must be exactly 10 digits")
	}
	existing, err := findBankByName(ctx, trimmed)
	if err == nil {
		return existing, false, nil
	}
	if !errors.Is(err, gorm.ErrRecordNotFound) {
		return nil, false, err
	}
	branchID, err := resolveBranch(ctx, in.BranchID)
	if err != nil {
		return nil, false, err
	}
	rec := &commonModels.Bank{Name: trimmed, BranchID: branchID, Branch: strings.TrimSpace(in.Branch), Ifsc: strings.TrimSpace(in.Ifsc), AccountNo: strings.TrimSpace(in.AccountNo), Phone: phone}
	if err := insertBank(ctx, rec); err != nil {
		return nil, false, err
	}
	return rec, true, nil
}

func getBank(ctx context.Context, id uint) (*commonModels.Bank, error) {
	rec, err := findBankByID(ctx, id)
	if err != nil {
		return nil, NewNotFound("bank not found")
	}
	return rec, nil
}

func updateBank(ctx context.Context, id uint, in BankCreateInput) (*commonModels.Bank, error) {
	rec, err := findBankByID(ctx, id)
	if err != nil {
		return nil, NewNotFound("bank not found")
	}
	trimmed := strings.TrimSpace(in.Name)
	if trimmed == "" {
		return nil, NewBadRequest("name is required")
	}
	phone := strings.TrimSpace(in.Phone)
	if phone != "" && !bankPhoneRe.MatchString(phone) {
		return nil, NewBadRequest("phone number must be exactly 10 digits")
	}
	if existing, _ := findBankByName(ctx, trimmed); existing != nil && existing.ID != id {
		return nil, NewConflict("a bank with this name already exists")
	}
	rec.Name = trimmed
	if in.BranchID != 0 {
		rec.BranchID = in.BranchID
	}
	rec.Branch = strings.TrimSpace(in.Branch)
	rec.Ifsc = strings.TrimSpace(in.Ifsc)
	rec.AccountNo = strings.TrimSpace(in.AccountNo)
	rec.Phone = phone
	if err := persistBank(ctx, rec); err != nil {
		return nil, err
	}
	return rec, nil
}

func deleteBank(ctx context.Context, id uint) error {
	if _, err := findBankByID(ctx, id); err != nil {
		return NewNotFound("bank not found")
	}
	refs, err := countBankReferences(ctx, id)
	if err != nil {
		return err
	}
	if refs > 0 {
		return NewConflict(fmt.Sprintf(
			"this bank has %d linked transaction(s)/pledge(s) and cannot be deleted — merge it into another bank instead", refs))
	}
	return removeBank(ctx, id)
}

func mergeBank(ctx context.Context, sourceID, targetID uint) (*commonModels.Bank, error) {
	if sourceID == targetID {
		return nil, NewBadRequest("cannot merge a bank into itself")
	}
	if _, err := findBankByID(ctx, sourceID); err != nil {
		return nil, NewNotFound("bank not found")
	}
	target, err := findBankByID(ctx, targetID)
	if err != nil {
		return nil, NewNotFound("bank not found")
	}
	if err := reassignBankID(ctx, sourceID, targetID); err != nil {
		return nil, err
	}
	if err := removeBank(ctx, sourceID); err != nil {
		return nil, err
	}
	return target, nil
}

func ListBanks(c echo.Context) error {
	ctx := auth.RequestContext(c)
	page, limit, offset := PageParams(c)
	scope := auth.GetBranchScope(c)
	if limit == 0 {
		rec, _, _, _, err := listWithBalances(ctx, c.QueryParam("search"), scope, 0, 0)
		if err != nil {
			return FailErr(c, err)
		}
		return SuccessAll(c, rec)
	}
	rec, total, totalBalance, unassigned, err := listWithBalances(ctx, c.QueryParam("search"), scope, limit, offset)
	if err != nil {
		return FailErr(c, err)
	}
	return SuccessPage(c, page, limit, total, rec, echo.Map{
		"total_balance": totalBalance, "unassigned_balance": unassigned,
	})
}

func CreateBank(c echo.Context) error {
	ctx := auth.RequestContext(c)
	var req bankRequest
	if err := BindJSON(c, &req); err != nil {
		return c.JSON(http.StatusBadRequest, echo.Map{"success": false, "error": "Invalid input"})
	}
	rec, created, err := FindBankOrCreate(ctx, BankCreateInput{Name: req.Name, BranchID: auth.EnforceBranchOnWrite(c, req.BranchID), Branch: req.Branch, Ifsc: req.Ifsc, AccountNo: req.AccountNo, Phone: req.Phone})
	if err != nil {
		return FailErr(c, err)
	}
	if created {
		return Success(c, http.StatusOK, rec)
	}
	return Success(c, http.StatusOK, rec)
}

func GetBankById(c echo.Context) error {
	ctx := auth.RequestContext(c)
	id, err := IDParam(c, "id")
	if err != nil {
		return FailErr(c, err)
	}
	rec, err := getBank(ctx, id)
	if err != nil {
		return FailErr(c, err)
	}
	return Success(c, http.StatusOK, rec)
}

func UpdateBank(c echo.Context) error {
	ctx := auth.RequestContext(c)
	id, err := IDParam(c, "id")
	if err != nil {
		return FailErr(c, err)
	}
	var req bankRequest
	if err := BindJSON(c, &req); err != nil {
		return c.JSON(http.StatusBadRequest, echo.Map{"success": false, "error": "Invalid input"})
	}
	branchID := req.BranchID
	if branchID != 0 {
		branchID = auth.EnforceBranchOnWrite(c, branchID)
	}
	rec, err := updateBank(ctx, id, BankCreateInput{Name: req.Name, BranchID: branchID, Branch: req.Branch, Ifsc: req.Ifsc, AccountNo: req.AccountNo, Phone: req.Phone})
	if err != nil {
		return FailErr(c, err)
	}
	return Success(c, http.StatusOK, rec)
}

func DeleteBank(c echo.Context) error {
	ctx := auth.RequestContext(c)
	id, err := IDParam(c, "id")
	if err != nil {
		return FailErr(c, err)
	}
	if err := deleteBank(ctx, id); err != nil {
		return FailErr(c, err)
	}
	return Success(c, http.StatusOK, echo.Map{"deleted": true})
}

func MergeBank(c echo.Context) error {
	ctx := auth.RequestContext(c)
	sourceID, err := IDParam(c, "id")
	if err != nil {
		return FailErr(c, err)
	}
	var req mergeRequest
	if err := BindJSON(c, &req); err != nil {
		return c.JSON(http.StatusBadRequest, echo.Map{"success": false, "error": "Invalid input"})
	}
	rec, err := mergeBank(ctx, sourceID, req.TargetID)
	if err != nil {
		return FailErr(c, err)
	}
	return Success(c, http.StatusOK, rec)
}
