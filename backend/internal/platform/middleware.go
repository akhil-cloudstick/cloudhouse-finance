package platform

import (
	"errors"
	"net/http"
	"strings"

	"github.com/gin-gonic/gin"

	"ambikagold/backend/internal/platform/httpx"
)

// ErrPermissionNotFound is returned by PermissionChecker.IsAllowed when the
// requested permission name has no role_permissions row for the role at
// all — distinct from an explicit deny (a real row with Permission=false).
// Almost always means a typo in a route's permission string, or a missing
// seed/back-fill, rather than an intentional restriction.
var ErrPermissionNotFound = errors.New("permission not found")

// PermissionChecker is the minimal surface RequirePermission needs from
// internal/authz.Repository, kept as a narrow interface here so platform
// doesn't import the authz package (avoiding a low-level package depending
// on a higher-level domain package).
type PermissionChecker interface {
	IsAllowed(roleID uint, permissionName string) (bool, error)
}

// AuthMiddleware is "checkpoint 1": every request to a protected route must
// carry a valid `Authorization: Bearer <token>` header. On success it sets
// employeeId (uint), role (string, display-only — see Claims' doc comment),
// roleId (uint, the authorization key), and branchId (uint) on the
// gin.Context for downstream handlers/middleware (e.g. RequirePermission,
// auth.Me) to read. Missing/malformed/invalid/expired tokens get a 401 and
// the request is aborted before reaching any route handler.
func AuthMiddleware(secret string) gin.HandlerFunc {
	return func(c *gin.Context) {
		header := c.GetHeader("Authorization")
		if header == "" {
			httpx.FailAbort(c, http.StatusUnauthorized, "missing Authorization header")
			return
		}
		parts := strings.SplitN(header, " ", 2)
		if len(parts) != 2 || !strings.EqualFold(parts[0], "Bearer") || parts[1] == "" {
			httpx.FailAbort(c, http.StatusUnauthorized, "malformed Authorization header")
			return
		}

		claims, err := ParseToken(parts[1], secret)
		if err != nil {
			httpx.FailAbort(c, http.StatusUnauthorized, "invalid or expired token")
			return
		}

		c.Set("employeeId", claims.EmployeeID)
		c.Set("role", claims.Role)
		c.Set("roleId", claims.RoleID)
		c.Set("branchId", claims.BranchID)
		c.Next()
	}
}

// CustomerAuthMiddleware is the customer-app equivalent of AuthMiddleware:
// every request to a protected /api/v1/customer/* route must carry a valid
// `Authorization: Bearer <token>` customer JWT (see IssueCustomerToken/
// ParseCustomerToken). On success it sets customerId (uint) on the
// gin.Context. Deliberately a separate middleware from AuthMiddleware (not
// a shared one branching on claim shape) so a customer token can never be
// accepted on a staff route and vice versa — ParseCustomerToken itself
// enforces the "type":"customer" claim.
func CustomerAuthMiddleware(secret string) gin.HandlerFunc {
	return func(c *gin.Context) {
		header := c.GetHeader("Authorization")
		if header == "" {
			httpx.FailAbort(c, http.StatusUnauthorized, "missing Authorization header")
			return
		}
		parts := strings.SplitN(header, " ", 2)
		if len(parts) != 2 || !strings.EqualFold(parts[0], "Bearer") || parts[1] == "" {
			httpx.FailAbort(c, http.StatusUnauthorized, "malformed Authorization header")
			return
		}

		claims, err := ParseCustomerToken(parts[1], secret)
		if err != nil {
			httpx.FailAbort(c, http.StatusUnauthorized, "invalid or expired token")
			return
		}

		c.Set("customerId", claims.CustomerID)
		c.Next()
	}
}

// RequirePermission is "checkpoint 2": given the permission name this route
// verb requires, it resolves (roleId, permissionName) against the
// permissions table (via checker) and 403s if the role isn't allowed (or
// the permission doesn't exist, or the lookup itself fails) — otherwise
// continues. Must run after AuthMiddleware, which is what sets "roleId" on
// the context.
func RequirePermission(checker PermissionChecker, permissionName string) gin.HandlerFunc {
	return func(c *gin.Context) {
		roleIDVal, ok := c.Get("roleId")
		if !ok {
			httpx.FailAbort(c, http.StatusUnauthorized, "not authenticated")
			return
		}
		roleID, ok := roleIDVal.(uint)
		if !ok {
			httpx.FailAbort(c, http.StatusUnauthorized, "not authenticated")
			return
		}

		allowed, err := checker.IsAllowed(roleID, permissionName)
		if err != nil {
			if errors.Is(err, ErrPermissionNotFound) {
				httpx.FailAbort(c, http.StatusForbidden, "Permission not found")
				return
			}
			httpx.FailAbort(c, http.StatusBadRequest, "permission check failed")
			return
		}
		if !allowed {
			httpx.FailAbort(c, http.StatusForbidden, "Access denied")
			return
		}
		c.Next()
	}
}

// CRUDMiddlewares bundles the four permission gates a resource's routes.go
// attaches per verb: Read (GET) uses View, Create/Update/Delete each use
// their own distinct "can create/update/delete <noun>" permission. This is
// a deliberate, explicit deviation from the house role-permission standard's
// §2.1 default (one view/change pair per module) — every resource except
// "reports" (read-only) was split into four granular permissions per an
// explicit request. Named CRUDMiddlewares (not "ViewCreateUpdateDelete...")
// so every existing routes.go's perms.Create/perms.Read/perms.Update/
// perms.Delete call sites keep compiling unchanged.
type CRUDMiddlewares struct {
	Create gin.HandlerFunc
	Read   gin.HandlerFunc
	Update gin.HandlerFunc
	Delete gin.HandlerFunc
}

// resourceNouns maps a route-group resource key (as used in main.go's
// RegisterRoutes calls, e.g. "loans") to the singular noun the permission
// catalogue names are built from (e.g. "loan" -> "can view loan"/"can
// change loan"). Kept here (not in internal/authz) since CRUDPermissions,
// the sole caller, already lives in this file.
var resourceNouns = map[string]string{
	"branches":        "branch",
	"schemes":         "scheme",
	"goldrates":       "gold rate",
	"puritystandards": "purity standard",
	"employees":       "employee",
	"cash":            "cash",
	"settings":        "setting",
	"customers":       "customer",
	"loans":           "loan",
	"bankpledges":     "bank pledge",
	"uploads":         "upload",
	"ornamenttypes":   "ornament type",
	"banks":           "bank",
	"lockers":         "locker",
	"packets":         "packet",
	"reminders":       "reminder",
	"reports":         "report",
}

// ResourceNoun returns the permission-catalogue noun for a resource key,
// falling back to the key itself if it isn't in the table (so a missing
// mapping fails loudly as a 403 "Permission not found" rather than silently
// resolving to the wrong permission).
func ResourceNoun(resource string) string {
	if noun, ok := resourceNouns[resource]; ok {
		return noun
	}
	return resource
}

// CRUDPermissions builds the permissions for resource and wires them into a
// CRUDMiddlewares. Read always uses "can view <noun>". For every resource
// except "reports" (read-only — no create/update/delete permissions exist
// for it), Create/Update/Delete each get their own distinct permission —
// "can create/update/delete <noun>" — a deliberate, explicit deviation from
// the house role-permission standard's §2.1 default of one shared
// view/change pair per module; callers must not call .Create/.Update/
// .Delete for "reports".
func CRUDPermissions(checker PermissionChecker, resource string) CRUDMiddlewares {
	noun := ResourceNoun(resource)
	view := RequirePermission(checker, "can view "+noun)
	var create, update, deleteMw gin.HandlerFunc
	if resource != "reports" {
		create = RequirePermission(checker, "can create "+noun)
		update = RequirePermission(checker, "can update "+noun)
		deleteMw = RequirePermission(checker, "can delete "+noun)
	}
	return CRUDMiddlewares{
		Create: create,
		Read:   view,
		Update: update,
		Delete: deleteMw,
	}
}
