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
	"time"

	"github.com/labstack/echo/v4"
	"golang.org/x/crypto/bcrypt"
	"gorm.io/gorm"
	"gorm.io/gorm/clause"
)

var usernameRe = regexp.MustCompile(`^[A-Za-z0-9._-]{3,60}$`)

var emailRe = regexp.MustCompile(`^[^\s@]+@[^\s@]+\.[^\s@]+$`)

var employeePhoneRe = regexp.MustCompile(`^\d{10}$`)

type employeeCreateRequest struct {
	Name     string `json:"name" binding:"required"`
	Role     string `json:"role" binding:"required"`
	BranchID uint   `json:"branch_id" binding:"required"`
	Phone    string `json:"phone"`
	Username string `json:"username"`
	Password string `json:"password"`
}

type employeeUpdateRequest struct {
	Name           string  `json:"name" binding:"required"`
	Role           string  `json:"role" binding:"required"`
	BranchID       uint    `json:"branch_id" binding:"required"`
	Phone          string  `json:"phone"`
	LoansProcessed int     `json:"loans_processed"`
	Collections    float64 `json:"collections"`
	Followups      int     `json:"followups"`
	Pending        int     `json:"pending"`
	Username       string  `json:"username"`
	Email          string  `json:"email"`
	Password       string  `json:"password"`
}

type EmployeeCreateInput struct {
	Name          string
	Role          string
	BranchID      uint
	Phone         string
	Username      string
	Password      string
	ActorIsSystem bool
}

type EmployeeUpdateInput struct {
	Name           string
	Role           string
	BranchID       uint
	Phone          string
	LoansProcessed int
	Collections    float64
	Followups      int
	Pending        int
	Username       string
	Email          string
	Password       string
	ActorIsSystem  bool
}

func InsertEmployee(ctx context.Context, e *commonModels.Employee) error {
	return config.DB.
		WithContext(ctx).Create(e).Error
}

func FindByRole(ctx context.Context, roleName string) ([]commonModels.Employee, error) {
	var out []commonModels.Employee
	err := config.DB.
		WithContext(ctx).Where("role = ?", roleName).Find(&out).Error
	return out, err
}

func findEmployees(ctx context.Context, branchID *uint, search string, limit, offset int) ([]commonModels.Employee, int64, error) {
	var employees []commonModels.Employee
	q := config.DB.
		WithContext(ctx).Preload("Branch").Order("id asc")
	if branchID != nil {
		q = q.Where("branch_id = ?", *branchID)
	}
	if search != "" {
		like := "%" + search + "%"
		q = q.Where("name ILIKE ? OR code ILIKE ? OR phone ILIKE ? OR username ILIKE ? OR email ILIKE ?", like, like, like, like, like)
	}
	var total int64
	if limit > 0 {
		if err := q.Session(&gorm.Session{}).Model(&commonModels.Employee{}).Count(&total).Error; err != nil {
			return nil, 0, err
		}
		q = q.Limit(limit)
	}
	if offset > 0 {
		q = q.Offset(offset)
	}
	err := q.Find(&employees).Error
	return employees, total, err
}

func FindEmployeeByID(ctx context.Context, id uint) (*commonModels.Employee, error) {
	var e commonModels.Employee
	if err := config.DB.
		WithContext(ctx).Preload("Branch").First(&e, id).Error; err != nil {
		return nil, err
	}
	return &e, nil
}

func persistEmployee(ctx context.Context, e *commonModels.Employee) error {
	return config.DB.
		WithContext(ctx).Omit(clause.Associations).Save(e).Error
}

func removeEmployee(ctx context.Context, id uint) error {
	return config.DB.
		WithContext(ctx).Delete(&commonModels.Employee{}, id).Error
}

func countEmployeeAll(ctx context.Context) (int64, error) {
	var count int64
	err := config.DB.
		WithContext(ctx).Unscoped().Model(&commonModels.Employee{}).Count(&count).Error
	return count, err
}

func findByEmail(ctx context.Context, email string) (*commonModels.Employee, error) {
	var e commonModels.Employee
	if email == "" {
		return nil, gorm.ErrRecordNotFound
	}
	if err := config.DB.
		WithContext(ctx).Preload("Branch").Where("email = ?", email).First(&e).Error; err != nil {
		return nil, err
	}
	return &e, nil
}

func findByUsername(ctx context.Context, username string) (*commonModels.Employee, error) {
	var e commonModels.Employee
	if username == "" {
		return nil, gorm.ErrRecordNotFound
	}
	if err := config.DB.
		WithContext(ctx).Preload("Branch").Where("username = ?", username).First(&e).Error; err != nil {
		return nil, err
	}
	return &e, nil
}

func findByPhone(ctx context.Context, phone string) (*commonModels.Employee, error) {
	var e commonModels.Employee
	if phone == "" {
		return nil, gorm.ErrRecordNotFound
	}
	if err := config.DB.
		WithContext(ctx).Preload("Branch").Where("phone = ?", phone).First(&e).Error; err != nil {
		return nil, err
	}
	return &e, nil
}

func findByUsernameOrPhone(ctx context.Context, identifier string) (*commonModels.Employee, error) {
	var e commonModels.Employee
	if identifier == "" {
		return nil, gorm.ErrRecordNotFound
	}
	if err := config.DB.
		WithContext(ctx).Preload("Branch").Where("username = ? OR phone = ?", identifier, identifier).First(&e).Error; err != nil {
		return nil, err
	}
	return &e, nil
}

func findByResetTokenHash(ctx context.Context, tokenHash string) (*commonModels.Employee, error) {
	var e commonModels.Employee
	if err := config.DB.
		WithContext(ctx).Where("password_reset_token_hash = ? AND password_reset_expires_at > ?", tokenHash, time.Now()).First(&e).Error; err != nil {
		return nil, err
	}
	return &e, nil
}

func CurrentSession(ctx context.Context, employeeID uint) (auth.Session, bool) {
	var s auth.Session
	if err := config.DB.
		WithContext(ctx).Table("employees AS e").
		Select("e.role, e.role_id, e.branch_id, r.is_system, r.is_active").
		Joins("JOIN roles r ON r.id = e.role_id").
		Where("e.id = ? AND e.deleted_at IS NULL", employeeID).
		Take(&s).Error; err != nil {
		return auth.Session{}, false
	}
	return s, true
}

func validatePhone(phone string) error {
	if phone == "" {
		return nil
	}
	if !employeePhoneRe.MatchString(phone) {
		return NewBadRequest("phone must be a 10-digit number")
	}
	return nil
}

func employeeLogAudit(ctx context.Context, actorEmployeeID uint, action string, entityID uint, entityName, detail string) {
	if actorEmployeeID == 0 {
		return
	}
	actorName := "unknown"
	if actor, err := FindEmployeeByID(ctx, actorEmployeeID); err == nil {
		actorName = actor.Name
	}
	writeAuditLog(ctx, actorEmployeeID, actorName, action, "employee", entityID, entityName, detail)
}

func resolveRoleID(ctx context.Context, roleName string, actorIsSystem bool) (uint, error) {
	var role commonModels.Role
	if err := config.DB.
		WithContext(ctx).Select("id", "is_system").Where("name = ?", roleName).First(&role).Error; err != nil {
		return 0, NewBadRequest("role does not exist")
	}
	if role.IsSystem && !actorIsSystem {
		return 0, NewForbidden("You cannot assign a system role")
	}
	return role.ID, nil
}

func validateCreate(in EmployeeCreateInput) error {
	if in.Name == "" {
		return NewBadRequest("name is required")
	}
	if in.Role == "" {
		return NewBadRequest("role is required")
	}
	if in.BranchID == 0 {
		return NewBadRequest("branch is required")
	}
	if err := validatePhone(in.Phone); err != nil {
		return err
	}
	if in.Username != "" && !usernameRe.MatchString(in.Username) {
		return NewBadRequest("username must be at least 3 characters and contain only letters, numbers, dots, underscores or hyphens")
	}
	if in.Password != "" && len(in.Password) < 8 {
		return NewBadRequest("password must be at least 8 characters")
	}
	return nil
}

func checkEmployeeBranch(ctx context.Context, id uint) error {
	ok, err := BranchExists(ctx, id)
	if err != nil {
		return err
	}
	if !ok {
		return NewBadRequest("branch does not exist")
	}
	return nil
}

func checkEmployeePhoneUnique(ctx context.Context, phone string, excludeID uint) error {
	if phone == "" {
		return nil
	}
	existing, err := findByPhone(ctx, phone)
	if err == nil && existing.ID != excludeID {
		return NewConflict("phone number is already in use by another employee")
	} else if err != nil && !errors.Is(err, gorm.ErrRecordNotFound) {
		return err
	}
	return nil
}

func employeePhoneConflict(err error) error {
	if err != nil && strings.Contains(err.Error(), "uq_employees_tenant_phone") {
		return NewConflict("phone number is already in use by another employee")
	}
	return err
}

func checkUsernameUnique(ctx context.Context, username string, excludeID uint) error {
	if username == "" {
		return nil
	}
	existing, err := findByUsername(ctx, username)
	if err == nil && existing.ID != excludeID {
		return NewConflict("username is already in use by another employee")
	} else if err != nil && !errors.Is(err, gorm.ErrRecordNotFound) {
		return err
	}
	return nil
}

func SaveEmployee(ctx context.Context, in EmployeeCreateInput, actorEmployeeID uint) (*commonModels.Employee, error) {
	if err := validateCreate(in); err != nil {
		return nil, err
	}
	if err := checkEmployeeBranch(ctx, in.BranchID); err != nil {
		return nil, err
	}
	if err := checkEmployeePhoneUnique(ctx, in.Phone, 0); err != nil {
		return nil, err
	}
	if err := checkUsernameUnique(ctx, in.Username, 0); err != nil {
		return nil, err
	}
	count, err := countEmployeeAll(ctx)
	if err != nil {
		return nil, err
	}
	code := fmt.Sprintf("EMP-%02d", count+1)
	roleID, err := resolveRoleID(ctx, in.Role, in.ActorIsSystem)
	if err != nil {
		return nil, err
	}
	rec := &commonModels.Employee{
		Code:     code,
		Name:     in.Name,
		Role:     in.Role,
		RoleID:   roleID,
		BranchID: in.BranchID,
		Phone:    in.Phone,
		Username: in.Username,
	}
	if in.Password != "" {
		hash, err := bcrypt.GenerateFromPassword([]byte(in.Password), bcrypt.DefaultCost+2)
		if err != nil {
			return nil, err
		}
		rec.PasswordHash = string(hash)
	}
	if err := InsertEmployee(ctx, rec); err != nil {
		return nil, employeePhoneConflict(err)
	}
	employeeLogAudit(ctx, actorEmployeeID, "employee_created", rec.ID, rec.Name, "role="+rec.Role)
	return FindEmployeeByID(ctx, rec.ID)
}

func listEmployees(ctx context.Context, branchID *uint, search string, limit, offset int) ([]commonModels.Employee, int64, error) {
	return findEmployees(ctx, branchID, search, limit, offset)
}

func getEmployee(ctx context.Context, id uint, branchID *uint) (*commonModels.Employee, error) {
	rec, err := FindEmployeeByID(ctx, id)
	if err != nil {
		return nil, NewNotFound("employee not found")
	}
	if branchID != nil && rec.BranchID != *branchID {
		return nil, NewNotFound("employee not found")
	}
	return rec, nil
}

func updateEmployee(ctx context.Context, id uint, in EmployeeUpdateInput, branchID *uint, actorEmployeeID uint) (*commonModels.Employee, error) {
	if in.Name == "" {
		return nil, NewBadRequest("name is required")
	}
	if in.Role == "" {
		return nil, NewBadRequest("role is required")
	}
	if in.BranchID == 0 {
		return nil, NewBadRequest("branch is required")
	}
	if err := validatePhone(in.Phone); err != nil {
		return nil, err
	}
	if err := checkEmployeeBranch(ctx, in.BranchID); err != nil {
		return nil, err
	}
	rec, err := FindEmployeeByID(ctx, id)
	if err != nil {
		return nil, NewNotFound("employee not found")
	}
	if branchID != nil && rec.BranchID != *branchID {
		return nil, NewNotFound("employee not found")
	}
	if err := checkEmployeePhoneUnique(ctx, in.Phone, rec.ID); err != nil {
		return nil, err
	}
	roleID, err := resolveRoleID(ctx, in.Role, in.ActorIsSystem)
	if err != nil {
		return nil, err
	}
	if rec.ID == actorEmployeeID && roleID != rec.RoleID {
		return nil, NewForbidden("You cannot change your own role")
	}
	beforeRole := rec.Role
	rec.Name = in.Name
	rec.Role = in.Role
	rec.RoleID = roleID
	rec.BranchID = in.BranchID
	rec.Phone = in.Phone
	rec.LoansProcessed = in.LoansProcessed
	rec.Collections = in.Collections
	rec.Followups = in.Followups
	rec.Pending = in.Pending
	if strings.TrimSpace(in.Username) != "" {
		username := strings.TrimSpace(in.Username)
		if !usernameRe.MatchString(username) {
			return nil, NewBadRequest("username must be at least 3 characters and contain only letters, numbers, dots, underscores or hyphens")
		}
		if err := checkUsernameUnique(ctx, username, rec.ID); err != nil {
			return nil, err
		}
		rec.Username = username
	}
	if strings.TrimSpace(in.Email) != "" {
		email := strings.ToLower(strings.TrimSpace(in.Email))
		if !emailRe.MatchString(email) {
			return nil, NewBadRequest("email is invalid")
		}
		existing, err := findByEmail(ctx, email)
		if err == nil && existing.ID != rec.ID {
			return nil, NewConflict("email is already in use by another employee")
		} else if err != nil && !errors.Is(err, gorm.ErrRecordNotFound) {
			return nil, err
		}
		rec.Email = email
	}
	if in.Password != "" {
		if len(in.Password) < 8 {
			return nil, NewBadRequest("password must be at least 8 characters")
		}
		hash, err := bcrypt.GenerateFromPassword([]byte(in.Password), bcrypt.DefaultCost+2)
		if err != nil {
			return nil, err
		}
		rec.PasswordHash = string(hash)
	}
	if err := persistEmployee(ctx, rec); err != nil {
		return nil, employeePhoneConflict(err)
	}
	detail := "role unchanged: " + rec.Role
	if beforeRole != rec.Role {
		detail = fmt.Sprintf("role: %s -> %s", beforeRole, rec.Role)
	}
	employeeLogAudit(ctx, actorEmployeeID, "employee_updated", rec.ID, rec.Name, detail)
	return FindEmployeeByID(ctx, rec.ID)
}

func deleteEmployee(ctx context.Context, id uint, branchID *uint, actorEmployeeID uint) error {
	rec, err := FindEmployeeByID(ctx, id)
	if err != nil {
		return NewNotFound("employee not found")
	}
	if branchID != nil && rec.BranchID != *branchID {
		return NewNotFound("employee not found")
	}
	if err := removeEmployee(ctx, id); err != nil {
		return err
	}
	employeeLogAudit(ctx, actorEmployeeID, "employee_deleted", rec.ID, rec.Name, "role="+rec.Role)
	return nil
}

func CreateEmployee(c echo.Context) error {
	ctx := auth.RequestContext(c)
	var req employeeCreateRequest
	if err := BindJSON(c, &req); err != nil {
		return c.JSON(http.StatusBadRequest, echo.Map{"success": false, "error": "Invalid input"})
	}
	branchID := auth.EnforceBranchOnWrite(c, req.BranchID)
	actorID, _, _ := auth.ActorFromContext(c)
	rec, err := SaveEmployee(ctx, EmployeeCreateInput{Name: req.Name, Role: req.Role, BranchID: branchID, Phone: req.Phone, Username: req.Username, Password: req.Password, ActorIsSystem: auth.IsSystemActor(c)}, actorID)
	if err != nil {
		return FailErr(c, err)
	}
	return Success(c, http.StatusOK, rec)
}

func ListEmployees(c echo.Context) error {
	ctx := auth.RequestContext(c)
	branchScope := auth.GetBranchScope(c)
	search := strings.TrimSpace(c.QueryParam("search"))
	page, limit, offset := PageParams(c)
	if limit > 0 {
		rec, total, err := listEmployees(ctx, branchScope, search, limit, offset)
		if err != nil {
			return FailErr(c, err)
		}
		return SuccessPage(c, page, limit, total, rec)
	}
	rec, _, err := listEmployees(ctx, branchScope, search, 0, 0)
	if err != nil {
		return FailErr(c, err)
	}
	return SuccessAll(c, rec)
}

func GetEmployeeById(c echo.Context) error {
	ctx := auth.RequestContext(c)
	id, err := IDParam(c, "id")
	if err != nil {
		return FailErr(c, err)
	}
	rec, err := getEmployee(ctx, id, auth.GetBranchScope(c))
	if err != nil {
		return FailErr(c, err)
	}
	return Success(c, http.StatusOK, rec)
}

func UpdateEmployee(c echo.Context) error {
	ctx := auth.RequestContext(c)
	id, err := IDParam(c, "id")
	if err != nil {
		return FailErr(c, err)
	}
	var req employeeUpdateRequest
	if err := BindJSON(c, &req); err != nil {
		return c.JSON(http.StatusBadRequest, echo.Map{"success": false, "error": "Invalid input"})
	}
	branchID := auth.EnforceBranchOnWrite(c, req.BranchID)
	actorID, _, _ := auth.ActorFromContext(c)
	rec, err := updateEmployee(ctx, id, EmployeeUpdateInput{
		Name: req.Name, Role: req.Role, BranchID: branchID, Phone: req.Phone,
		LoansProcessed: req.LoansProcessed, Collections: req.Collections,
		Followups: req.Followups, Pending: req.Pending,
		Username: req.Username, Email: req.Email, Password: req.Password,
		ActorIsSystem: auth.IsSystemActor(c),
	}, auth.GetBranchScope(c), actorID)
	if err != nil {
		return FailErr(c, err)
	}
	return Success(c, http.StatusOK, rec)
}

func DeleteEmployee(c echo.Context) error {
	ctx := auth.RequestContext(c)
	id, err := IDParam(c, "id")
	if err != nil {
		return FailErr(c, err)
	}
	actorID, _, _ := auth.ActorFromContext(c)
	if err := deleteEmployee(ctx, id, auth.GetBranchScope(c), actorID); err != nil {
		return FailErr(c, err)
	}
	return SuccessMessage(c, http.StatusOK, "Employee deleted successfully")
}
