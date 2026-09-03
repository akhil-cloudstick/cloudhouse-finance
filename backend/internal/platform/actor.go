package platform

import "github.com/gin-gonic/gin"

// ActorFromContext returns the AUTHENTICATED caller's own employeeId, role
// name, and roleId, read from the JWT claims AuthMiddleware already set on
// the gin.Context ("employeeId", "role", "roleId" — the same "roleId" key
// RequirePermission reads) — never from the request body.
//
// This exists because several write endpoints (loan approval, payments,
// release approval/completion) used to accept `employeeId`/`role` as plain
// JSON fields in the request body and trust them outright: any caller with
// a valid token for ANY role could submit `{"role":"Administrator"}` and
// act as an admin regardless of who they actually are. Handlers for those
// actions must call this instead of binding employeeId/role from the
// client — the acting identity is always the real logged-in employee.
//
// roleID is what the approval-chain permission checks (loan sanction/
// extension/release stages, auction decisions/steps — see
// internal/loan/service.go) pass to authz.Repository.IsAllowed; role (the
// display string) is kept only for audit trails (LoanApproval/AuctionEvent
// records) that already store the role name, not for authorization
// decisions any more — an Administrator's "may act at any stage" now works
// because the Administrator role's grants can't be revoked (see
// authz.Repository), not because of a string comparison here.
func ActorFromContext(c *gin.Context) (employeeID uint, role string, roleID uint) {
	if v, ok := c.Get("employeeId"); ok {
		if id, ok := v.(uint); ok {
			employeeID = id
		}
	}
	if v, ok := c.Get("role"); ok {
		if r, ok := v.(string); ok {
			role = r
		}
	}
	if v, ok := c.Get("roleId"); ok {
		if id, ok := v.(uint); ok {
			roleID = id
		}
	}
	return employeeID, role, roleID
}
