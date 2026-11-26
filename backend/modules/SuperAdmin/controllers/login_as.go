package controllers

import (
	"cloudhouse/backend/auth"
	common "cloudhouse/backend/common/controllers"
	"cloudhouse/backend/config"
	"cloudhouse/backend/modules/SuperAdmin/models"
	"context"
	"errors"
	"fmt"
	"net/http"

	"github.com/labstack/echo/v4"
	"gorm.io/gorm"
)

// "Login as" for debugging: the superadmin opens a business as its Administrator or any staff member without their
// password. The session is an ordinary stateless token (marked with the superadmin's id), so the employee is never
// signed out and nothing in the business changes until the superadmin does something inside it. Every start is
// written to the superadmin audit log. See common/controllers/auth_login_as.go for the hand-off.

type LoginAsStaff struct {
	ID         uint   `json:"id"`
	Name       string `json:"name"`
	Username   string `json:"username"`
	Role       string `json:"role"`
	BranchName string `json:"branch_name"`
	IsSystem   bool   `json:"is_system"`
	IsActive   bool   `json:"is_active"`
	CanLogin   bool   `json:"can_login"`
}

type LoginAsStart struct {
	Code         string `json:"code"`
	BusinessCode string `json:"business_code"`
}

func listLoginAsStaff(ctx context.Context, tenantID uint) ([]LoginAsStaff, error) {
	if _, err := common.FindTenantByID(ctx, tenantID); err != nil {
		return nil, common.NewNotFound("business not found")
	}
	out := []LoginAsStaff{}
	err := inTenantTx(ctx, tenantID, func(tx *gorm.DB, tctx context.Context) error {
		return tx.WithContext(tctx).Table("employees AS e").
			Select(`e.id, e.name, COALESCE(e.username, '') AS username, e.role, COALESCE(b.name, '') AS branch_name,
				r.is_system, r.is_active, (COALESCE(e.password_hash, '') <> '') AS can_login`).
			Joins("JOIN roles r ON r.id = e.role_id").
			Joins("LEFT JOIN branches b ON b.id = e.branch_id").
			Where("e.deleted_at IS NULL").
			Order("r.is_system DESC, r.is_active DESC, e.name").
			Scan(&out).Error
	})
	return out, err
}

func startLoginAs(ctx context.Context, actor *models.SuperAdminUser, tenantID, employeeID uint) (*LoginAsStart, error) {
	t, err := common.FindTenantByID(ctx, tenantID)
	if err != nil {
		return nil, common.NewNotFound("business not found")
	}
	tctx := config.WithTenant(ctx, tenantID)
	emp, err := common.FindEmployeeByID(tctx, employeeID)
	if err != nil {
		if errors.Is(err, gorm.ErrRecordNotFound) {
			return nil, common.NewNotFound("this employee is not in this business")
		}
		return nil, err
	}
	if emp.TenantID != tenantID {
		return nil, common.NewNotFound("this employee is not in this business")
	}
	session, ok := common.CurrentSession(tctx, emp.ID)
	if !ok {
		return nil, common.NewNotFound("this employee is not in this business")
	}
	if !session.IsActive {
		return nil, common.NewConflict("this employee's role is inactive, so they cannot sign in")
	}
	emp.IsSystem = session.IsSystem
	token, err := auth.IssueImpersonationToken(emp.ID, emp.Role, emp.RoleID, emp.TenantID, emp.BranchID, actor.ID,
		config.Env.JWTSecret, common.LoginAsSessionTTL)
	if err != nil {
		return nil, err
	}
	code, err := common.IssueLoginAsCode(token, emp)
	if err != nil {
		return nil, err
	}
	who := emp.Name
	if emp.Username != "" {
		who += " (" + emp.Username + ")"
	}
	auditBusiness(ctx, actor, "login_as", &t.ID, t.Name, fmt.Sprintf("logged in as %s, role %s", who, emp.Role), "")
	return &LoginAsStart{Code: code, BusinessCode: t.Code}, nil
}

func ListLoginAsStaff(c echo.Context) error {
	id, err := common.IDParam(c, "id")
	if err != nil {
		return common.FailErr(c, err)
	}
	rec, err := listLoginAsStaff(auth.RequestContext(c), id)
	if err != nil {
		return common.FailErr(c, err)
	}
	return common.Success(c, http.StatusOK, rec)
}

func StartLoginAs(c echo.Context) error {
	id, err := common.IDParam(c, "id")
	if err != nil {
		return common.FailErr(c, err)
	}
	employeeID, err := common.IDParam(c, "employee_id")
	if err != nil {
		return common.FailErr(c, err)
	}
	rec, err := startLoginAs(auth.RequestContext(c), actor(c), id, employeeID)
	if err != nil {
		return common.FailErr(c, err)
	}
	return common.Success(c, http.StatusOK, rec)
}
