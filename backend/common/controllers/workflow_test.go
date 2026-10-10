package controllers

import (
	commonModels "cloudhouse/backend/common/models"
	"testing"
)

var (
	roleOperator   = commonModels.RoleRow{ID: 3, Name: "Loan Operator", IsActive: true}
	roleBranch     = commonModels.RoleRow{ID: 5, Name: "Branch Manager", IsActive: true}
	roleManagement = commonModels.RoleRow{ID: 7, Name: "Management", IsActive: true}
)

func snapWith(roles ...commonModels.RoleRow) *snapshot {
	snap := &snapshot{
		shared: map[string]bool{}, chains: map[string]string{}, legacy: map[string]map[string]bool{},
		byID: map[uint]commonModels.RoleRow{}, byName: map[string]commonModels.RoleRow{}, hasChain: map[string]bool{},
	}
	for _, r := range roles {
		snap.byID[r.ID] = r
		snap.byName[r.Name] = r
	}
	return snap
}

func TestChainWalksRolesInOrder(t *testing.T) {
	f, _ := FindFlow(FlowLoanSanction)
	c := NewChain(f, []commonModels.RoleRow{roleBranch, roleOperator})
	first, ok := c.First()
	if !ok || first.Key != "R5" || first.RoleID != 5 || first.Label != "Branch Manager" {
		t.Fatalf("first = %+v %v, want R5 Branch Manager", first, ok)
	}
	next, ok := c.Next("R5")
	if !ok || next.Key != "R3" {
		t.Fatalf("next(R5) = %v %v, want R3", next.Key, ok)
	}
	if !c.IsFinal("R3") {
		t.Fatal("R3 should be final")
	}
}

func TestChainSkipsInactiveRoles(t *testing.T) {
	f, _ := FindFlow(FlowLoanTopUp)
	inactive := roleBranch
	inactive.IsActive = false
	c := NewChain(f, []commonModels.RoleRow{inactive, roleManagement})
	if first, _ := c.First(); first.Key != "R7" {
		t.Fatalf("first = %v, want R7", first.Key)
	}
}

func TestChainLegacyValuesResolve(t *testing.T) {
	f, _ := FindFlow(FlowLoanExtension)
	c := NewChain(f, []commonModels.RoleRow{roleBranch, roleManagement})
	if st, ok := c.ByPending("PendingLoanOfficer"); !ok || st.Key != "R5" {
		t.Fatalf("PendingLoanOfficer -> %v %v, want R5", st.Key, ok)
	}
	if st, ok := c.ByPending("PendingManagement"); !ok || st.Key != "R7" {
		t.Fatalf("PendingManagement -> %v %v, want R7", st.Key, ok)
	}
	if st, ok := c.ByPending("R99"); !ok || st.Key != "R5" {
		t.Fatalf("R99 -> %v %v, want R5", st.Key, ok)
	}
	for _, v := range []string{"Approved", "Rejected"} {
		if st, ok := c.ByPending(v); ok {
			t.Fatalf("%s -> %v, want no stage", v, st.Key)
		}
	}
	// Exact never falls back.
	if _, ok := c.Exact("PendingManagement"); ok {
		t.Fatal("Exact should not resolve a legacy value")
	}
}

func TestChainOff(t *testing.T) {
	f, _ := FindFlow(FlowLoanExtension)
	c := NewChain(f, nil)
	if !c.Off() {
		t.Fatal("chain should be off")
	}
	if _, ok := c.First(); ok {
		t.Fatal("First should report no stage")
	}
	if _, ok := c.ByPending("PendingManagement"); ok {
		t.Fatal("an empty chain resolves no stage")
	}
}

func TestLegacyDefaults(t *testing.T) {
	snap := snapWith(roleOperator, roleBranch, roleManagement)
	for _, tc := range []struct {
		flow string
		want []uint
	}{
		{FlowLoanSanction, []uint{3, 5, 7}},
		{FlowLoanExtension, []uint{3, 5, 7}},
		{FlowLoanRelease, []uint{5, 7}},
		{FlowAuctionPartialRepayment, []uint{5}},
		{FlowAuctionShortfall, []uint{7}},
		{FlowExpense, nil},
		{FlowLoanTopUp, nil},
		{FlowPersonalLoan, nil},
	} {
		f, _ := FindFlow(tc.flow)
		got := snap.effectiveIDs(f)
		if joinIDs(got) != joinIDs(tc.want) {
			t.Errorf("%s default = %v, want %v", tc.flow, got, tc.want)
		}
	}
}

func TestLegacyStageSettingsApply(t *testing.T) {
	snap := snapWith(roleOperator, roleBranch, roleManagement)
	snap.legacy[FlowLoanSanction] = map[string]bool{"BranchManager": false}
	f, _ := FindFlow(FlowLoanSanction)
	if got := joinIDs(snap.effectiveIDs(f)); got != "3,7" {
		t.Fatalf("sanction = %s, want 3,7", got)
	}
}

func TestSharedCategoryChain(t *testing.T) {
	snap := snapWith(roleOperator, roleBranch, roleManagement)
	snap.chains[FlowLoanExtension] = "7"
	snap.hasChain[FlowLoanExtension] = true
	snap.chains[sharedScope(CategoryGoldLoan)] = "5,7"
	snap.hasChain[sharedScope(CategoryGoldLoan)] = true
	ext, _ := FindFlow(FlowLoanExtension)
	if got := joinIDs(snap.effectiveIDs(ext)); got != "7" {
		t.Fatalf("per-action extension = %s, want 7", got)
	}
	snap.shared[CategoryGoldLoan] = true
	for _, f := range FlowsOf(CategoryGoldLoan) {
		if got := joinIDs(snap.effectiveIDs(f)); got != "5,7" {
			t.Errorf("shared %s = %s, want 5,7", f.Key, got)
		}
	}
	pl, _ := FindFlow(FlowPersonalLoan)
	if got := snap.effectiveIDs(pl); len(got) != 0 {
		t.Errorf("personal loan = %v, want empty", got)
	}
}

func TestValidate(t *testing.T) {
	inactive := commonModels.RoleRow{ID: 9, Name: "Auditor", IsActive: false}
	snap := snapWith(roleBranch, roleManagement, inactive)
	for _, tc := range []struct {
		name     string
		ids      []uint
		min, max int
		ok       bool
	}{
		{"valid", []uint{5, 7}, 1, 0, true},
		{"empty allowed", nil, 0, 0, true},
		{"below min", nil, 1, 0, false},
		{"above max", []uint{5, 7}, 0, 1, false},
		{"duplicate", []uint{5, 5}, 0, 0, false},
		{"unknown role", []uint{42}, 0, 0, false},
		{"inactive role", []uint{9}, 0, 0, false},
	} {
		if err := snap.validate("Flow", tc.ids, tc.min, tc.max); (err == nil) != tc.ok {
			t.Errorf("%s: err = %v, want ok=%v", tc.name, err, tc.ok)
		}
	}
}

func TestLimitsAreStrictest(t *testing.T) {
	minSteps, maxSteps := limits(FlowsOf(CategoryGoldLoan))
	if minSteps != 1 || maxSteps != 0 {
		t.Fatalf("gold loan limits = %d,%d, want 1,0", minSteps, maxSteps)
	}
	if _, maxSteps := limits(FlowsOf(CategoryAuction)); maxSteps != 1 {
		t.Fatalf("auction max = %d, want 1", maxSteps)
	}
}

func TestEveryFlowHasACategory(t *testing.T) {
	for _, f := range WorkflowCatalogue {
		if _, ok := FindCategory(f.Category); !ok {
			t.Errorf("flow %s has unknown category %q", f.Key, f.Category)
		}
	}
}
