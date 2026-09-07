package authz

import (
	"errors"
	"net/http"
	"strconv"

	"github.com/gin-gonic/gin"
	"gorm.io/gorm"

	"ambikagold/backend/internal/platform"
	"ambikagold/backend/internal/platform/httpx"
)

// ErrRoleNotFound is a user-safe 404, distinct from ErrSystemRole/ErrRoleInUse.
var ErrRoleNotFound = httpx.NewNotFound("role not found")

// Handler implements the standard's 3-endpoint permissions API (§7) plus
// plain role CRUD for the admin screen.
type Handler struct {
	repo *Repository
}

func NewHandler(repo *Repository) *Handler {
	return &Handler{repo: repo}
}

// actingIdentity reads the caller's own employeeId/roleId from the JWT
// claims AuthMiddleware set on the context — never trusted from the path or
// body (see platform.ActorFromContext's doc comment for why).
func actingIdentity(c *gin.Context) (employeeID uint, roleID uint, ok bool) {
	empVal, has1 := c.Get("employeeId")
	roleVal, has2 := c.Get("roleId")
	if !has1 || !has2 {
		return 0, 0, false
	}
	employeeID, ok1 := empVal.(uint)
	roleID, ok2 := roleVal.(uint)
	return employeeID, roleID, ok1 && ok2
}

// ByEmployee is GET /employees/:id/permissions/by-employee — the
// bootstrap endpoint every signed-in user calls to load their own
// permissions (§7.1). Gated auth-only: it would be a deadlock to require a
// permission to load permissions. The path's :id must match the
// caller's own id (mirrors the standard's §6.2 step 3) — this endpoint never
// returns another employee's grants.
func (h *Handler) ByEmployee(c *gin.Context) {
	ctx := platform.RequestContext(c)
	employeeID, roleID, ok := actingIdentity(c)
	if !ok {
		httpx.Fail(c, http.StatusUnauthorized, "not authenticated")
		return
	}
	pathID, err := httpx.IDParam(c, "id")
	if err != nil {
		httpx.FailErr(c, err)
		return
	}
	if pathID != employeeID {
		httpx.Fail(c, http.StatusUnauthorized, "Invalid user")
		return
	}
	data, err := h.repo.BootstrapPermissions(ctx, roleID)
	if err != nil {
		httpx.FailErr(c, err)
		return
	}
	httpx.Success(c, http.StatusOK, data)
}

// Matrix is GET /employees/:id/permissions?role_id=&search= — the
// admin matrix (§7.2), gated "can view role and permission".
func (h *Handler) Matrix(c *gin.Context) {
	ctx := platform.RequestContext(c)
	roleID64, err := strconv.ParseUint(c.Query("role_id"), 10, 64)
	if err != nil {
		httpx.Fail(c, http.StatusBadRequest, "role_id query parameter is required")
		return
	}
	roleID := uint(roleID64)
	role, err := h.repo.GetRole(ctx, roleID)
	if err != nil {
		httpx.FailErr(c, ErrRoleNotFound)
		return
	}
	data, err := h.repo.AdminMatrix(ctx, roleID, c.Query("search"))
	if err != nil {
		httpx.FailErr(c, err)
		return
	}
	c.JSON(http.StatusOK, gin.H{
		"success": true,
		"role":    role,
		"data":    data,
	})
}

// UpdatePermissions is PATCH /employees/:id/permissions/:role_id —
// applies a bare array of {permission_id, permission} in one transaction
// (§7.3), gated "can update role".
func (h *Handler) UpdatePermissions(c *gin.Context) {
	ctx := platform.RequestContext(c)
	roleID, err := httpx.IDParam(c, "role_id")
	if err != nil {
		httpx.FailErr(c, err)
		return
	}
	role, err := h.repo.GetRole(ctx, roleID)
	if err != nil {
		httpx.FailErr(c, ErrRoleNotFound)
		return
	}
	if role.IsSystem {
		httpx.Fail(c, http.StatusForbidden, "System roles cannot be modified")
		return
	}
	var updates []RolePermissionUpdate
	if err := c.ShouldBindJSON(&updates); err != nil || len(updates) == 0 {
		httpx.Fail(c, http.StatusBadRequest, "Provide an array of {permission_id, permission}")
		return
	}
	if err := h.repo.UpdateRolePermissions(ctx, roleID, updates); err != nil {
		if IsPermissionNotFoundInCatalogue(err) {
			httpx.Fail(c, http.StatusBadRequest, "permission not found")
			return
		}
		httpx.FailErr(c, err)
		return
	}
	httpx.SuccessMessage(c, http.StatusOK, "Permissions updated successfully")
}

// SetAll is PATCH /employees/:id/permissions/:role_id/set-all?permission=true|false
// (§7.3), gated "can update role".
func (h *Handler) SetAll(c *gin.Context) {
	ctx := platform.RequestContext(c)
	roleID, err := httpx.IDParam(c, "role_id")
	if err != nil {
		httpx.FailErr(c, err)
		return
	}
	role, err := h.repo.GetRole(ctx, roleID)
	if err != nil {
		httpx.FailErr(c, ErrRoleNotFound)
		return
	}
	if role.IsSystem {
		httpx.Fail(c, http.StatusForbidden, "System roles cannot be modified")
		return
	}
	allowed := c.Query("permission") == "true"
	if err := h.repo.SetAllForRole(ctx, roleID, allowed); err != nil {
		httpx.FailErr(c, err)
		return
	}
	httpx.SuccessMessage(c, http.StatusOK, "Permissions updated successfully")
}

// --- role CRUD --------------------------------------------------------

type roleRequest struct {
	Name        string `json:"name" binding:"required"`
	Description string `json:"description"`
	IsActive    *bool  `json:"isActive"`
}

func (h *Handler) ListRoles(c *gin.Context) {
	ctx := platform.RequestContext(c)
	roles, err := h.repo.ListRoles(ctx)
	if err != nil {
		httpx.FailErr(c, err)
		return
	}
	httpx.Success(c, http.StatusOK, roles)
}

func (h *Handler) CreateRole(c *gin.Context) {
	ctx := platform.RequestContext(c)
	var req roleRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		httpx.Fail(c, http.StatusBadRequest, "Invalid input")
		return
	}
	role, err := h.repo.CreateRole(ctx, req.Name, req.Description)
	if err != nil {
		httpx.FailErr(c, err)
		return
	}
	httpx.Success(c, http.StatusCreated, role)
}

func (h *Handler) UpdateRole(c *gin.Context) {
	ctx := platform.RequestContext(c)
	id, err := httpx.IDParam(c, "id")
	if err != nil {
		httpx.FailErr(c, err)
		return
	}
	var req roleRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		httpx.Fail(c, http.StatusBadRequest, "Invalid input")
		return
	}
	isActive := true
	if req.IsActive != nil {
		isActive = *req.IsActive
	}
	role, err := h.repo.UpdateRole(ctx, id, req.Name, req.Description, isActive)
	if err != nil {
		if errors.Is(err, ErrSystemRole) {
			httpx.Fail(c, http.StatusForbidden, "System roles cannot be modified")
			return
		}
		if errors.Is(err, gorm.ErrRecordNotFound) {
			httpx.FailErr(c, ErrRoleNotFound)
			return
		}
		httpx.FailErr(c, err)
		return
	}
	httpx.Success(c, http.StatusOK, role)
}

func (h *Handler) DeleteRole(c *gin.Context) {
	ctx := platform.RequestContext(c)
	id, err := httpx.IDParam(c, "id")
	if err != nil {
		httpx.FailErr(c, err)
		return
	}
	if err := h.repo.DeleteRole(ctx, id); err != nil {
		switch {
		case errors.Is(err, ErrSystemRole):
			httpx.Fail(c, http.StatusForbidden, "System roles cannot be modified")
		case errors.Is(err, ErrRoleInUse):
			httpx.Fail(c, http.StatusBadRequest, "Cannot delete: this role is still assigned to one or more employees")
		case errors.Is(err, gorm.ErrRecordNotFound):
			httpx.FailErr(c, ErrRoleNotFound)
		default:
			httpx.FailErr(c, err)
		}
		return
	}
	httpx.SuccessMessage(c, http.StatusOK, "Role deleted successfully")
}
