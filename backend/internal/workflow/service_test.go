package workflow

import "testing"

func TestChainSkipsDisabledStages(t *testing.T) {
	f, _ := FindFlow(FlowLoanSanction)
	c := NewChain(f, map[string]bool{"BranchManager": false})

	first, ok := c.First()
	if !ok || first.Key != "LoanOperator" {
		t.Fatalf("first = %v %v, want LoanOperator", first.Key, ok)
	}
	next, ok := c.Next("LoanOperator")
	if !ok || next.Key != "FinalSanction" {
		t.Fatalf("next(LoanOperator) = %v %v, want FinalSanction", next.Key, ok)
	}
	if !c.IsFinal("FinalSanction") {
		t.Fatal("FinalSanction should be final")
	}
	// A loan parked on the disabled stage still moves forward.
	if next, ok := c.Next("BranchManager"); !ok || next.Key != "FinalSanction" {
		t.Fatalf("next(BranchManager) = %v %v, want FinalSanction", next.Key, ok)
	}
}

func TestChainSingleStageIsFinal(t *testing.T) {
	f, _ := FindFlow(FlowLoanSanction)
	c := NewChain(f, map[string]bool{"BranchManager": false, "FinalSanction": false})
	if !c.IsFinal("LoanOperator") {
		t.Fatal("LoanOperator should be final when it is the only stage")
	}
}

func TestChainOff(t *testing.T) {
	f, _ := FindFlow(FlowLoanExtension)
	c := NewChain(f, map[string]bool{"LoanOfficer": false, "BranchManager": false, "Management": false})
	if !c.Off() {
		t.Fatal("chain should be off")
	}
	if _, ok := c.First(); ok {
		t.Fatal("First should report no stage")
	}
}

func TestDefaults(t *testing.T) {
	for _, tc := range []struct {
		flow string
		off  bool
	}{
		{FlowLoanSanction, false}, {FlowLoanExtension, false}, {FlowLoanRelease, false},
		{FlowAuctionPartialRepayment, false}, {FlowAuctionShortfall, false},
		{FlowExpense, true}, {FlowLoanTopUp, true}, {FlowLoanWaiver, false}, {FlowPersonalLoan, true},
	} {
		f, ok := FindFlow(tc.flow)
		if !ok {
			t.Fatalf("flow %s missing", tc.flow)
		}
		if got := NewChain(f, nil).Off(); got != tc.off {
			t.Errorf("%s default off = %v, want %v", tc.flow, got, tc.off)
		}
	}
}
