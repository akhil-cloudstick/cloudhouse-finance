package platform

import "github.com/gin-gonic/gin"

// AdministratorRole is the sole role that bypasses branch scoping — every
// other role is confined to its own branch (see GetBranchScope,
// EnforceBranchOnWrite).
const AdministratorRole = "Administrator"

// GetBranchScope returns nil if the caller is an Administrator (no filter —
// sees all branches), otherwise a pointer to their own branchId, read from
// the JWT claims AuthMiddleware already set on the gin.Context ("role" and
// "branchId"). Callers thread the result into their repository's
// FindAll/List as an optional `WHERE branch_id = ?` filter, and into
// Get/FindByID as a not-found-on-mismatch guard.
//
// Missing/malformed context values are treated as "no scope info available"
// and fall back to the caller's own (zero) branchId rather than panicking —
// AuthMiddleware always sets both keys on any request that reaches a
// protected handler, so this only matters defensively.
func GetBranchScope(c *gin.Context) *uint {
	roleVal, _ := c.Get("role")
	if role, ok := roleVal.(string); ok && role == AdministratorRole {
		return nil
	}

	branchVal, ok := c.Get("branchId")
	if !ok {
		var zero uint
		return &zero
	}
	branchID, ok := branchVal.(uint)
	if !ok {
		var zero uint
		return &zero
	}
	return &branchID
}

// EnforceBranchOnWrite validates/overrides a submitted branchId on a
// create/update request body: for Administrator, the submitted value passes
// through unchanged (admins may create/assign records to any branch);
// for every other role, the submitted value is silently overridden to the
// caller's own branchId, so a non-admin can never persist a record under a
// branch other than their own, even by tampering with the request body.
func EnforceBranchOnWrite(c *gin.Context, submittedBranchID uint) uint {
	roleVal, _ := c.Get("role")
	if role, ok := roleVal.(string); ok && role == AdministratorRole {
		return submittedBranchID
	}

	branchVal, ok := c.Get("branchId")
	if !ok {
		return submittedBranchID
	}
	branchID, ok := branchVal.(uint)
	if !ok {
		return submittedBranchID
	}
	return branchID
}
