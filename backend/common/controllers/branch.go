package controllers

import (
	"cloudhouse/backend/auth"
	commonModels "cloudhouse/backend/common/models"
	"cloudhouse/backend/config"
	"context"
	"errors"
	"fmt"
	"net/http"
	"strings"

	"github.com/labstack/echo/v4"
	"gorm.io/gorm"
)

type branchCreateRequest struct {
	Name    string `json:"name" binding:"required"`
	Code    string `json:"code"`
	Address string `json:"address" binding:"required"`
	Phone   string `json:"phone"`
}

type branchUpdateRequest struct {
	Name     string `json:"name" binding:"required"`
	Code     string `json:"code"`
	Address  string `json:"address" binding:"required"`
	Phone    string `json:"phone"`
	IsActive bool   `json:"is_active"`
}

type BranchFilter struct {
	BranchID   *uint
	Query      string
	ActiveOnly bool
	Limit      int
	Offset     int
}

type BranchCreateInput struct {
	Name    string
	Code    string
	Address string
	Phone   string
}

type BranchUpdateInput struct {
	Name     string
	Code     string
	Address  string
	Phone    string
	IsActive bool
}

type actor struct {
	employeeID uint
	label      string
}

func InsertBranch(ctx context.Context, b *commonModels.Branch) error {
	return config.DB.
		WithContext(ctx).Create(b).Error
}

func createTx(tx *gorm.DB, b *commonModels.Branch) error {
	return tx.Create(b).Error
}

func updateTx(tx *gorm.DB, b *commonModels.Branch) error {
	return tx.Save(b).Error
}

func findAllBranches(ctx context.Context, branchID *uint) ([]commonModels.Branch, error) {
	branches, _, err := findBranchesFiltered(ctx, BranchFilter{BranchID: branchID})
	return branches, err
}

func findBranchesFiltered(ctx context.Context, f BranchFilter) ([]commonModels.Branch, int64, error) {
	var branches []commonModels.Branch
	q := config.DB.
		WithContext(ctx).Model(&commonModels.Branch{}).Where("name <> ''").Order("name asc")
	if f.BranchID != nil {
		q = q.Where("id = ?", *f.BranchID)
	}
	if f.ActiveOnly {
		q = q.Where("is_active = ?", true)
	}
	if f.Query != "" {
		like := "%" + f.Query + "%"
		q = q.Where("name ILIKE ? OR code ILIKE ?", like, like)
	}
	var total int64
	if f.Limit > 0 {
		if err := q.Session(&gorm.Session{}).Count(&total).Error; err != nil {
			return nil, 0, err
		}
		q = q.Limit(f.Limit)
	}
	if f.Offset > 0 {
		q = q.Offset(f.Offset)
	}
	err := q.Find(&branches).Error
	return branches, total, err
}

func FindBranchByID(ctx context.Context, id uint) (*commonModels.Branch, error) {
	var b commonModels.Branch
	if err := config.DB.
		WithContext(ctx).First(&b, id).Error; err != nil {
		return nil, err
	}
	return &b, nil
}

func findBranchByName(ctx context.Context, name string) (*commonModels.Branch, error) {
	var b commonModels.Branch
	if err := config.DB.
		WithContext(ctx).Where("name = ?", name).First(&b).Error; err != nil {
		return nil, err
	}
	return &b, nil
}

func findByCode(ctx context.Context, code string) (*commonModels.Branch, error) {
	var b commonModels.Branch
	if err := config.DB.
		WithContext(ctx).Unscoped().Where("code = ?", code).First(&b).Error; err != nil {
		return nil, err
	}
	return &b, nil
}

func persistBranch(ctx context.Context, b *commonModels.Branch) error {
	return config.DB.
		WithContext(ctx).Save(b).Error
}

func BranchExists(ctx context.Context, id uint) (bool, error) {
	var count int64
	err := config.DB.
		WithContext(ctx).Model(&commonModels.Branch{}).Where("id = ?", id).Count(&count).Error
	return count > 0, err
}

func FirstOrCreateByName(ctx context.Context, name string) (*commonModels.Branch, error) {
	var b commonModels.Branch
	err := config.DB.
		WithContext(ctx).Where("name = ?", name).
		Attrs(commonModels.Branch{Name: name, Code: "HO", Address: "Unknown", IsActive: true}).
		FirstOrCreate(&b).Error
	if err != nil {
		return nil, err
	}
	return &b, nil
}

func FindHeadOffice(ctx context.Context) (*commonModels.Branch, error) {
	var b commonModels.Branch
	err := config.DB.
		WithContext(ctx).Where("name = ? AND is_active = ?", "Head Office", true).Order("id").First(&b).Error
	if err == nil {
		return &b, nil
	}
	if !errors.Is(err, gorm.ErrRecordNotFound) {
		return nil, err
	}
	if err := config.DB.
		WithContext(ctx).Where("is_active = ? AND name <> ''", true).Order("id").First(&b).Error; err != nil {
		return nil, err
	}
	return &b, nil
}

func countBranchReferences(ctx context.Context, branchID uint) (int64, error) {
	var count int64
	for _, table := range []string{"employees", "expenses", "cash_movements", "customers"} {
		var c int64
		if err := config.DB.
			WithContext(ctx).Table(table).Where("branch_id = ?", branchID).Count(&c).Error; err != nil {
			return 0, err
		}
		count += c
	}
	return count, nil
}

func SingleBranchHeadOffice(ctx context.Context, tenantID uint) (uint, bool, error) {
	var row struct {
		SingleBranch bool
		HeadOfficeID uint
	}
	err := config.DB.
		WithContext(ctx).Raw(`
		SELECT t.single_branch,
		       COALESCE((SELECT b.id FROM branches b
		                  WHERE b.tenant_id = t.id AND b.is_active AND b.deleted_at IS NULL AND b.name <> ''
		                  ORDER BY (b.name = 'Head Office') DESC, b.id LIMIT 1), 0) AS head_office_id
		  FROM tenants t WHERE t.id = ?`, tenantID).Scan(&row).Error
	if err != nil {
		return 0, false, err
	}
	return row.HeadOfficeID, row.SingleBranch, nil
}

func branchValidate(name, code, address string) error {
	if name == "" {
		return NewBadRequest("name is required")
	}
	if code == "" {
		return NewBadRequest("branch code is required")
	}
	if address == "" {
		return NewBadRequest("address is required")
	}
	return nil
}

func branchLogAudit(ctx context.Context, a actor, action string, entityID uint, entityName, detail string) {
	if a.employeeID == 0 {
		return
	}
	name := a.label
	if name == "" {
		name = "unknown"
	}
	writeAuditLog(ctx, a.employeeID, name, action, "branch", entityID, entityName, detail)
}

func createBranch(ctx context.Context, in BranchCreateInput, by actor) (*commonModels.Branch, error) {
	in.Code = strings.ToUpper(strings.TrimSpace(in.Code))
	if err := branchValidate(in.Name, in.Code, in.Address); err != nil {
		return nil, err
	}
	if existing, _ := findBranchByName(ctx, in.Name); existing != nil {
		return nil, NewConflict("a branch with this name already exists")
	}
	if existing, _ := findByCode(ctx, in.Code); existing != nil {
		return nil, NewConflict("a branch with this code already exists")
	}
	rec := &commonModels.Branch{
		Name:     in.Name,
		Code:     in.Code,
		Address:  in.Address,
		Phone:    in.Phone,
		IsActive: true,
	}
	if err := reserveAndCreate(ctx, rec); err != nil {
		return nil, err
	}
	branchLogAudit(ctx, by, commonModels.ActionBranchCreated, rec.ID, rec.Name, "code="+rec.Code)
	return rec, nil
}

func reserveAndCreate(ctx context.Context, rec *commonModels.Branch) error {
	tenantID, ok := config.TenantFromContext(ctx)
	if !ok {
		return InsertBranch(ctx, rec)
	}
	return reserveBranchSlot(ctx, tenantID, func(tx *gorm.DB) error {
		return createTx(tx, rec)
	})
}

func branchQuotaUsage(ctx context.Context) (*BranchUsage, error) {
	tenantID, ok := config.TenantFromContext(ctx)
	if !ok {
		return nil, NewUnauthorized("no business in session")
	}
	return branchUsage(ctx, tenantID)
}

func listBranches(ctx context.Context, branchID *uint) ([]commonModels.Branch, error) {
	return findAllBranches(ctx, branchID)
}

func findBranches(ctx context.Context, f BranchFilter) ([]commonModels.Branch, int64, error) {
	return findBranchesFiltered(ctx, f)
}

func getBranch(ctx context.Context, id uint) (*commonModels.Branch, error) {
	rec, err := FindBranchByID(ctx, id)
	if err != nil {
		return nil, NewNotFound("branch not found")
	}
	return rec, nil
}

func updateBranch(ctx context.Context, id uint, in BranchUpdateInput, by actor) (*commonModels.Branch, error) {
	in.Code = strings.ToUpper(strings.TrimSpace(in.Code))
	if err := branchValidate(in.Name, in.Code, in.Address); err != nil {
		return nil, err
	}
	rec, err := FindBranchByID(ctx, id)
	if err != nil {
		return nil, NewNotFound("branch not found")
	}
	if existing, _ := findBranchByName(ctx, in.Name); existing != nil && existing.ID != id {
		return nil, NewConflict("a branch with this name already exists")
	}
	if existing, _ := findByCode(ctx, in.Code); existing != nil && existing.ID != id {
		return nil, NewConflict("a branch with this code already exists")
	}
	reactivating := !rec.IsActive && in.IsActive
	wasActive := rec.IsActive
	rec.Name = in.Name
	rec.Code = in.Code
	rec.Address = in.Address
	rec.Phone = in.Phone
	rec.IsActive = in.IsActive
	detail := fmt.Sprintf("name=%s active=%v", rec.Name, rec.IsActive)
	if reactivating {
		if err := reserveAndUpdate(ctx, rec); err != nil {
			return nil, err
		}
		branchLogAudit(ctx, by, commonModels.ActionBranchUpdated, rec.ID, rec.Name, detail)
		return rec, nil
	}
	if err := persistBranch(ctx, rec); err != nil {
		return nil, err
	}
	action := commonModels.ActionBranchUpdated
	if wasActive && !rec.IsActive {
		action = "branch_deactivated"
	}
	branchLogAudit(ctx, by, action, rec.ID, rec.Name, detail)
	return rec, nil
}

func reserveAndUpdate(ctx context.Context, rec *commonModels.Branch) error {
	tenantID, ok := config.TenantFromContext(ctx)
	if !ok {
		return persistBranch(ctx, rec)
	}
	return reserveBranchSlot(ctx, tenantID, func(tx *gorm.DB) error {
		return updateTx(tx, rec)
	})
}

func deactivateBranch(ctx context.Context, id uint, by actor) (*commonModels.Branch, error) {
	rec, err := FindBranchByID(ctx, id)
	if err != nil {
		return nil, NewNotFound("branch not found")
	}
	refs, err := countBranchReferences(ctx, id)
	if err != nil {
		return nil, err
	}
	if refs > 0 {
		return nil, NewConflict("branch cannot be deactivated while it still has linked employees, expenses, cash movements, or customers")
	}
	rec.IsActive = false
	if err := persistBranch(ctx, rec); err != nil {
		return nil, err
	}
	branchLogAudit(ctx, by, "branch_deactivated", rec.ID, rec.Name, "")
	return rec, nil
}

func listSwitchable(ctx context.Context, crossBranch bool, ownBranchID uint) ([]commonModels.Branch, error) {
	if crossBranch {
		return findAllBranches(ctx, nil)
	}
	own := ownBranchID
	return findAllBranches(ctx, &own)
}

func CreateBranch(c echo.Context) error {
	ctx := auth.RequestContext(c)
	var req branchCreateRequest
	if err := BindJSON(c, &req); err != nil {
		return c.JSON(http.StatusBadRequest, echo.Map{"success": false, "error": "Invalid input"})
	}
	empID, role, _ := auth.ActorFromContext(c)
	rec, err := createBranch(ctx, BranchCreateInput{Name: req.Name, Code: req.Code, Address: req.Address, Phone: req.Phone}, actor{empID, role})
	if err != nil {
		return FailErr(c, err)
	}
	return Success(c, http.StatusOK, rec)
}

func GetBranchQuota(c echo.Context) error {
	usage, err := branchQuotaUsage(auth.RequestContext(c))
	if err != nil {
		return FailErr(c, err)
	}
	return Success(c, http.StatusOK, usage)
}

func ListBranches(c echo.Context) error {
	ctx := auth.RequestContext(c)
	page, limit, offset := PageParams(c)
	f := BranchFilter{BranchID: auth.GetBranchScope(c), Query: strings.TrimSpace(c.QueryParam("search")), ActiveOnly: c.QueryParam("is_active") == "true"}
	if limit > 0 {
		f.Limit, f.Offset = limit, offset
		rec, total, err := findBranches(ctx, f)
		if err != nil {
			return FailErr(c, err)
		}
		return SuccessPage(c, page, limit, total, rec)
	}
	rec, _, err := findBranches(ctx, f)
	if err != nil {
		return FailErr(c, err)
	}
	return SuccessAll(c, rec)
}

func GetBranchById(c echo.Context) error {
	ctx := auth.RequestContext(c)
	id, err := IDParam(c, "id")
	if err != nil {
		return FailErr(c, err)
	}
	rec, err := getBranch(ctx, id)
	if err != nil {
		return FailErr(c, err)
	}
	return Success(c, http.StatusOK, rec)
}

func UpdateBranch(c echo.Context) error {
	ctx := auth.RequestContext(c)
	id, err := IDParam(c, "id")
	if err != nil {
		return FailErr(c, err)
	}
	var req branchUpdateRequest
	if err := BindJSON(c, &req); err != nil {
		return c.JSON(http.StatusBadRequest, echo.Map{"success": false, "error": "Invalid input"})
	}
	empID, role, _ := auth.ActorFromContext(c)
	rec, err := updateBranch(ctx, id, BranchUpdateInput{
		Name: req.Name, Code: req.Code, Address: req.Address, Phone: req.Phone, IsActive: req.IsActive,
	}, actor{empID, role})
	if err != nil {
		return FailErr(c, err)
	}
	return Success(c, http.StatusOK, rec)
}

func DeleteBranch(c echo.Context) error {
	ctx := auth.RequestContext(c)
	id, err := IDParam(c, "id")
	if err != nil {
		return FailErr(c, err)
	}
	empID, role, _ := auth.ActorFromContext(c)
	rec, err := deactivateBranch(ctx, id, actor{empID, role})
	if err != nil {
		return FailErr(c, err)
	}
	return Success(c, http.StatusOK, rec)
}

func ListSwitchableBranches(c echo.Context) error {
	ctx := auth.RequestContext(c)
	_, pinned := auth.SingleBranchPin(c)
	crossBranch := auth.IsCrossBranchRole(c) && !pinned
	var own uint
	if scope := auth.GetBranchScope(c); scope != nil {
		own = *scope
	}
	rec, err := listSwitchable(ctx, crossBranch, own)
	if err != nil {
		return FailErr(c, err)
	}
	return Success(c, http.StatusOK, echo.Map{"branches": rec, "can_switch": crossBranch})
}
