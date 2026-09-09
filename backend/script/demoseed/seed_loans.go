package demoseed

import (
	"context"
	"fmt"
	"math"

	"cloudhouse/backend/internal/loan"
)

// loanPlan is one loan to create: how far through the sanction chain to take
// it, when it opened and when it is due.
type loanPlan struct {
	// approvals is how many stages of the sanction chain to walk. 0 leaves
	// the loan at LoanOperator; 3 fully sanctions it (which is what makes it
	// Active and disburses it).
	approvals int
	// reject, when set, rejects at the stage reached instead of approving.
	reject bool
	// openedDaysAgo / dueInDays are relative to the reset, which is what
	// keeps the Due Soon, Overdue and Defaulted dashboards meaningful
	// whenever the demo happens.
	openedDaysAgo int
	dueInDays     int
	principal     float64
	// auctionPool marks the loans the auctions step will drive. They must
	// carry NO payments — see the comment on seedPayments.
	auctionPool bool
}

// loanPlans is the shape of the loan book: thirty loans spread across every
// state the Loans screen can show.
//
// The distribution is deliberate rather than random. A demo where every loan
// is Active shows nothing; the point is that the operator can open the Loans
// list and point at a pending approval, a loan due next week, an overdue one
// and an auction candidate without searching for them.
var loanPlans = []loanPlan{
	// Sitting at each stage of the sanction chain, so the approvals queue
	// has work at every level.
	{approvals: 0, openedDaysAgo: 1, dueInDays: 180, principal: 45000},
	{approvals: 0, openedDaysAgo: 2, dueInDays: 180, principal: 62000},
	{approvals: 1, openedDaysAgo: 3, dueInDays: 180, principal: 78000},
	{approvals: 1, openedDaysAgo: 4, dueInDays: 180, principal: 120000},
	{approvals: 2, openedDaysAgo: 5, dueInDays: 180, principal: 95000},
	{approvals: 2, openedDaysAgo: 6, dueInDays: 180, principal: 150000},

	// Active, comfortably inside term.
	{approvals: 3, openedDaysAgo: 20, dueInDays: 300, principal: 85000},
	{approvals: 3, openedDaysAgo: 35, dueInDays: 240, principal: 110000},
	{approvals: 3, openedDaysAgo: 50, dueInDays: 220, principal: 65000},
	{approvals: 3, openedDaysAgo: 60, dueInDays: 190, principal: 140000},
	{approvals: 3, openedDaysAgo: 75, dueInDays: 160, principal: 52000},
	{approvals: 3, openedDaysAgo: 90, dueInDays: 130, principal: 175000},
	{approvals: 3, openedDaysAgo: 100, dueInDays: 110, principal: 98000},
	{approvals: 3, openedDaysAgo: 120, dueInDays: 60, principal: 72000},

	// Due within the week — the Due Soon tile.
	{approvals: 3, openedDaysAgo: 175, dueInDays: 2, principal: 88000},
	{approvals: 3, openedDaysAgo: 178, dueInDays: 4, principal: 132000},
	{approvals: 3, openedDaysAgo: 180, dueInDays: 7, principal: 59000},

	// Past due but not yet defaulted.
	{approvals: 3, openedDaysAgo: 210, dueInDays: -20, principal: 76000},
	{approvals: 3, openedDaysAgo: 240, dueInDays: -40, principal: 105000},
	{approvals: 3, openedDaysAgo: 260, dueInDays: -60, principal: 68000},

	// The auction pool. Opened well over a year ago and more than 200 days
	// past due, so enrichStatusFlags marks them defaulted.
	{approvals: 3, openedDaysAgo: 420, dueInDays: -200, principal: 125000, auctionPool: true},
	{approvals: 3, openedDaysAgo: 425, dueInDays: -205, principal: 92000, auctionPool: true},
	{approvals: 3, openedDaysAgo: 430, dueInDays: -210, principal: 158000, auctionPool: true},
	{approvals: 3, openedDaysAgo: 435, dueInDays: -215, principal: 74000, auctionPool: true},
	{approvals: 3, openedDaysAgo: 440, dueInDays: -220, principal: 186000, auctionPool: true},
	{approvals: 3, openedDaysAgo: 445, dueInDays: -225, principal: 63000, auctionPool: true},
	{approvals: 3, openedDaysAgo: 450, dueInDays: -230, principal: 142000, auctionPool: true},
	{approvals: 3, openedDaysAgo: 455, dueInDays: -235, principal: 97000, auctionPool: true},

	// One rejected during sanction, then the loan that seedPayments settles in
	// full — seedLoanRequests relies on that one being index 29, since a
	// release checklist cannot be completed on a loan that still owes money.
	{approvals: 1, reject: true, openedDaysAgo: 15, dueInDays: 170, principal: 55000},
	{approvals: 3, openedDaysAgo: 150, dueInDays: 40, principal: 48000},

	// Two more for the auction pool, bringing it to ten cases so every
	// auction stage has a pair. Appended rather than inserted: seedLoanRequests
	// refers to index 29 by name.
	{approvals: 3, openedDaysAgo: 460, dueInDays: -240, principal: 118000, auctionPool: true},
	{approvals: 3, openedDaysAgo: 465, dueInDays: -245, principal: 83000, auctionPool: true},
	{approvals: 3, openedDaysAgo: 470, dueInDays: -250, principal: 136000, auctionPool: true},
	{approvals: 3, openedDaysAgo: 475, dueInDays: -255, principal: 79000, auctionPool: true},
	{approvals: 3, openedDaysAgo: 480, dueInDays: -260, principal: 112000, auctionPool: true},
	// Two that go all the way to Settled, one refunding a surplus to the
	// customer and one booking it as income — the two dispositions the
	// settlement screen offers.
	{approvals: 3, openedDaysAgo: 485, dueInDays: -265, principal: 95000, auctionPool: true},
	{approvals: 3, openedDaysAgo: 490, dueInDays: -270, principal: 128000, auctionPool: true},

	// Five active loans that exist to be re-pledged to a bank, so the
	// bank_pledge_records set reaches ten without pledging a loan that is
	// already an extension or release target.
	{approvals: 3, openedDaysAgo: 40, dueInDays: 250, principal: 91000},
	{approvals: 3, openedDaysAgo: 45, dueInDays: 245, principal: 67000},
	{approvals: 3, openedDaysAgo: 55, dueInDays: 235, principal: 124000},
	{approvals: 3, openedDaysAgo: 65, dueInDays: 225, principal: 58000},
	{approvals: 3, openedDaysAgo: 70, dueInDays: 215, principal: 103000},
}

// seedLoans creates the loan book and walks each loan through the sanction
// chain as far as its plan says.
//
// Goes through loan.Service throughout rather than inserting rows, because
// almost everything interesting about a loan is derived: the LN- number, the
// gold valuation against today's rate, the LTV check, the disbursement cash
// movement, the auto-created packet, and the loan_approvals audit trail. A
// direct insert would produce rows that look right in the table and wrong on
// every screen.
func seedLoans(ctx context.Context, d *Deps, st *state, rep *Report) error {
	if len(st.customerIDs) == 0 || len(st.schemeIDs) == 0 {
		return fmt.Errorf("no customers or active schemes to attach loans to")
	}

	// The sanction chain, in order. Walking it by index is what lets a plan
	// say "take this one two stages in".
	chain := []string{
		loan.SanctionStageLoanOperator,
		loan.SanctionStageBranchManager,
		loan.SanctionStageFinalSanction,
	}

	for i, p := range loanPlans {
		in := loan.CreateInput{
			BranchID:        st.branchIDs[i%len(st.branchIDs)],
			CustomerID:      st.customerIDs[i%len(st.customerIDs)],
			SchemeID:        st.schemeIDs[i%len(st.schemeIDs)],
			OpenedDate:      st.clk.daysAgo(p.openedDaysAgo),
			DueDate:         st.clk.daysAhead(p.dueInDays),
			PrincipalAmount: p.principal,
			Ornaments:       ornamentsFor(i, p.principal),
			AdditionalInfo:  "Demo record",
		}
		l, err := d.loanSvc.Create(ctx, in)
		if err != nil {
			return fmt.Errorf("create loan %d: %w", i+1, err)
		}
		st.loanIDs = append(st.loanIDs, l.ID)

		for stage := 0; stage < p.approvals && stage < len(chain); stage++ {
			// The first stage records "Verified", not "Approved": the operator
			// who booked the loan verifies it, and sanctioning happens further
			// up the chain. Both advance the chain identically, but the audit
			// trail reads correctly this way -- and Verified is accepted ONLY at
			// this stage, so it cannot be hoisted out of the loop.
			action := loan.ApprovalStageApproved
			if stage == 0 {
				action = loan.ApprovalActionVerified
			}
			// Reject at the last stage this plan reaches.
			if p.reject && stage == p.approvals-1 {
				action = loan.ApprovalStageRejected
			}
			if _, err := d.loanSvc.Approve(ctx, l.ID, loan.ApprovalInput{
				Stage:           chain[stage],
				Action:          action,
				ActorEmployeeID: st.keep.adminID,
				ActorRole:       "Administrator",
				ActorRoleID:     st.adminRoleID,
				Remarks:         "Demo approval",
			}); err != nil {
				return fmt.Errorf("approve loan %d at %s: %w", i+1, chain[stage], err)
			}
		}
	}

	rep.created("gold loans", len(loanPlans))
	// Every loan gets a packet automatically, because packetCreator is wired.
	rep.created("packets", len(loanPlans))
	return nil
}

// gramsPerRupeeOfPrincipal sizes a loan's pledged gold so the principal
// always clears the scheme's loan-to-value ceiling.
//
// loan.Service.Create values each ornament as netWeight × (K24 × karat/24)
// and then refuses any principal above totalGoldValue × LTV%. Note that
// QUANTITY IS NOT A MULTIPLIER — five 4g rings are valued as 4g, not 20g — so
// picking ornaments from a fixture list by index, as an earlier version did,
// produced loans backed by four grams of gold against a principal of a
// hundred thousand rupees, and every one of them was rejected.
//
// The divisor below is the worst case made safe: the lowest active scheme LTV
// is 65% and the cheapest purity in use is 22K (≈ K24 × 0.917 ≈ 6,800/g at
// the seeded rate), so 1g supports about 4,420 of principal. Dividing by
// 3,400 instead leaves roughly 30% headroom, which keeps the arithmetic
// correct if the rate fixture or the scheme LTVs are edited later. The
// resulting weights stay realistic: a 45,000 loan is backed by about 13g and
// a 200,000 loan by about 59g.
const gramsPerRupeeOfPrincipal = 3400.0

// ornamentsFor returns the pledged items for one loan, sized to its principal.
//
// The first item carries the weight that satisfies the LTV check and is always
// 22K, so the calculation above holds regardless of index. Any additional
// items come from the fixture list for variety — they can only ADD gold value,
// so they can never invalidate the principal.
func ornamentsFor(i int, principal float64) []loan.OrnamentInput {
	// Round to a tenth of a gram: weights are shown to one decimal in the UI,
	// and rounding here keeps the displayed figure and the stored one equal.
	grams := math.Ceil(principal/gramsPerRupeeOfPrincipal*10) / 10

	primary := ornamentFixtures[i%len(ornamentFixtures)]
	out := []loan.OrnamentInput{{
		Name:   primary.Name,
		Purity: "22K",
		// Deduction is the fixture's, so the gross/net split still looks like
		// a real appraisal rather than a round number.
		GrossWeight:     grams + primary.Deduction,
		DeductionWeight: primary.Deduction,
		Quantity:        primary.Quantity,
		Remarks:         "Demo ornament",
	}}

	for j := 1; j < 1+i%3; j++ {
		f := ornamentFixtures[(i+j)%len(ornamentFixtures)]
		out = append(out, loan.OrnamentInput{
			Name:            f.Name,
			Purity:          f.Purity,
			GrossWeight:     f.Gross,
			DeductionWeight: f.Deduction,
			Quantity:        f.Quantity,
			Remarks:         "Demo ornament",
		})
	}
	return out
}

// isAuctionPool reports whether the loan at index i is reserved for the
// auctions step.
func isAuctionPool(i int) bool {
	if i >= len(loanPlans) {
		return false
	}
	return loanPlans[i].auctionPool
}
