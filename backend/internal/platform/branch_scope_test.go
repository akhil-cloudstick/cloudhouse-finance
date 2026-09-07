package platform

import (
	"net/http/httptest"
	"testing"

	"github.com/gin-gonic/gin"
)

// ctxWith builds a gin context carrying the claims AuthMiddleware would have
// set, plus an optional branch-switcher header.
func ctxWith(role string, ownBranch uint, selectedHeader string) *gin.Context {
	c, _ := gin.CreateTestContext(httptest.NewRecorder())
	c.Request = httptest.NewRequest("GET", "/", nil)
	c.Set("role", role)
	c.Set("branchId", ownBranch)
	if selectedHeader != "" {
		c.Request.Header.Set(SelectedBranchHeader, selectedHeader)
	}
	return c
}

func scopeOf(c *gin.Context) string {
	s := GetBranchScope(c)
	if s == nil {
		return "all"
	}
	switch *s {
	case 0:
		return "none(0)"
	default:
		return "branch:" + itoa(*s)
	}
}

func itoa(u uint) string {
	if u == 0 {
		return "0"
	}
	var buf [20]byte
	i := len(buf)
	for u > 0 {
		i--
		buf[i] = byte('0' + u%10)
		u /= 10
	}
	return string(buf[i:])
}

// TestBranchScopeRules is the whole Step 6 behaviour in one table.
//
// The two properties that matter, and that the table is arranged to make
// obvious:
//
//   - A cross-branch role can NARROW to one branch (the switcher) but a
//     single-branch role can never WIDEN, whatever it sends.
//   - Nothing here can change the business. Branch is a view; business is the
//     boundary, and it comes from the token alone.
func TestBranchScopeRules(t *testing.T) {
	gin.SetMode(gin.TestMode)

	cases := []struct {
		name     string
		role     string
		own      uint
		selected string
		want     string
	}{
		// Cross-branch roles see everything by default. Management gaining
		// this is the actual change in Step 6 — before it, Administrator was
		// the only role that bypassed scoping.
		{"administrator sees all branches", AdministratorRole, 1, "", "all"},
		{"management sees all branches", ManagementRole, 1, "", "all"},

		// ...and can narrow to one via the switcher.
		{"administrator narrows to a branch", AdministratorRole, 1, "7", "branch:7"},
		{"management narrows to a branch", ManagementRole, 1, "7", "branch:7"},

		// A single-branch role is pinned to its own branch and CANNOT widen,
		// no matter what it sends. This is the security-relevant row: the
		// header is a view control for senior roles, never a privilege for
		// anyone else.
		{"cashier is pinned to its own branch", "Cashier", 3, "", "branch:3"},
		{"cashier cannot select another branch", "Cashier", 3, "7", "branch:3"},
		{"branch manager cannot select another branch", "Branch Manager", 4, "9", "branch:4"},
		{"auditor cannot select another branch", "Auditor", 5, "1", "branch:5"},

		// A malformed or empty selection means "all branches" for a
		// cross-branch role, not an error: the switcher's "All branches"
		// option sends nothing, and a junk header must not fail a request
		// that would otherwise succeed.
		{"garbage selection falls back to all", ManagementRole, 1, "not-a-number", "all"},
		{"zero selection falls back to all", ManagementRole, 1, "0", "all"},
		{"negative selection falls back to all", ManagementRole, 1, "-4", "all"},

		// An unknown role is treated as single-branch. Failing closed is the
		// only safe default: a typo in a role name must not hand out every
		// branch.
		{"unknown role is confined", "Something New", 6, "", "branch:6"},
	}

	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			if got := scopeOf(ctxWith(tc.role, tc.own, tc.selected)); got != tc.want {
				t.Errorf("scope = %s, want %s", got, tc.want)
			}
		})
	}
}

// TestBranchScopeFailsClosedWithoutClaims: with no role and no branch on the
// context, the scope must be a branch that matches nothing — never "all".
//
// AuthMiddleware always sets both, so this is defensive. It is worth pinning
// anyway, because the failure mode of getting it wrong is not an error but a
// silent widening: every branch of the business, returned to a request whose
// identity could not be established.
func TestBranchScopeFailsClosedWithoutClaims(t *testing.T) {
	gin.SetMode(gin.TestMode)
	c, _ := gin.CreateTestContext(httptest.NewRecorder())
	c.Request = httptest.NewRequest("GET", "/", nil)

	scope := GetBranchScope(c)
	if scope == nil {
		t.Fatal("scope was nil (all branches) for a request with no claims — must fail closed")
	}
	if *scope != 0 {
		t.Errorf("scope = %d, want 0 (a branch that matches nothing)", *scope)
	}
}

// TestEnforceBranchOnWriteRules covers the write side.
func TestEnforceBranchOnWriteRules(t *testing.T) {
	gin.SetMode(gin.TestMode)

	cases := []struct {
		name      string
		role      string
		own       uint
		selected  string
		submitted uint
		want      uint
	}{
		{"admin writes to the submitted branch", AdministratorRole, 1, "", 9, 9},
		{"management writes to the submitted branch", ManagementRole, 1, "", 9, 9},

		// Submitting nothing while viewing one branch should land the record
		// in the branch being viewed, not in branch zero.
		{"management falls back to the selected branch", ManagementRole, 1, "7", 0, 7},
		{"submitted wins over the selection", ManagementRole, 1, "7", 9, 9},

		// The important rows: a single-branch role's submitted value is
		// discarded, so tampering with a request body cannot move a record
		// into another branch.
		{"cashier cannot write to another branch", "Cashier", 3, "", 9, 3},
		{"cashier cannot write via the header either", "Cashier", 3, "7", 9, 3},
	}

	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			got := EnforceBranchOnWrite(ctxWith(tc.role, tc.own, tc.selected), tc.submitted)
			if got != tc.want {
				t.Errorf("EnforceBranchOnWrite = %d, want %d", got, tc.want)
			}
		})
	}
}
