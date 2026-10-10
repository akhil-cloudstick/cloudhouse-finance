package auth

import (
	"context"
	"net/http/httptest"
	"testing"

	"github.com/labstack/echo/v4"
)

var testRoleIDs = map[string]uint{"Administrator": 1, "Management": 2}

func init() {
	IsAllowed = func(ctx context.Context, roleID uint, permissionName string) (bool, error) {
		return permissionName == CrossBranchPermission && (roleID == 1 || roleID == 2), nil
	}
}

func ctxWith(role string, ownBranch uint, selectedHeader string) echo.Context {
	req := httptest.NewRequest("GET", "/", nil)
	if selectedHeader != "" {
		req.Header.Set(SelectedBranchHeader, selectedHeader)
	}
	c := echo.New().NewContext(req, httptest.NewRecorder())
	roleID, ok := testRoleIDs[role]
	if !ok {
		roleID = 99
	}
	c.Set("role", role)
	c.Set("roleId", roleID)
	c.Set("branchId", ownBranch)
	return c
}

func scopeOf(c echo.Context) string {
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

func TestBranchScopeRules(t *testing.T) {
	cases := []struct {
		name     string
		role     string
		own      uint
		selected string
		want     string
	}{
		{"administrator sees all branches", "Administrator", 1, "", "all"},
		{"management sees all branches", "Management", 1, "", "all"},
		{"administrator narrows to a branch", "Administrator", 1, "7", "branch:7"},
		{"management narrows to a branch", "Management", 1, "7", "branch:7"},
		{"cashier is pinned to its own branch", "Cashier", 3, "", "branch:3"},
		{"cashier cannot select another branch", "Cashier", 3, "7", "branch:3"},
		{"branch manager cannot select another branch", "Branch Manager", 4, "9", "branch:4"},
		{"auditor cannot select another branch", "Auditor", 5, "1", "branch:5"},
		{"garbage selection falls back to all", "Management", 1, "not-a-number", "all"},
		{"zero selection falls back to all", "Management", 1, "0", "all"},
		{"negative selection falls back to all", "Management", 1, "-4", "all"},
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

func TestBranchScopeFailsClosedWithoutClaims(t *testing.T) {
	c := echo.New().NewContext(httptest.NewRequest("GET", "/", nil), httptest.NewRecorder())
	scope := GetBranchScope(c)
	if scope == nil {
		t.Fatal("scope was nil (all branches) for a request with no claims — must fail closed")
	}
	if *scope != 0 {
		t.Errorf("scope = %d, want 0 (a branch that matches nothing)", *scope)
	}
}

func TestEnforceBranchOnWriteRules(t *testing.T) {
	cases := []struct {
		name      string
		role      string
		own       uint
		selected  string
		submitted uint
		want      uint
	}{
		{"admin writes to the submitted branch", "Administrator", 1, "", 9, 9},
		{"management writes to the submitted branch", "Management", 1, "", 9, 9},
		{"management falls back to the selected branch", "Management", 1, "7", 0, 7},
		{"submitted wins over the selection", "Management", 1, "7", 9, 9},
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
