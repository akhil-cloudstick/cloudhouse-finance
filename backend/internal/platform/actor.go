package platform

import "github.com/gin-gonic/gin"

// ActorFromContext returns the AUTHENTICATED caller's own employeeId and
// role, read from the JWT claims AuthMiddleware already set on the
// gin.Context ("employeeId" and "role") — never from the request body.
//
// This exists because several write endpoints (loan approval, payments,
// release approval/completion) used to accept `employeeId`/`role` as plain
// JSON fields in the request body and trust them outright: any caller with
// a valid token for ANY role could submit `{"role":"Administrator"}` and
// act as an admin regardless of who they actually are. Handlers for those
// actions must call this instead of binding employeeId/role from the
// client — the acting identity is always the real logged-in employee.
// Administrator's existing "may act at any stage" bypass is unaffected: it
// still works exactly as before, just keyed off the real authenticated
// role rather than a claimed one.
func ActorFromContext(c *gin.Context) (employeeID uint, role string) {
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
	return employeeID, role
}
