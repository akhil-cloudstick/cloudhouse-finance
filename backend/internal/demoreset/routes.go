package demoreset

import (
	"net/http"

	"cloudhouse/backend/internal/platform"
	"cloudhouse/backend/internal/platform/httpx"

	"github.com/gin-gonic/gin"
)

// RegisterRoutes mounts the demo reset under the given group (expected to be
// something like protected.Group("/demo")).
func RegisterRoutes(rg *gin.RouterGroup, h *Handler) {
	rg.POST("/reset", requireAdministrator(), h.Reset)
}

// requireAdministrator gates the reset on the caller's role name.
//
// THIS IS A DELIBERATE DEVIATION FROM THE HOUSE STANDARD, and the reason is
// deployment, not preference.
//
// The idiomatic gate here is platform.RequirePermission with a new
// "can reset demo data" entry in authz.Catalogue plus an Administrator-only
// authz.Restrictions row — exactly how "can manage billing" is done. The
// problem is that the catalogue is only ever seeded by migrate.Run. Adding an
// entry means the permissions row does not exist until someone runs
// `go run ./cmd/migrate`, and until they do, RequirePermission answers 403
// "Permission not found" to every caller including the Administrator. Making
// that failure loud instead of silent means bumping
// migrate.CurrentSchemaVersion, which makes the API refuse to boot until the
// migration is run. On this deployment there is no terminal after release —
// which is the whole reason this endpoint exists rather than just the CLI —
// so either variant would ship a reset that cannot work.
//
// The role name is no weaker as a check. platform.AuthMiddleware re-reads the
// live employees row on every single request and sets "role" from it, so a
// demoted or deleted employee loses access immediately, exactly as with a
// permission lookup. What is lost is configurability: an operator cannot
// delegate this to another role from the Roles & Permissions screen. For an
// irreversible wipe that is arguably the right answer anyway.
//
// If the deploy pipeline ever can run migrate, switch to the permission —
// see the plan's authorization section.
func requireAdministrator() gin.HandlerFunc {
	return func(c *gin.Context) {
		role, _ := c.Get("role")
		if name, ok := role.(string); !ok || name != platform.AdministratorRole {
			httpx.FailAbort(c, http.StatusForbidden,
				"Only an Administrator can reset the demo data.")
			return
		}
		c.Next()
	}
}
