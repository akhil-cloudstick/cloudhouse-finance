package controllers

import (
	"cloudhouse/backend/modules/Loan/models"
	"strings"
	"testing"
)

func TestComputeSaleOutcome(t *testing.T) {
	cases := []struct {
		name                       string
		sale, exp, debt            float64
		applied, surplus, shortage float64
		covered                    bool
	}{
		{"surplus", 120000, 2000, 100000, 100000, 18000, 0, true},
		{"exact", 102000, 2000, 100000, 100000, 0, 0, true},
		{"within a paisa", 100000, 0, 100000.005, 100000, 0, 0, true},
		{"shortfall", 80000, 5000, 100000, 75000, 0, 25000, false},
	}
	for _, c := range cases {
		o := computeSaleOutcome(c.sale, c.exp, c.debt)
		if o.Applied != c.applied || o.Surplus != c.surplus || o.Shortfall != c.shortage || o.Covered != c.covered {
			t.Errorf("%s: got %+v", c.name, o)
		}
	}
	if o := computeSaleOutcome(80000, 5000, 100000); o.Diff != -25000 {
		t.Errorf("signed difference: %v", o.Diff)
	}
}

func TestPlanCase(t *testing.T) {
	covered := computeSaleOutcome(120000, 0, 100000)
	if p := planCase(covered, "", false, "", false); p.Stage != models.AuctionStageAuctioned || p.LoanStatus != models.StatusAuctioned || p.DecisionStatus != "" {
		t.Errorf("covered with surplus: %+v", p)
	}
	if p := planCase(covered, "", true, AuctionSurplusRefundedToCustomer, false); p.Stage != models.AuctionStageSettled || p.Final != auctionFinalToCustomer {
		t.Errorf("settled surplus kept: %+v", p)
	}
	exact := computeSaleOutcome(100000, 0, 100000)
	if p := planCase(exact, "", false, "", false); p.Stage != models.AuctionStageSettled || p.Final != auctionFinalToLoanCo {
		t.Errorf("exact: %+v", p)
	}
	short := computeSaleOutcome(60000, 0, 100000)
	if p := planCase(short, "", false, "", false); p.DecisionStatus != AuctionDecisionPending || p.LoanStatus != models.StatusAuctionedBalanceDue || p.Stage != models.AuctionStageAuctioned {
		t.Errorf("new shortfall, manual: %+v", p)
	}
	if p := planCase(short, "", false, "", true); p.DecisionStatus != decisionStatusPursue || p.LoanStatus != models.StatusOverdue || p.Stage != models.AuctionStageWithdrawn {
		t.Errorf("new shortfall, auto pursue: %+v", p)
	}
	if p := planCase(short, decisionStatusWriteOff, false, "", false); p.LoanStatus != models.StatusClosed || p.Final != auctionFinalWrittenOff {
		t.Errorf("written off: %+v", p)
	}
}

func TestDetectDependents(t *testing.T) {
	short := computeSaleOutcome(60000, 0, 100000)
	covered := computeSaleOutcome(120000, 0, 100000)

	// nothing booked after the sale: nothing is affected
	if d := detectDependents(auctionSnapshot{}, short, 0, false); len(d) != 0 {
		t.Errorf("no dependents expected: %+v", d)
	}
	// a settled surplus whose amount changes
	snap := auctionSnapshot{RecordID: 7, SurplusDisposition: AuctionSurplusRefundedToCustomer, SurplusAmount: 15000}
	d := detectDependents(snap, covered, 0, false)
	if len(d) != 1 || d[0].Kind != DependentSurplusSettlement || !d[0].Required || d[0].ID != 7 {
		t.Errorf("surplus settlement: %+v", d)
	}
	// ... and one whose amount does not change is left alone
	snap.SurplusAmount = 20000
	if d := detectDependents(snap, covered, 0, false); len(d) != 0 {
		t.Errorf("unchanged surplus: %+v", d)
	}
	// a pending decision whose shortfall changes is required, a pursued one is optional
	pend := auctionSnapshot{Decision: &decisionSnap{ID: 3, Status: AuctionDecisionPending, AmountPaid: 70000, Outstanding: 30000}}
	if d := detectDependents(pend, short, 0, false); len(d) != 1 || !d[0].Required {
		t.Errorf("pending decision: %+v", d)
	}
	pursue := auctionSnapshot{Decision: &decisionSnap{ID: 3, Status: decisionStatusPursue, AmountPaid: 70000, Outstanding: 30000}}
	if d := detectDependents(pursue, short, 0, false); len(d) != 1 || d[0].Required {
		t.Errorf("pursued decision: %+v", d)
	}
	// the sale now covers the loan: the decision and the write-off go
	wo := auctionSnapshot{Decision: &decisionSnap{ID: 3, Status: decisionStatusWriteOff, AmountPaid: 70000, Outstanding: 30000}, WriteOff: &writeOffSnap{ID: 9, Amount: 30000}}
	d = detectDependents(wo, covered, 0, false)
	if len(d) != 2 || !strings.Contains(d[0].Suggested, "Remove") || !strings.Contains(d[1].Suggested, "Remove") {
		t.Errorf("covered after write-off: %+v", d)
	}
	// a write-off that must change amount
	d = detectDependents(wo, computeSaleOutcome(65000, 0, 100000), 35000, false)
	if len(d) != 2 || d[1].Kind != DependentWriteOff || d[1].Required != true {
		t.Errorf("write-off amount: %+v", d)
	}
	// undoing the sale lists everything booked from it
	all := auctionSnapshot{SurplusDisposition: "RecordedAsIncome", SurplusAmount: 5, Decision: wo.Decision, WriteOff: wo.WriteOff}
	if d := detectDependents(all, saleOutcome{}, 0, true); len(d) != 3 {
		t.Errorf("undo: %+v", d)
	}
}

func TestMissingRequired(t *testing.T) {
	deps := []AuctionDependent{
		{Kind: DependentSurplusSettlement, ID: 7, Required: true},
		{Kind: DependentShortfallDecision, ID: 3, Required: false},
		{Kind: DependentWriteOff, ID: 9, Required: true},
	}
	m := missingRequired(deps, []AppliedDependent{{Kind: DependentWriteOff, ID: 9}})
	if len(m) != 1 || m[0].Kind != DependentSurplusSettlement {
		t.Errorf("missing: %+v", m)
	}
	if m := missingRequired(deps, []AppliedDependent{{Kind: DependentSurplusSettlement, ID: 7}, {Kind: DependentWriteOff, ID: 9}}); len(m) != 0 {
		t.Errorf("all chosen: %+v", m)
	}
	if !strings.Contains(missingMessage(deps[:1]), "must be updated") {
		t.Error("message should explain what must be updated")
	}
}
