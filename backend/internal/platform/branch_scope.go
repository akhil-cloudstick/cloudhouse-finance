package platform

import (
	"strconv"
	"strings"

	"github.com/gin-gonic/gin"
)

// AdministratorRole and ManagementRole are the roles that see every branch of
// their OWN business. Every other role is confined to the single branch on its
// employee record (see GetBranchScope, EnforceBranchOnWrite).
const (
	AdministratorRole = "Administrator"
	ManagementRole    = "Management"
)

// crossBranchRoles is held as a set rather than a chain of `role ==`
// comparisons because the same question is asked in two places here and the
// answer must never differ between them. Adding a role is one line, and
// `grep crossBranchRoles` is the whole audit of who can see another branch.
var crossBranchRoles = map[string]bool{
	AdministratorRole: true,
	ManagementRole:    true,
}

// SelectedBranchHeader carries the branch switcher's current selection.
//
// A header — that is, a client-supplied value — is deliberate here, and it is
// worth being precise about why, because the opposite rule holds one level up:
// the BUSINESS is established at authentication and is never read from a
// header, body, query string or URL segment.
//
// The difference is that this value can only ever NARROW what the token
// already permits:
//
//   - For a role that is not cross-branch it is ignored outright. A cashier
//     cannot widen their scope by sending a header.
//   - For a cross-branch role it replaces "all branches" with one branch, so
//     the result is always a subset of what that session could already see.
//   - It cannot cross businesses. The resulting query still carries the
//     tenant predicate from the session, so a branch id belonging to another
//     business matches nothing — an empty list, never another business's
//     rows. TestBranchSelectionCannotCrossBusinesses in the isolation harness
//     asserts exactly that.
//
// So the header selects a view; it grants nothing. A tenant header would grant
// something, which is why one does not exist.
const SelectedBranchHeader = "X-Branch-Id"

// IsCrossBranchRole reports whether the caller's role sees every branch of
// their business. Exported for handlers that shape a response rather than a
// query — a branch switcher only makes sense to send to a caller who has more
// than one branch to switch between.
func IsCrossBranchRole(c *gin.Context) bool {
	roleVal, _ := c.Get("role")
	role, ok := roleVal.(string)
	return ok && crossBranchRoles[role]
}

// ownBranchID reads the caller's own branch from the JWT claims AuthMiddleware
// set on the context.
//
// Missing or malformed values fall back to the zero branch rather than
// panicking, and zero is the safe direction: it scopes to a branch that
// matches nothing instead of removing the filter. AuthMiddleware always sets
// both keys on any request reaching a protected handler, so this only matters
// defensively.
func ownBranchID(c *gin.Context) uint {
	branchVal, ok := c.Get("branchId")
	if !ok {
		return 0
	}
	branchID, ok := branchVal.(uint)
	if !ok {
		return 0
	}
	return branchID
}

// selectedBranchID reads the switcher's selection, if the caller sent one.
//
// A blank, zero or unparseable value means "no selection" — i.e. all branches
// — rather than an error. The switcher's "All branches" option sends nothing,
// and a malformed header should not fail a request that would otherwise
// succeed.
func selectedBranchID(c *gin.Context) (uint, bool) {
	raw := strings.TrimSpace(c.GetHeader(SelectedBranchHeader))
	if raw == "" {
		return 0, false
	}
	parsed, err := strconv.ParseUint(raw, 10, 64)
	if err != nil || parsed == 0 {
		return 0, false
	}
	return uint(parsed), true
}

// GetBranchScope returns the branch filter to apply to the caller's queries:
// nil for "every branch of this business", or a pointer to a single branch id.
//
// Callers thread the result into their repository's FindAll/List as an
// optional `WHERE branch_id = ?`, and into Get/FindByID as a
// not-found-on-mismatch guard.
//
//   - Cross-branch roles (Administrator, Management) get nil — all branches —
//     unless they have picked one in the branch switcher, in which case they
//     get that one. This is what Step 6 of the multi-tenancy plan adds:
//     Management previously saw only its own branch, because Administrator was
//     the sole role that bypassed scoping.
//   - Every other role gets its own branch, and any selection they send is
//     ignored. Their scope is a property of their employee record, not of
//     their request.
//
// Note what this function does NOT do: it never widens scope, and it never
// touches the business. Branch is a view; business is the boundary.
func GetBranchScope(c *gin.Context) *uint {
	if !IsCrossBranchRole(c) {
		own := ownBranchID(c)
		return &own
	}
	if selected, ok := selectedBranchID(c); ok {
		return &selected
	}
	return nil
}

// EnforceBranchOnWrite validates or overrides a submitted branchId on a
// create/update body.
//
//   - For a cross-branch role the submitted value passes through: these roles
//     legitimately create records in any branch of their business. If they
//     submitted nothing but have a branch selected in the switcher, the
//     selection is used — so a record created while viewing one branch lands
//     in that branch rather than in branch zero.
//   - For every other role the submitted value is overridden with the
//     caller's own branch, so they can never persist a record under another
//     branch even by editing the request body.
//
// The business is not part of this decision at all: tenant_id is stamped on
// insert by the tenant scope (see tenant_gorm.go's stampCallback) from the
// session, never from a body. So a cross-branch role writing to a branch id
// that belongs to another business writes a row that business can never see,
// and the foreign key rejects it outright.
func EnforceBranchOnWrite(c *gin.Context, submittedBranchID uint) uint {
	if IsCrossBranchRole(c) {
		if submittedBranchID != 0 {
			return submittedBranchID
		}
		if selected, ok := selectedBranchID(c); ok {
			return selected
		}
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
