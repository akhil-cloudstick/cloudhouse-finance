package platform

import (
	"net/http"
	"strings"

	"github.com/gin-gonic/gin"
)

// PermissionChecker is the minimal surface RequirePermission needs from
// internal/authz.Repository, kept as a narrow interface here so platform
// doesn't import the authz package (avoiding a low-level package depending
// on a higher-level domain package).
type PermissionChecker interface {
	IsAllowed(role, resource, action string) (bool, error)
}

// AuthMiddleware is "checkpoint 1": every request to a protected route must
// carry a valid `Authorization: Bearer <token>` header. On success it sets
// employeeId (uint), role (string), and branchId (uint) on the gin.Context
// for downstream handlers/middleware (e.g. RequirePermission, auth.Me) to
// read. Missing/malformed/invalid/expired tokens get a 401 and the request
// is aborted before reaching any route handler.
func AuthMiddleware(secret string) gin.HandlerFunc {
	return func(c *gin.Context) {
		header := c.GetHeader("Authorization")
		if header == "" {
			c.AbortWithStatusJSON(http.StatusUnauthorized, gin.H{"error": "missing Authorization header"})
			return
		}
		parts := strings.SplitN(header, " ", 2)
		if len(parts) != 2 || !strings.EqualFold(parts[0], "Bearer") || parts[1] == "" {
			c.AbortWithStatusJSON(http.StatusUnauthorized, gin.H{"error": "malformed Authorization header"})
			return
		}

		claims, err := ParseToken(parts[1], secret)
		if err != nil {
			c.AbortWithStatusJSON(http.StatusUnauthorized, gin.H{"error": "invalid or expired token"})
			return
		}

		c.Set("employeeId", claims.EmployeeID)
		c.Set("role", claims.Role)
		c.Set("branchId", claims.BranchID)
		c.Next()
	}
}

// RequirePermission is "checkpoint 2": given the resource/action this route
// verb represents, it looks up (role, resource, action) in the permissions
// table (via checker) and 403s if the role isn't allowed (or the lookup
// itself fails) — otherwise continues. Must run after AuthMiddleware, which
// is what sets "role" on the context.
func RequirePermission(checker PermissionChecker, resource, action string) gin.HandlerFunc {
	return func(c *gin.Context) {
		roleVal, ok := c.Get("role")
		if !ok {
			c.AbortWithStatusJSON(http.StatusUnauthorized, gin.H{"error": "not authenticated"})
			return
		}
		role, ok := roleVal.(string)
		if !ok {
			c.AbortWithStatusJSON(http.StatusUnauthorized, gin.H{"error": "not authenticated"})
			return
		}

		allowed, err := checker.IsAllowed(role, resource, action)
		if err != nil {
			c.AbortWithStatusJSON(http.StatusInternalServerError, gin.H{"error": "permission check failed"})
			return
		}
		if !allowed {
			c.AbortWithStatusJSON(http.StatusForbidden, gin.H{"error": "you do not have permission to perform this action"})
			return
		}
		c.Next()
	}
}

// RequireAnyRole restricts a route to an explicit allowlist of roles,
// independently of the permissions table. Must run after AuthMiddleware,
// which is what sets "role" on the context.
//
// This exists alongside RequirePermission rather than replacing it because
// the permissions table is resource-grained ("loans", "read"/"update"), and
// several distinct sub-workflows currently share the "loans" resource key —
// payments, approvals, bank pledges and auctions all sit under it. Auction
// actions decide whether a customer permanently loses their pledged gold, so
// they need a tighter gate than "may update loans", which a Cashier or Loan
// Operator legitimately holds for taking payments. Attach BOTH: the CRUD
// permission still applies, and this narrows it further.
//
// Sensitive actions must ALSO be checked in the service layer where the
// distinction is finer than a whole route (e.g. an Auction Administrator may
// reach the auction routes but must not decide a shortfall write-off).
func RequireAnyRole(roles ...string) gin.HandlerFunc {
	allowed := make(map[string]bool, len(roles))
	for _, r := range roles {
		allowed[r] = true
	}
	return func(c *gin.Context) {
		roleVal, ok := c.Get("role")
		if !ok {
			c.AbortWithStatusJSON(http.StatusUnauthorized, gin.H{"error": "not authenticated"})
			return
		}
		role, ok := roleVal.(string)
		if !ok {
			c.AbortWithStatusJSON(http.StatusUnauthorized, gin.H{"error": "not authenticated"})
			return
		}
		if !allowed[role] {
			c.AbortWithStatusJSON(http.StatusForbidden, gin.H{
				"error": "your role does not have access to auction management",
			})
			return
		}
		c.Next()
	}
}

// CRUDPermissions returns the four RequirePermission middlewares
// (create/read/update/delete) for a given resource, so each domain
// package's routes.go can attach the right one to each verb with a minimal,
// mechanical one-line-per-route diff, e.g.:
//
//	perms := platform.CRUDPermissions(authzRepo, "banks")
//	rg.GET("", perms.Read, h.List)
//	rg.POST("", perms.Create, h.Create)
type CRUDMiddlewares struct {
	Create gin.HandlerFunc
	Read   gin.HandlerFunc
	Update gin.HandlerFunc
	Delete gin.HandlerFunc
}

func CRUDPermissions(checker PermissionChecker, resource string) CRUDMiddlewares {
	return CRUDMiddlewares{
		Create: RequirePermission(checker, resource, "create"),
		Read:   RequirePermission(checker, resource, "read"),
		Update: RequirePermission(checker, resource, "update"),
		Delete: RequirePermission(checker, resource, "delete"),
	}
}
