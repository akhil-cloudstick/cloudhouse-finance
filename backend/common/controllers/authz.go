package controllers

import (
	"cloudhouse/backend/auth"
	commonModels "cloudhouse/backend/common/models"
	"cloudhouse/backend/config"
	"context"
	"errors"
	"fmt"
	"log"
	"net/http"
	"strconv"
	"strings"

	"github.com/labstack/echo/v4"
	"gorm.io/gorm"
	"gorm.io/gorm/logger"
)

var errPermissionNotFoundInCatalogue = errors.New("permission not found")

var ErrSystemRole = errors.New("system roles cannot be modified")

type RoleInUseError struct {
	Total int64
	Names []string
}

type RoleUsageChecker func(ctx context.Context, roleID uint) (string, bool, error)

type roleRequest struct {
	Name        string `json:"name"`
	Description string `json:"description"`
	IsActive    *bool  `json:"is_active"`
}

type RolePermissionRow struct {
	ID           uint                    `json:"id"`
	RoleID       uint                    `json:"role_id"`
	PermissionID uint                    `json:"permission_id"`
	Permission   bool                    `json:"permission"`
	Permissions  commonModels.Permission `json:"permissions"`
	Parents      []PermissionRef         `json:"parents"`
	SoftParents  []PermissionRef         `json:"soft_parents"`
	Dependents   []PermissionRef         `json:"dependents"`
}

type PermissionRef struct {
	PermissionID uint   `json:"permission_id"`
	Name         string `json:"name"`
	Label        string `json:"label"`
	Granted      bool   `json:"granted"`
}

type ParentDisabledError struct {
	Parent string
	Child  string
}

type RolePermissionUpdate struct {
	PermissionID uint `json:"permission_id"`
	Permission   bool `json:"permission"`
}

func ProvisionRoles(ctx context.Context, names []string) error {
	quietDB := config.DB.
		WithContext(ctx).Session(&gorm.Session{Logger: config.DB.
		WithContext(ctx).Logger.LogMode(logger.Silent)})
	for _, name := range names {
		var existing commonModels.Role
		err := quietDB.Where("name = ?", name).First(&existing).Error
		if err == nil {
			continue
		}
		if !errors.Is(err, gorm.ErrRecordNotFound) {
			return err
		}
		role := commonModels.Role{Name: name, IsActive: true, IsSystem: name == "Administrator"}
		if err := config.DB.
			WithContext(ctx).Create(&role).Error; err != nil {
			return err
		}
		log.Printf("authz: seeded role %q (isSystem=%v)", name, role.IsSystem)
	}
	return nil
}

func ApplyRestrictions(ctx context.Context, restrictions []RoleRestriction) error {
	var roles []commonModels.Role
	if err := config.DB.
		WithContext(ctx).Find(&roles).Error; err != nil {
		return err
	}
	for _, restriction := range restrictions {
		var perm commonModels.Permission
		if err := config.DB.
			WithContext(ctx).Where("name = ?", restriction.PermissionName).First(&perm).Error; err != nil {
			return err
		}
		allowed := make(map[string]bool, len(restriction.AllowedRoles))
		for _, name := range restriction.AllowedRoles {
			allowed[name] = true
		}
		for _, role := range roles {
			if err := upsertGrant(ctx, role, perm.ID, allowed[role.Name]); err != nil {
				return err
			}
		}
	}
	return nil
}

func upsertGrant(ctx context.Context, role commonModels.Role, permissionID uint, allowed bool) error {
	var existing commonModels.RolePermission
	err := config.DB.
		WithContext(ctx).Where("role_id = ? AND permission_id = ?", role.ID, permissionID).First(&existing).Error
	if err == nil {
		if existing.Permission == allowed {
			return nil
		}
		existing.Permission = allowed
		return config.DB.
			WithContext(ctx).Save(&existing).Error
	}
	if !errors.Is(err, gorm.ErrRecordNotFound) {
		return err
	}
	return createGrant(config.DB.
		WithContext(ctx), role, permissionID, allowed)
}

func createGrant(db *gorm.DB, role commonModels.Role, permissionID uint, allowed bool) error {
	rp := commonModels.RolePermission{RoleID: role.ID, PermissionID: permissionID, Permission: allowed}
	rp.TenantID = role.TenantID
	if err := db.Create(&rp).Error; err != nil {
		return err
	}
	if allowed {
		return nil
	}
	return db.Model(&commonModels.RolePermission{}).Where("id = ?", rp.ID).Update("permission", false).Error
}

func IsAllowed(ctx context.Context, roleID uint, permissionName string) (bool, error) {
	var row struct {
		Permission bool
	}
	err := config.DB.
		WithContext(ctx).Table("role_permissions AS rp").
		Select("rp.permission").
		Joins("JOIN permissions p ON p.id = rp.permission_id AND p.is_active").
		Where("rp.role_id = ? AND p.name = ?", roleID, permissionName).
		Take(&row).Error
	if err != nil {
		if errors.Is(err, gorm.ErrRecordNotFound) {
			return false, auth.ErrPermissionNotFound
		}
		return false, err
	}
	return row.Permission, nil
}

func RoleIDByName(ctx context.Context, name string) (uint, error) {
	var role commonModels.Role
	if err := config.DB.
		WithContext(ctx).Where("name = ?", name).First(&role).Error; err != nil {
		return 0, err
	}
	return role.ID, nil
}

func bootstrapPermissions(ctx context.Context, roleID uint) (map[string]map[string]bool, error) {
	var rows []struct {
		ModuleName     string
		PermissionName string
		Permission     bool
	}
	if err := config.DB.
		WithContext(ctx).Table("role_permissions AS rp").
		Select("p.module_name, p.name AS permission_name, rp.permission").
		Joins("JOIN permissions p ON p.id = rp.permission_id").
		Where("rp.role_id = ? AND p.is_active = true", roleID).
		Scan(&rows).Error; err != nil {
		return nil, err
	}
	out := make(map[string]map[string]bool)
	for _, row := range rows {
		moduleKey := underscored(row.ModuleName)
		permKey := underscored(row.PermissionName)
		if out[moduleKey] == nil {
			out[moduleKey] = make(map[string]bool)
		}
		out[moduleKey][permKey] = row.Permission
	}
	return out, nil
}

func underscored(s string) string {
	return strings.ReplaceAll(s, " ", "_")
}

func (e *RoleInUseError) Error() string {
	return fmt.Sprintf("Cannot delete: this role is assigned to %d employee(s): %s", e.Total, strings.Join(e.Names, ", "))
}

func (e *ParentDisabledError) Error() string {
	return fmt.Sprintf("%s is disabled, cannot enable %s", PermissionLabel(e.Parent), strings.TrimPrefix(e.Child, "can "))
}

func roleGrantState(db *gorm.DB, roleID uint) (perms []commonModels.Permission, granted map[string]bool, err error) {
	if err := db.Order("id asc").Find(&perms).Error; err != nil {
		return nil, nil, err
	}
	var rows []commonModels.RolePermission
	if err := db.Where("role_id = ?", roleID).Find(&rows).Error; err != nil {
		return nil, nil, err
	}
	nameByID := make(map[uint]string, len(perms))
	for _, p := range perms {
		nameByID[p.ID] = p.Name
	}
	granted = make(map[string]bool, len(rows))
	for _, rp := range rows {
		granted[nameByID[rp.PermissionID]] = rp.Permission
	}
	return perms, granted, nil
}

func permissionRefs(names []string, idByName map[string]uint, granted map[string]bool) []PermissionRef {
	refs := make([]PermissionRef, 0, len(names))
	for _, n := range names {
		id, ok := idByName[n]
		if !ok {
			continue
		}
		refs = append(refs, PermissionRef{PermissionID: id, Name: n, Label: PermissionLabel(n), Granted: granted[n]})
	}
	return refs
}

func adminMatrix(ctx context.Context, roleID uint, search string) (map[string][]RolePermissionRow, error) {
	allPerms, granted, err := roleGrantState(config.DB.
		WithContext(ctx), roleID)
	if err != nil {
		return nil, err
	}
	idByName := make(map[string]uint, len(allPerms))
	for _, p := range allPerms {
		idByName[p.Name] = p.ID
	}
	q := config.DB.
		WithContext(ctx).Table("role_permissions AS rp").
		Select("rp.id, rp.role_id, rp.permission_id, rp.permission, p.id AS p_id, p.name AS p_name, p.description AS p_description, p.module_name AS p_module_name, p.is_active AS p_is_active").
		Joins("JOIN permissions p ON p.id = rp.permission_id").
		Where("rp.role_id = ?", roleID)
	if strings.TrimSpace(search) != "" {
		q = q.Where("p.name ILIKE ?", "%"+strings.TrimSpace(search)+"%")
	}
	var rows []struct {
		ID           uint
		RoleID       uint
		PermissionID uint
		Permission   bool
		PID          uint   `gorm:"column:p_id"`
		PName        string `gorm:"column:p_name"`
		PDescription string `gorm:"column:p_description"`
		PModuleName  string `gorm:"column:p_module_name"`
		PIsActive    bool   `gorm:"column:p_is_active"`
	}
	if err := q.Order("p.id asc").Scan(&rows).Error; err != nil {
		return nil, err
	}
	out := make(map[string][]RolePermissionRow)
	for _, row := range rows {
		out[row.PModuleName] = append(out[row.PModuleName], RolePermissionRow{
			ID: row.ID, RoleID: row.RoleID, PermissionID: row.PermissionID, Permission: row.Permission,
			Permissions: commonModels.Permission{ID: row.PID, Name: row.PName, Description: row.PDescription, ModuleName: row.PModuleName, IsActive: row.PIsActive},
			Parents:     permissionRefs(Parents(row.PName), idByName, granted),
			SoftParents: permissionRefs(SoftParents(row.PName), idByName, granted),
			Dependents:  permissionRefs(Dependents(row.PName), idByName, granted),
		})
	}
	return out, nil
}

func updateRolePermissions(ctx context.Context, roleID uint, updates []RolePermissionUpdate) (changed int, err error) {
	return changed, config.DB.
		WithContext(ctx).Transaction(func(tx *gorm.DB) error {
		var role commonModels.Role
		if err := tx.First(&role, roleID).Error; err != nil {
			return err
		}
		perms, before, err := roleGrantState(tx, roleID)
		if err != nil {
			return err
		}
		nameByID := make(map[uint]string, len(perms))
		idByName := make(map[string]uint, len(perms))
		for _, p := range perms {
			nameByID[p.ID] = p.Name
			idByName[p.Name] = p.ID
		}
		after := make(map[string]bool, len(before))
		for n, v := range before {
			after[n] = v
		}
		for _, u := range updates {
			name, ok := nameByID[u.PermissionID]
			if !ok {
				return errPermissionNotFoundInCatalogue
			}
			after[name] = u.Permission
		}
		for _, u := range updates {
			if u.Permission {
				continue
			}
			for _, d := range Dependents(nameByID[u.PermissionID]) {
				after[d] = false
			}
		}
		for _, p := range perms {
			if !after[p.Name] {
				continue
			}
			for _, parent := range Parents(p.Name) {
				if !after[parent] {
					return &ParentDisabledError{Parent: parent, Child: p.Name}
				}
			}
		}
		touched := map[string]bool{}
		for _, u := range updates {
			touched[nameByID[u.PermissionID]] = true
		}
		for _, p := range perms {
			if after[p.Name] == before[p.Name] && !touched[p.Name] {
				continue
			}
			var existing commonModels.RolePermission
			err := tx.Where("role_id = ? AND permission_id = ?", roleID, p.ID).First(&existing).Error
			if err == nil {
				if existing.Permission == after[p.Name] {
					continue
				}
				if err := tx.Model(&commonModels.RolePermission{}).Where("id = ?", existing.ID).Update("permission", after[p.Name]).Error; err != nil {
					return err
				}
				changed++
				continue
			}
			if !errors.Is(err, gorm.ErrRecordNotFound) {
				return err
			}
			if err := createGrant(tx, role, p.ID, after[p.Name]); err != nil {
				return err
			}
			changed++
		}
		return nil
	})
}

func IsParentDisabled(err error) (string, bool) {
	var pe *ParentDisabledError
	if errors.As(err, &pe) {
		return pe.Error(), true
	}
	return "", false
}

func IsPermissionNotFoundInCatalogue(err error) bool {
	return errors.Is(err, errPermissionNotFoundInCatalogue)
}

func setAllForRole(ctx context.Context, roleID uint, allowed bool) (n int, err error) {
	return n, config.DB.
		WithContext(ctx).Transaction(func(tx *gorm.DB) error {
		n, err = SetEveryGrant(config.WithConn(ctx, tx), roleID, allowed)
		return err
	})
}

func FindRoles(ctx context.Context) ([]commonModels.Role, error) {
	var roles []commonModels.Role
	err := config.DB.
		WithContext(ctx).Order("name asc").Find(&roles).Error
	return roles, err
}

func getRole(ctx context.Context, id uint) (*commonModels.Role, error) {
	var role commonModels.Role
	if err := config.DB.
		WithContext(ctx).First(&role, id).Error; err != nil {
		return nil, err
	}
	return &role, nil
}

func InsertRole(ctx context.Context, name, description string) (*commonModels.Role, error) {
	role := &commonModels.Role{Name: name, Description: description, IsActive: true}
	err := config.DB.
		WithContext(ctx).Transaction(func(tx *gorm.DB) error {
		if err := tx.Create(role).Error; err != nil {
			return err
		}
		var perms []commonModels.Permission
		if err := tx.Find(&perms).Error; err != nil {
			return err
		}
		rows := make([]commonModels.RolePermission, 0, len(perms))
		for _, p := range perms {
			rp := commonModels.RolePermission{RoleID: role.ID, PermissionID: p.ID, Permission: true}
			rp.TenantID = role.TenantID
			rows = append(rows, rp)
		}
		if len(rows) > 0 {
			if err := tx.Create(&rows).Error; err != nil {
				return err
			}
		}
		return nil
	})
	if err != nil {
		return nil, err
	}
	return role, nil
}

func updateRole(ctx context.Context, id uint, name, description string, isActive *bool) (*commonModels.Role, error) {
	role, err := getRole(ctx, id)
	if err != nil {
		return nil, err
	}
	if role.IsSystem {
		return nil, ErrSystemRole
	}
	role.Name = name
	role.Description = description
	if isActive != nil {
		role.IsActive = *isActive
	}
	if err := config.DB.
		WithContext(ctx).Save(role).Error; err != nil {
		return nil, err
	}
	return role, nil
}

func deleteRole(ctx context.Context, id uint) error {
	role, err := getRole(ctx, id)
	if err != nil {
		return err
	}
	if role.IsSystem {
		return ErrSystemRole
	}
	inUse, err := employeesWithRole(ctx, id)
	if err != nil {
		return err
	}
	if inUse.Total > 0 {
		return inUse
	}
	return config.DB.
		WithContext(ctx).Transaction(func(tx *gorm.DB) error {
		if err := tx.Where("role_id = ?", id).Delete(&commonModels.RolePermission{}).Error; err != nil {
			return err
		}
		return tx.Delete(&commonModels.Role{}, id).Error
	})
}

func employeesWithRole(ctx context.Context, roleID uint) (*RoleInUseError, error) {
	inUse := &RoleInUseError{}
	q := config.DB.
		WithContext(ctx).Table("employees").Where("role_id = ? AND deleted_at IS NULL", roleID)
	if err := q.Session(&gorm.Session{}).Count(&inUse.Total).Error; err != nil {
		return nil, err
	}
	if inUse.Total == 0 {
		return inUse, nil
	}
	err := q.Order("name asc").Limit(5).Pluck("name", &inUse.Names).Error
	return inUse, err
}

func roleLogAudit(ctx context.Context, actorEmployeeID uint, role *commonModels.Role, detail string) {
	if actorEmployeeID == 0 {
		return
	}
	actorName := "unknown"
	if actor, err := FindEmployeeByID(ctx, actorEmployeeID); err == nil {
		actorName = actor.Name
	}
	writeAuditLog(ctx, actorEmployeeID, actorName, "permissions_updated", "role", role.ID, role.Name, detail)
}

func GrantAllToRole(ctx context.Context, roleID uint) (int, error) {
	return SetEveryGrant(ctx, roleID, true)
}

func SetEveryGrant(ctx context.Context, roleID uint, allowed bool) (int, error) {
	role, err := getRole(ctx, roleID)
	if err != nil {
		return 0, err
	}
	var perms []commonModels.Permission
	if err := config.DB.
		WithContext(ctx).Find(&perms).Error; err != nil {
		return 0, err
	}
	n := 0
	for _, p := range perms {
		if err := upsertGrant(ctx, *role, p.ID, allowed); err != nil {
			return n, err
		}
		n++
	}
	return n, nil
}

func actingIdentity(c echo.Context) (employeeID uint, roleID uint, ok bool) {
	empVal, has1 := Get(c, "employeeId")
	roleVal, has2 := Get(c, "roleId")
	if !has1 || !has2 {
		return 0, 0, false
	}
	employeeID, ok1 := empVal.(uint)
	roleID, ok2 := roleVal.(uint)
	return employeeID, roleID, ok1 && ok2
}

func GetPermissionsByEmployee(c echo.Context) error {
	ctx := auth.RequestContext(c)
	employeeID, roleID, ok := actingIdentity(c)
	if !ok {
		return c.JSON(http.StatusUnauthorized, echo.Map{"success": false, "error": "not authenticated"})
	}
	pathID, err := IDParam(c, "id")
	if err != nil {
		return FailErr(c, err)
	}
	if pathID != employeeID {
		return c.JSON(http.StatusUnauthorized, echo.Map{"success": false, "error": "Invalid user"})
	}
	data, err := bootstrapPermissions(ctx, roleID)
	if err != nil {
		return FailErr(c, err)
	}
	return Success(c, http.StatusOK, data)
}

func GetPermissionMatrix(c echo.Context) error {
	ctx := auth.RequestContext(c)
	roleID64, err := strconv.ParseUint(c.QueryParam("role_id"), 10, 64)
	if err != nil {
		return c.JSON(http.StatusBadRequest, echo.Map{"success": false, "error": "role_id query parameter is required"})
	}
	roleID := uint(roleID64)
	role, err := getRole(ctx, roleID)
	if err != nil {
		return FailErr(c, NewNotFound("role not found"))
	}
	data, err := adminMatrix(ctx, roleID, c.QueryParam("search"))
	if err != nil {
		return FailErr(c, err)
	}
	return c.JSON(http.StatusOK, echo.Map{
		"success": true,
		"role":    role,
		"data":    data,
	})
}

func UpdatePermissions(c echo.Context) error {
	ctx := auth.RequestContext(c)
	roleID, err := IDParam(c, "role_id")
	if err != nil {
		return FailErr(c, err)
	}
	actorID, _, actorRoleID := auth.ActorFromContext(c)
	if roleID == actorRoleID {
		return c.JSON(http.StatusForbidden, echo.Map{"success": false, "error": "You cannot change your own role's permissions"})
	}
	role, err := getRole(ctx, roleID)
	if err != nil {
		return FailErr(c, NewNotFound("role not found"))
	}
	if role.IsSystem {
		return c.JSON(http.StatusForbidden, echo.Map{"success": false, "error": "System roles cannot be modified"})
	}
	var updates []RolePermissionUpdate
	if err := BindJSON(c, &updates); err != nil || len(updates) == 0 {
		return c.JSON(http.StatusBadRequest, echo.Map{"success": false, "error": "Provide an array of {permission_id, permission}"})
	}
	changed, err := updateRolePermissions(ctx, roleID, updates)
	if err != nil {
		if IsPermissionNotFoundInCatalogue(err) {
			return c.JSON(http.StatusBadRequest, echo.Map{"success": false, "error": "permission not found"})
		}
		if msg, ok := IsParentDisabled(err); ok {
			return c.JSON(http.StatusConflict, echo.Map{"success": false, "error": msg})
		}
		return FailErr(c, err)
	}
	roleLogAudit(ctx, actorID, role, fmt.Sprintf("Permissions updated for role '%s': %d changes", role.Name, changed))
	return SuccessMessage(c, http.StatusOK, "Permissions updated successfully")
}

func SetAllPermissions(c echo.Context) error {
	ctx := auth.RequestContext(c)
	roleID, err := IDParam(c, "role_id")
	if err != nil {
		return FailErr(c, err)
	}
	actorID, _, actorRoleID := auth.ActorFromContext(c)
	if roleID == actorRoleID {
		return c.JSON(http.StatusForbidden, echo.Map{"success": false, "error": "You cannot change your own role's permissions"})
	}
	role, err := getRole(ctx, roleID)
	if err != nil {
		return FailErr(c, NewNotFound("role not found"))
	}
	if role.IsSystem {
		return c.JSON(http.StatusForbidden, echo.Map{"success": false, "error": "System roles cannot be modified"})
	}
	allowed := c.QueryParam("permission") == "true"
	n, err := setAllForRole(ctx, roleID, allowed)
	if err != nil {
		return FailErr(c, err)
	}
	roleLogAudit(ctx, actorID, role, fmt.Sprintf("Permissions updated for role '%s': all %d set to %t", role.Name, n, allowed))
	return SuccessMessage(c, http.StatusOK, "Permissions updated successfully")
}

func ListRoles(c echo.Context) error {
	ctx := auth.RequestContext(c)
	roles, err := FindRoles(ctx)
	if err != nil {
		return FailErr(c, err)
	}
	return Success(c, http.StatusOK, roles)
}

func CreateRole(c echo.Context) error {
	ctx := auth.RequestContext(c)
	var req roleRequest
	if err := BindJSON(c, &req); err != nil {
		return c.JSON(http.StatusBadRequest, echo.Map{"success": false, "error": "Invalid input"})
	}
	name := strings.TrimSpace(req.Name)
	if name == "" {
		return c.JSON(http.StatusBadRequest, echo.Map{"success": false, "error": "name is required"})
	}
	role, err := InsertRole(ctx, name, req.Description)
	if err != nil {
		return FailErr(c, err)
	}
	return Success(c, http.StatusOK, role)
}

func UpdateRole(c echo.Context) error {
	ctx := auth.RequestContext(c)
	id, err := IDParam(c, "id")
	if err != nil {
		return FailErr(c, err)
	}
	var req roleRequest
	if err := BindJSON(c, &req); err != nil {
		return c.JSON(http.StatusBadRequest, echo.Map{"success": false, "error": "Invalid input"})
	}
	name := strings.TrimSpace(req.Name)
	if name == "" {
		return c.JSON(http.StatusBadRequest, echo.Map{"success": false, "error": "name is required"})
	}
	role, err := updateRole(ctx, id, name, req.Description, req.IsActive)
	if err != nil {
		if errors.Is(err, ErrSystemRole) {
			return c.JSON(http.StatusForbidden, echo.Map{"success": false, "error": "System roles cannot be modified"})
		}
		if errors.Is(err, gorm.ErrRecordNotFound) {
			return FailErr(c, NewNotFound("role not found"))
		}
		return FailErr(c, err)
	}
	return Success(c, http.StatusOK, role)
}

func DeleteRole(c echo.Context) error {
	ctx := auth.RequestContext(c)
	id, err := IDParam(c, "id")
	if err != nil {
		return FailErr(c, err)
	}
	{
		flow, used, err := RoleInUse(ctx, id)
		if err != nil {
			return FailErr(c, err)
		}
		if used {
			return c.JSON(http.StatusBadRequest, echo.Map{"success": false, "error": fmt.Sprintf("Cannot delete: this role is an approver in the %s approval workflow — remove it there first", flow)})
		}
	}
	if err := deleteRole(ctx, id); err != nil {
		var inUse *RoleInUseError
		switch {
		case errors.Is(err, ErrSystemRole):
			c.JSON(http.StatusForbidden, echo.Map{"success": false, "error": "System roles cannot be modified"})
		case errors.As(err, &inUse):
			c.JSON(http.StatusBadRequest, echo.Map{"success": false, "error": inUse.Error()})
		case errors.Is(err, gorm.ErrRecordNotFound):
			FailErr(c, NewNotFound("role not found"))
		default:
			FailErr(c, err)
		}
		return nil
	}
	return SuccessMessage(c, http.StatusOK, "Role deleted successfully")
}
