package demoseed

import (
	"context"
	"fmt"

	"cloudhouse/backend/internal/loan"
)

// seedLoanRequests creates extension and release requests at various points
// in their approval chains, so the Extensions & Release queue has work at
// every stage rather than being empty.
func seedLoanRequests(ctx context.Context, d *Deps, st *state, rep *Report) error {
	// Extensions: two left pending at the first stage, two advanced one
	// stage, one fully approved.
	extensionTargets := []int{6, 7, 8, 9, 10}
	created := 0
	for n, idx := range extensionTargets {
		if idx >= len(st.loanIDs) {
			continue
		}
		req, err := d.loanSvc.CreateExtensionRequest(ctx, st.loanIDs[idx], loan.ExtensionRequestInput{
			Months:      3,
			Detail:      "Customer requested additional time",
			RequestedBy: loan.RequestedByStaff,
		})
		if err != nil {
			return fmt.Errorf("create extension request on loan index %d: %w", idx, err)
		}
		created++

		// n<2 stay at PendingLoanOfficer. The rest advance.
		// The SHORT labels from loan.extensionChain, not the Pending* values
		// of LoanRequest.ApprovalStage: ApproveExtensionRequest matches
		// in.Stage against chain.Stage, and passing the ApprovalStage instead
		// fails with ErrWrongStage.
		stages := []string{"LoanOfficer", "BranchManager", "Management"}
		// One request left untouched at each depth, so the queue shows work
		// at every stage AND request_approvals ends up with a real history
		// rather than a couple of rows. Capped at the chain length.
		advance := n
		if advance > len(stages) {
			advance = len(stages)
		}
		for s := 0; s < advance && s < len(stages); s++ {
			if _, err := d.loanSvc.ApproveExtensionRequest(ctx, req.ID, nil, loan.ExtensionApprovalInput{
				Stage:           stages[s],
				Action:          loan.ApprovalStageApproved,
				ActorEmployeeID: st.keep.adminID,
				ActorRole:       "Administrator",
				ActorRoleID:     st.adminRoleID,
				Remarks:         "Demo approval",
			}); err != nil {
				return fmt.Errorf("advance extension request on loan index %d: %w", idx, err)
			}
		}
	}

	// Releases. Only ONE can reach the approval chain, and which one is not a
	// free choice: VerifyReleaseChecklist refuses to set PaymentVerified while
	// the loan still owes anything, and the chain cannot start until the whole
	// checklist is complete. The last loan in the book is the one closed by a
	// full settlement in seedPayments, so it is the only eligible candidate.
	//
	// The rest stay part-verified, which is a real and common state — a request
	// raised, the gold and paperwork checked, waiting on the customer to clear
	// the balance. It also means the Extensions & Release queue shows work at
	// every stage rather than one row at the end.
	const settledLoanIdx = 29
	// None of these may be a pledgePlans target: VerifyReleaseChecklist also
	// refuses BankPledgeVerified while the gold is still with a bank. Loans
	// 6, 8, 10, 12 and 14 are pledged, so they are excluded.
	releaseTargets := []int{11, 13, 15, 17, settledLoanIdx}
	yes := true
	for n, idx := range releaseTargets {
		if idx >= len(st.loanIDs) {
			continue
		}
		req, err := d.loanSvc.CreateReleaseRequest(ctx, st.loanIDs[idx], loan.ReleaseRequestInput{
			Detail:      "Customer requested release of pledged gold",
			RequestedBy: loan.RequestedByStaff,
		})
		if err != nil {
			return fmt.Errorf("create release request on loan index %d: %w", idx, err)
		}
		created++
		if n < 2 {
			continue
		}

		notes := "Demo verification"
		check := loan.ChecklistInput{
			PacketVerified:     &yes,
			BankPledgeVerified: &yes,
			CustomerConfirmed:  &yes,
			VerificationNotes:  &notes,
			ActorRoleID:        st.adminRoleID,
		}
		// Payment leg only on the settled loan — see this block's comment.
		if idx == settledLoanIdx {
			check.PaymentVerified = &yes
		}
		if _, err := d.loanSvc.VerifyReleaseChecklist(ctx, req.ID, nil, check); err != nil {
			return fmt.Errorf("verify release checklist on loan index %d: %w", idx, err)
		}
		if idx != settledLoanIdx {
			continue
		}

		// Short labels, per ReleaseApprovalInput.Stage.
		for _, stage := range []string{"Manager", "Management"} {
			if _, err := d.loanSvc.ApproveReleaseRequest(ctx, req.ID, nil, loan.ReleaseApprovalInput{
				Stage:           stage,
				Action:          loan.ApprovalStageApproved,
				ActorEmployeeID: st.keep.adminID,
				ActorRoleID:     st.adminRoleID,
				Remarks:         "Demo approval",
			}); err != nil {
				return fmt.Errorf("approve release request on loan index %d: %w", idx, err)
			}
		}
	}

	rep.created("loan requests", created)
	return nil
}

// auctionPlan drives one defaulted loan to a particular auction stage.
type auctionPlan struct {
	loanIdx int
	stage   string
	// saleAmount is used by the Auctioned and Settled stages. Set above the
	// outstanding balance to produce a surplus, below it for a shortfall —
	// both branches of the settlement logic are worth demonstrating.
	saleAmount  float64
	disposition string
}

// auctionPlans walks two loans to each auction stage, so the Auctions screen
// shows the whole pipeline at once.
var auctionPlans = []auctionPlan{
	{20, loan.AuctionStageEligible, 0, ""},
	{21, loan.AuctionStageEligible, 0, ""},
	{22, loan.AuctionStageNotice, 0, ""},
	{23, loan.AuctionStageNotice, 0, ""},
	{24, loan.AuctionStageScheduled, 0, ""},
	{25, loan.AuctionStageScheduled, 0, ""},
	{26, loan.AuctionStageAuctioned, 200000, ""}, // surplus
	{27, loan.AuctionStageAuctioned, 60000, ""},  // shortfall
	{30, loan.AuctionStageEligible, 0, ""},
	{31, loan.AuctionStageNotice, 0, ""},
	// Three more at Notice, which is what takes auction_notices past ten —
	// the two Eligible cases deliberately have no notice yet.
	{32, loan.AuctionStageNotice, 0, ""},
	{33, loan.AuctionStageNotice, 0, ""},
	{34, loan.AuctionStageNotice, 0, ""},
	// Two more completed sales, one clearing the debt with a large surplus and
	// one short of it.
	//
	// NOT taken on to Settled. RecordAuctionSale settles a case itself when the
	// proceeds leave no surplus to decide about, so whether a manual settlement
	// is still possible depends on the exact arrears at sale time — which move
	// with the calendar. Rather than tune sale prices against accrued interest
	// on every reset, the pipeline is seeded up to Auctioned and the operator
	// settles one live, which demos the surplus-disposition screen better than a
	// pre-settled row would anyway. Settled and Withdrawn are therefore the two
	// auction stages this seeder deliberately does not produce.
	{35, loan.AuctionStageAuctioned, 400000, ""},
	{36, loan.AuctionStageAuctioned, 90000, ""},
}

// seedAuctions drives the defaulted loans through the auction pipeline.
//
// Every transition goes through loan.Service, which is why permChecker had to
// be real: each step is permission-gated, and a nil checker fails closed.
func seedAuctions(ctx context.Context, d *Deps, st *state, rep *Report) error {
	actor := st.keep.adminID
	role := "Administrator"
	n := 0

	for _, p := range auctionPlans {
		if p.loanIdx >= len(st.loanIDs) {
			continue
		}
		id := st.loanIDs[p.loanIdx]

		if _, err := d.loanSvc.MarkAuctionEligible(ctx, id, nil, &actor, role, st.adminRoleID); err != nil {
			return fmt.Errorf("mark loan index %d auction eligible: %w", p.loanIdx, err)
		}
		n++
		if p.stage == loan.AuctionStageEligible {
			continue
		}

		if _, err := d.loanSvc.IssueAuctionNotice(ctx, id, nil, "Demo statutory notice", &actor, role, st.adminRoleID); err != nil {
			return fmt.Errorf("issue auction notice on loan index %d: %w", p.loanIdx, err)
		}
		if p.stage == loan.AuctionStageNotice {
			continue
		}

		// Scheduled auctions sit in the future so the calendar shows them;
		// an auction that has already happened is dated in the past.
		when := st.clk.daysAhead(10 + p.loanIdx%14)
		if p.stage == loan.AuctionStageAuctioned {
			when = st.clk.daysAgo(9)
		}
		if _, err := d.loanSvc.ScheduleAuction(ctx, id, nil, when, fmt.Sprintf("AUC-DEMO-%02d", p.loanIdx), &actor, role, st.adminRoleID); err != nil {
			return fmt.Errorf("schedule auction on loan index %d: %w", p.loanIdx, err)
		}
		if p.stage == loan.AuctionStageScheduled {
			continue
		}

		if _, err := d.loanSvc.RecordAuctionSale(ctx, id, nil, p.saleAmount, 2500, &actor, role, st.adminRoleID); err != nil {
			return fmt.Errorf("record auction sale on loan index %d: %w", p.loanIdx, err)
		}
	}

	rep.created("auction records", n)
	return nil
}
