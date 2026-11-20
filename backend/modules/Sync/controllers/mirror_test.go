package controllers

import (
	"strings"
	"testing"

	"cloudhouse/backend/common/mirror"
	"cloudhouse/backend/config"
	loan "cloudhouse/backend/modules/Loan/controllers"
)

func TestEveryMirroredTableIsTenantScoped(t *testing.T) {
	ts, err := mirror.Tables()
	if err != nil {
		t.Fatal(err)
	}
	for _, tb := range ts {
		if tb.Name == "permissions" {
			continue // the permission catalogue is the same for every business
		}
		if !config.IsTenantScoped(tb.Name) {
			t.Errorf("%s is served to PCs but is not in the tenant scope list", tb.Name)
		}
	}
}

func TestBranchlessTablesFollowTheirParent(t *testing.T) {
	branch := uint(3)
	for _, name := range []string{"reminders", "investment_payouts", "personal_loan_payments", "loan_cash_sources"} {
		sql, args := visibleFilter(mirror.ByName(name), &branch)
		if sql == "" || len(args) == 0 {
			t.Errorf("%s must be limited to the caller's branch, got %q", name, sql)
		}
	}
}

func TestVisibleFilterFollowsTheBranchRule(t *testing.T) {
	branch := uint(7)
	if sql, _ := visibleFilter(mirror.ByName("loans"), nil); sql != "" {
		t.Errorf("a role that sees every branch must get no filter, got %q", sql)
	}
	sql, args := visibleFilter(mirror.ByName("loans"), &branch)
	if !strings.Contains(sql, "branch_id") || len(args) != 1 {
		t.Errorf("loans: %q %v", sql, args)
	}
	// a child row is visible when its parent is: ornament images follow ornaments, which follow loans
	sql, args = visibleFilter(mirror.ByName("ornament_images"), &branch)
	if !strings.Contains(sql, "FROM ornaments") || !strings.Contains(sql, "FROM loans") || len(args) != 1 {
		t.Errorf("ornament_images: %q %v", sql, args)
	}
	// customers also include those with a loan in the branch
	sql, args = visibleFilter(mirror.ByName("customers"), &branch)
	if !strings.Contains(sql, "FROM loans") || len(args) != 2 {
		t.Errorf("customers: %q %v", sql, args)
	}
	// reference data with no branch is for everyone
	if sql, _ := visibleFilter(mirror.ByName("roles"), &branch); sql != "" {
		t.Errorf("roles must not be filtered, got %q", sql)
	}
}

func TestIDListLimits(t *testing.T) {
	if ids, ok := idList("1,2, 3"); !ok || len(ids) != 3 {
		t.Errorf("idList = %v %v", ids, ok)
	}
	if _, ok := idList("1,x"); ok {
		t.Error("a non-number id must be refused")
	}
	long := strings.Repeat("1,", mirrorMaxIDs) + "1"
	if _, ok := idList(long); ok {
		t.Error("more than the limit of ids must be refused")
	}
}

func TestAnEmptyTableIsAnEmptyListNotNull(t *testing.T) {
	if got := plain(nil); got == nil || len(got) != 0 {
		t.Errorf("plain(nil) = %#v, want an empty non-nil list so it is sent as []", got)
	}
}

func TestScopeLabelNamesTheViewTheAnswerCovers(t *testing.T) {
	if got := loan.ScopeLabel(nil); got != "all" {
		t.Errorf("every branch = %q, want all", got)
	}
	b := uint(4)
	if got := loan.ScopeLabel(&b); got != "branch:4" {
		t.Errorf("one branch = %q, want branch:4", got)
	}
}
