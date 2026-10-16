package auth

import (
	commonModels "cloudhouse/backend/common/models"
	"cloudhouse/backend/config"
	"context"
	"errors"
	"log"
	"net/http"
	"net/url"
	"strconv"
	"strings"

	"github.com/golang-jwt/jwt/v5"
	"github.com/labstack/echo/v4"
)

var ErrPermissionNotFound = errors.New("permission not found")

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
	"personalloans":   "personal loan",
	"investments":     "investment",
	"bankpledges":     "bank pledge",
	"uploads":         "upload",
	"ornamenttypes":   "ornament type",
	"banks":           "bank",
	"lockers":         "locker",
	"packets":         "packet",
	"reminders":       "reminder",
	"reports":         "report",
	"audit-log":       "audit log",
}

var (
	IsAllowed              func(ctx context.Context, roleID uint, permissionName string) (bool, error)
	CurrentSession         func(ctx context.Context, employeeID uint) (Session, bool)
	HasModule              func(ctx context.Context, tenantID uint, moduleKey string) (bool, error)
	TenantIDForHost        func(ctx context.Context, host string) (uint, bool)
	SingleBranchHeadOffice func(ctx context.Context, tenantID uint) (headOfficeID uint, single bool, err error)
)

const CrossBranchPermission = "can view all branches"

const SelectedBranchHeader = "X-Branch-Id"

const permissionCacheKey = "permissionCache"

type Session struct {
	Role     string
	RoleID   uint
	BranchID uint
	IsSystem bool
	IsActive bool
}

type CRUDMiddlewares struct {
	Create      echo.MiddlewareFunc
	Read        echo.MiddlewareFunc
	Update      echo.MiddlewareFunc
	Delete      echo.MiddlewareFunc
	Export      echo.MiddlewareFunc
	ExportQuery echo.MiddlewareFunc
}

type requestHostCtxKey struct{}

func AuthMiddleware() echo.MiddlewareFunc {
	return func(next echo.HandlerFunc) echo.HandlerFunc {
		return func(c echo.Context) error {
			header := c.Request().Header.Get("Authorization")
			if header == "" {
				return failAbort(c, http.StatusUnauthorized, "missing Authorization header")
			}
			parts := strings.SplitN(header, " ", 2)
			if len(parts) != 2 || !strings.EqualFold(parts[0], "Bearer") || parts[1] == "" {
				return failAbort(c, http.StatusUnauthorized, "malformed Authorization header")
			}
			claims, err := ParseToken(parts[1], config.Env.JWTSecret)
			if err != nil {
				return failAbort(c, http.StatusUnauthorized, tokenFailure(err))
			}
			if claims.TenantID == 0 {
				return failAbort(c, http.StatusUnauthorized, "your session predates a security update — please sign in again")
			}
			session, ok := CurrentSession(config.WithTenant(c.Request().Context(), claims.TenantID), claims.EmployeeID)
			if !ok {
				return failAbort(c, http.StatusUnauthorized, "your session is no longer valid — please sign in again")
			}
			if !session.IsActive {
				return failAbort(c, http.StatusUnauthorized, "Account is inactive")
			}
			c.Set("employeeId", claims.EmployeeID)
			c.Set("role", session.Role)
			c.Set("roleId", session.RoleID)
			c.Set("isSystem", session.IsSystem)
			c.Set("tenantId", claims.TenantID)
			c.Set("branchId", session.BranchID)
			return next(c)
		}
	}
}

func tokenFailure(err error) string {
	if errors.Is(err, jwt.ErrTokenExpired) {
		return "Session expired, please log in again"
	}
	return "Invalid token"
}

func CustomerAuthMiddleware() echo.MiddlewareFunc {
	return func(next echo.HandlerFunc) echo.HandlerFunc {
		return func(c echo.Context) error {
			header := c.Request().Header.Get("Authorization")
			if header == "" {
				return failAbort(c, http.StatusUnauthorized, "missing Authorization header")
			}
			parts := strings.SplitN(header, " ", 2)
			if len(parts) != 2 || !strings.EqualFold(parts[0], "Bearer") || parts[1] == "" {
				return failAbort(c, http.StatusUnauthorized, "malformed Authorization header")
			}
			claims, err := ParseCustomerToken(parts[1], config.Env.JWTSecret)
			if err != nil {
				return failAbort(c, http.StatusUnauthorized, tokenFailure(err))
			}
			if claims.TenantID == 0 {
				return failAbort(c, http.StatusUnauthorized, "your session predates a security update — please sign in again")
			}
			c.Set("customerId", claims.CustomerID)
			c.Set("tenantId", claims.TenantID)
			return next(c)
		}
	}
}

func SuperAdminAuthMiddleware() echo.MiddlewareFunc {
	return func(next echo.HandlerFunc) echo.HandlerFunc {
		return func(c echo.Context) error {
			header := c.Request().Header.Get("Authorization")
			if header == "" {
				return failAbort(c, http.StatusUnauthorized, "missing Authorization header")
			}
			parts := strings.SplitN(header, " ", 2)
			if len(parts) != 2 || !strings.EqualFold(parts[0], "Bearer") || parts[1] == "" {
				return failAbort(c, http.StatusUnauthorized, "malformed Authorization header")
			}
			claims, err := ParseSuperAdminToken(parts[1], config.Env.JWTSecret)
			if err != nil {
				return failAbort(c, http.StatusUnauthorized, tokenFailure(err))
			}
			c.Set("superAdminUserId", claims.SuperAdminUserID)
			c.Set("superAdminName", claims.Name)
			return next(c)
		}
	}
}

func RequirePermission(permissionName string) echo.MiddlewareFunc {
	return func(next echo.HandlerFunc) echo.HandlerFunc {
		return func(c echo.Context) error {
			roleIDVal, ok := ctxValue(c, "roleId")
			if !ok {
				return failAbort(c, http.StatusUnauthorized, "not authenticated")
			}
			roleID, ok := roleIDVal.(uint)
			if !ok {
				return failAbort(c, http.StatusUnauthorized, "not authenticated")
			}
			allowed, err := cachedIsAllowed(c, roleID, permissionName)
			if err != nil {
				if errors.Is(err, ErrPermissionNotFound) {
					return failForbidden(c, "Permission not found", permissionName)
				}
				log.Printf("permission check for %q (role %d) failed: %v", permissionName, roleID, err)
				return failAbort(c, http.StatusInternalServerError, "permission check failed")
			}
			if !allowed {
				return failForbidden(c, "Access denied", permissionName)
			}
			return next(c)
		}
	}
}

func cachedIsAllowed(c echo.Context, roleID uint, permissionName string) (bool, error) {
	cache, _ := c.Get(permissionCacheKey).(map[string]bool)
	if allowed, ok := cache[permissionName]; ok {
		return allowed, nil
	}
	allowed, err := IsAllowed(RequestContext(c), roleID, permissionName)
	if err != nil {
		return false, err
	}
	if cache == nil {
		cache = map[string]bool{}
		c.Set(permissionCacheKey, cache)
	}
	cache[permissionName] = allowed
	return allowed, nil
}

func ResourceNoun(resource string) string {
	if noun, ok := resourceNouns[resource]; ok {
		return noun
	}
	return resource
}

func CRUDPermissions(resource string) CRUDMiddlewares {
	noun := ResourceNoun(resource)
	view := RequirePermission("can view " + noun + " module")
	var create, update, deleteMw echo.MiddlewareFunc
	if resource != "reports" && resource != "audit-log" {
		create = RequirePermission("can create " + noun)
		update = RequirePermission("can update " + noun)
		deleteMw = RequirePermission("can delete " + noun)
	}
	export := RequirePermission("can export ledger")
	return CRUDMiddlewares{
		Create:      create,
		Read:        view,
		Update:      update,
		Delete:      deleteMw,
		Export:      export,
		ExportQuery: whenExportQuery(export),
	}
}

func whenExportQuery(gate echo.MiddlewareFunc) echo.MiddlewareFunc {
	return func(next echo.HandlerFunc) echo.HandlerFunc {
		return func(c echo.Context) error {
			if c.QueryParam("export") == "" {
				return next(c)
			}
			return gate(next)(c)
		}
	}
}

func RequireTenantModule(moduleKey string) echo.MiddlewareFunc {
	return func(next echo.HandlerFunc) echo.HandlerFunc {
		return func(c echo.Context) error {
			ctx := RequestContext(c)
			tenantID, ok := config.TenantFromContext(ctx)
			if !ok || tenantID == 0 {
				return failAbort(c, http.StatusUnauthorized, "no business in session")
			}
			enabled, err := HasModule(ctx, tenantID, moduleKey)
			if err != nil {
				log.Printf("module check failed for tenant %d, module %q: %v", tenantID, moduleKey, err)
				return failAbort(c, http.StatusForbidden, "this feature is not available for your business")
			}
			if !enabled {
				return failAbort(c, http.StatusForbidden, "this feature is not enabled for your business")
			}
			return next(c)
		}
	}
}

func PinTenantConn() echo.MiddlewareFunc {
	return func(next echo.HandlerFunc) echo.HandlerFunc {
		return func(c echo.Context) error {
			tenantID, ok := TenantFromGin(c)
			if !ok {
				return next(c)
			}
			ctx, release, err := config.PinConn(c.Request().Context(), config.BaseDB, tenantID)
			if err != nil {
				log.Printf("pinning a connection for business %d: %v", tenantID, err)
				return failAbort(c, http.StatusServiceUnavailable, "the service is busy — please try again in a moment")
			}
			defer release()
			c.SetRequest(c.Request().WithContext(ctx))
			return next(c)
		}
	}
}

func RequireSelf(param, ctxKey string) echo.MiddlewareFunc {
	return func(next echo.HandlerFunc) echo.HandlerFunc {
		return func(c echo.Context) error {
			raw := c.Param(param)
			want, ok := ctxValue(c, ctxKey)
			id, isUint := want.(uint)
			if raw == "" || !ok || !isUint || raw != strconv.FormatUint(uint64(id), 10) {
				return failAbort(c, http.StatusForbidden, "This request does not belong to the signed-in user, please sign in again")
			}
			return next(c)
		}
	}
}

func Staff(extra ...echo.MiddlewareFunc) []echo.MiddlewareFunc {
	return append([]echo.MiddlewareFunc{AuthMiddleware(), RequireSelf("user_id", "employeeId"), RequireHostMatchesTenant(), PinTenantConn(), PinSingleBranch()}, extra...)
}

func Customer(extra ...echo.MiddlewareFunc) []echo.MiddlewareFunc {
	return append([]echo.MiddlewareFunc{CustomerAuthMiddleware(), RequireSelf("customer_id", "customerId"), RequireHostMatchesTenant(), PinTenantConn()}, extra...)
}

func SuperAdmin(extra ...echo.MiddlewareFunc) []echo.MiddlewareFunc {
	return append([]echo.MiddlewareFunc{SuperAdminAuthMiddleware(), RequireSelf("user_id", "superAdminUserId")}, extra...)
}

func RequireSystemRole() echo.MiddlewareFunc {
	return func(next echo.HandlerFunc) echo.HandlerFunc {
		return func(c echo.Context) error {
			if !IsSystemActor(c) {
				return failAbort(c, http.StatusForbidden,
					"Only an Administrator can reset the demo data.")
			}
			return next(c)
		}
	}
}

func RequireReportExportModule() echo.MiddlewareFunc {
	personalLoansGate := RequireTenantModule(commonModels.ModulePersonalLoans)
	investmentsGate := RequireTenantModule(commonModels.ModuleInvestments)
	return func(next echo.HandlerFunc) echo.HandlerFunc {
		return func(c echo.Context) error {
			key := c.Param("key")
			switch {
			case key == "personal-loans":
				return personalLoansGate(next)(c)
			case strings.HasPrefix(key, "investments-"):
				return investmentsGate(next)(c)
			}
			return next(c)
		}
	}
}

func CORS(allowedOrigins string) echo.MiddlewareFunc {
	var exact = map[string]bool{}
	var wildcardSuffixes []string
	for _, o := range strings.Split(allowedOrigins, ",") {
		if o = strings.TrimSpace(o); o == "" {
			continue
		}
		if idx := strings.Index(o, "*."); idx >= 0 {
			wildcardSuffixes = append(wildcardSuffixes, "."+strings.ToLower(o[idx+len("*."):]))
			continue
		}
		exact[o] = true
	}
	originAllowed := func(origin string) bool {
		if exact[origin] {
			return true
		}
		if len(wildcardSuffixes) == 0 {
			return false
		}
		u, err := url.Parse(origin)
		if err != nil || u.Host == "" {
			return false
		}
		host := strings.ToLower(u.Hostname())
		for _, suffix := range wildcardSuffixes {
			if strings.HasSuffix(host, suffix) {
				return true
			}
		}
		return false
	}
	return func(next echo.HandlerFunc) echo.HandlerFunc {
		return func(c echo.Context) error {
			if origin := c.Request().Header.Get("Origin"); origin != "" && originAllowed(origin) {
				c.Response().Header().Set("Access-Control-Allow-Origin", origin)
				c.Response().Header().Set("Vary", "Origin")
			}
			c.Response().Header().Set("Access-Control-Allow-Methods", "GET, POST, PUT, PATCH, DELETE, OPTIONS")
			c.Response().Header().Set("Access-Control-Allow-Headers", "Content-Type, Authorization, X-Branch-Id")
			if c.Request().Method == http.MethodOptions {
				return c.NoContent(http.StatusNoContent)
			}
			return next(c)
		}
	}
}

func ActorFromContext(c echo.Context) (employeeID uint, role string, roleID uint) {
	if v, ok := ctxValue(c, "employeeId"); ok {
		if id, ok := v.(uint); ok {
			employeeID = id
		}
	}
	if v, ok := ctxValue(c, "role"); ok {
		if r, ok := v.(string); ok {
			role = r
		}
	}
	if v, ok := ctxValue(c, "roleId"); ok {
		if id, ok := v.(uint); ok {
			roleID = id
		}
	}
	return employeeID, role, roleID
}

func PinSingleBranch() echo.MiddlewareFunc {
	return func(next echo.HandlerFunc) echo.HandlerFunc {
		return func(c echo.Context) error {
			if tenantID, ok := TenantFromGin(c); ok {
				ho, single, err := SingleBranchHeadOffice(config.WithTenant(c.Request().Context(), tenantID), tenantID)
				if err == nil && single && ho != 0 {
					c.Set("singleBranchHeadOffice", ho)
				}
			}
			return next(c)
		}
	}
}

func IsSystemActor(c echo.Context) bool {
	v, _ := ctxValue(c, "isSystem")
	isSystem, _ := v.(bool)
	return isSystem
}

func IsCrossBranchRole(c echo.Context) bool {
	roleVal, _ := ctxValue(c, "roleId")
	roleID, ok := roleVal.(uint)
	if !ok {
		return false
	}
	allowed, err := cachedIsAllowed(c, roleID, CrossBranchPermission)
	return err == nil && allowed
}

func ownBranchID(c echo.Context) uint {
	branchVal, ok := ctxValue(c, "branchId")
	if !ok {
		return 0
	}
	branchID, ok := branchVal.(uint)
	if !ok {
		return 0
	}
	return branchID
}

func selectedBranchID(c echo.Context) (uint, bool) {
	raw := strings.TrimSpace(c.Request().Header.Get(SelectedBranchHeader))
	if raw == "" {
		return 0, false
	}
	parsed, err := strconv.ParseUint(raw, 10, 64)
	if err != nil || parsed == 0 {
		return 0, false
	}
	return uint(parsed), true
}

func GetBranchScope(c echo.Context) *uint {
	if ho, ok := SingleBranchPin(c); ok {
		return &ho
	}
	if !IsCrossBranchRole(c) {
		own := ownBranchID(c)
		return &own
	}
	if selected, ok := selectedBranchID(c); ok {
		return &selected
	}
	return nil
}

func EnforceBranchOnWrite(c echo.Context, submittedBranchID uint) uint {
	if ho, ok := SingleBranchPin(c); ok {
		return ho
	}
	if IsCrossBranchRole(c) {
		if submittedBranchID != 0 {
			return submittedBranchID
		}
		if selected, ok := selectedBranchID(c); ok {
			return selected
		}
		return submittedBranchID
	}
	branchVal, ok := ctxValue(c, "branchId")
	if !ok {
		return submittedBranchID
	}
	branchID, ok := branchVal.(uint)
	if !ok {
		return submittedBranchID
	}
	return branchID
}

func SingleBranchPin(c echo.Context) (uint, bool) {
	v, ok := ctxValue(c, "singleBranchHeadOffice")
	if !ok {
		return 0, false
	}
	id, ok := v.(uint)
	return id, ok && id != 0
}

func NarrowBranch(c echo.Context, requested *uint) (branch *uint, ok bool) {
	scope := GetBranchScope(c)
	switch {
	case scope == nil:
		return requested, true
	case requested == nil || *requested == *scope:
		return scope, true
	default:
		return nil, false
	}
}

func ctxValue(c echo.Context, key string) (any, bool) {
	v := c.Get(key)
	return v, v != nil
}

func failAbort(c echo.Context, status int, message string) error {
	if status >= http.StatusInternalServerError && status != http.StatusServiceUnavailable {
		status = http.StatusBadRequest
	}
	return c.JSON(status, echo.Map{
		"success": false,
		"error":   message,
	})
}

// failForbidden keeps "error" as the user-facing text and names the permission
// the role lacks in "missing_permission", for reading in the network tab.
func failForbidden(c echo.Context, message, permissionName string) error {
	return c.JSON(http.StatusForbidden, echo.Map{
		"success":            false,
		"error":              message,
		"missing_permission": permissionName,
	})
}

func WithRequestHost(ctx context.Context, host string) context.Context {
	if host == "" {
		return ctx
	}
	return context.WithValue(ctx, requestHostCtxKey{}, host)
}

func RequestHostFromContext(ctx context.Context) (string, bool) {
	if ctx == nil {
		return "", false
	}
	h, ok := ctx.Value(requestHostCtxKey{}).(string)
	return h, ok && h != ""
}

func CarryRequestHost() echo.MiddlewareFunc {
	return func(next echo.HandlerFunc) echo.HandlerFunc {
		return func(c echo.Context) error {
			c.SetRequest(c.Request().WithContext(WithRequestHost(c.Request().Context(), c.Request().Host)))
			return next(c)
		}
	}
}

func RequireHostMatchesTenant() echo.MiddlewareFunc {
	return func(next echo.HandlerFunc) echo.HandlerFunc {
		return func(c echo.Context) error {
			tenantID, ok := TenantFromGin(c)
			if !ok {
				return next(c)
			}
			hostTenant, matched := TenantIDForHost(c.Request().Context(), c.Request().Host)
			if matched && hostTenant != tenantID {
				return failAbort(c, 401, "your session is no longer valid — please sign in again")
			}
			return next(c)
		}
	}
}

func TenantFromGin(c echo.Context) (uint, bool) {
	v, ok := ctxValue(c, "tenantId")
	if !ok {
		return 0, false
	}
	id, ok := v.(uint)
	if !ok || id == 0 {
		return 0, false
	}
	return id, true
}

func RequestContext(c echo.Context) context.Context {
	ctx := c.Request().Context()
	if id, ok := TenantFromGin(c); ok {
		ctx = config.WithTenant(ctx, id)
	}
	return ctx
}
