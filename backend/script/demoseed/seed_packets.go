package demoseed

import (
	"context"
	"fmt"

	"cloudhouse/backend/internal/loan"
	"cloudhouse/backend/internal/packet"
)

// packetMovePlan walks one loan's packet along a PATH of statuses.
//
// A path rather than a target, because packet.Service enforces a stage graph:
//
//	PacketGenerated -> LockerStored
//	LockerStored    -> BankPledged | Released
//	BankPledged     -> Returned
//	Returned        -> LockerStored | Released
//	Released        (terminal)
//
// A packet therefore cannot be dropped straight into Released from
// PacketGenerated, which is what an earlier version of this file tried to do.
// Walking the hops is also more faithful: each one is a real packet_movements
// row, and those rows are the custody audit trail.
type packetMovePlan struct {
	loanIdx int
	path    []string
}

// packetMovePlans spreads the packets across the custody statuses, so Packets
// & Lockers shows the whole lifecycle rather than thirty rows all reading
// "Packet Generated".
//
// Bank Pledged is NOT here: it is a side effect of recording a bank pledge,
// and forcing it directly would leave a packet claiming to be at a bank with
// no pledge record behind it. See pledgePlans.
var packetMovePlans = []packetMovePlan{
	{6, []string{packet.StatusLockerStored}},
	{7, []string{packet.StatusLockerStored}},
	{8, []string{packet.StatusLockerStored}},
	{9, []string{packet.StatusLockerStored}},
	{10, []string{packet.StatusLockerStored}},
	{11, []string{packet.StatusLockerStored}},
	{12, []string{packet.StatusLockerStored}},
	{13, []string{packet.StatusLockerStored}},
	{14, []string{packet.StatusLockerStored}},
	{15, []string{packet.StatusLockerStored}},
	// Taken all the way out of custody, so Released is represented. NOT the
	// settled loan (29) — that one is the release-request target in
	// seedLoanRequests, and a packet already Released cannot have a release
	// raised against it.
	{16, []string{packet.StatusLockerStored, packet.StatusReleased}},
	{17, []string{packet.StatusLockerStored}},
	{18, []string{packet.StatusLockerStored}},
	{19, []string{packet.StatusLockerStored}},
	{29, []string{packet.StatusLockerStored}},
	// The two auction cases that reach a completed sale. RecordAuctionSale
	// asks packet.Service to release the gold, and that hop is only legal
	// from Locker Stored — left at Packet Generated the release is refused and
	// the sale completes with the packet stranded in the wrong state. It is
	// logged rather than fatal inside loan.Service, so the only symptom would
	// be a warning line nobody reads.
	{26, []string{packet.StatusLockerStored}},
	{27, []string{packet.StatusLockerStored}},
	{35, []string{packet.StatusLockerStored}},
	{36, []string{packet.StatusLockerStored}},
	// Stored so they can be pledged — see pledgePlans.
	{37, []string{packet.StatusLockerStored}},
	{38, []string{packet.StatusLockerStored}},
	{39, []string{packet.StatusLockerStored}},
	{40, []string{packet.StatusLockerStored}},
	{41, []string{packet.StatusLockerStored}},
}

// pledgePlan re-pledges a loan's gold to a bank.
//
// Every target must already be in a locker: RecordBankPledge moves the packet
// to Bank Pledged, and that hop is legal only from Locker Stored. All five
// indices below appear in packetMovePlans.
type pledgePlan struct {
	loanIdx   int
	bankIdx   int
	amount    float64
	daysAgo   int
	treatment string
	// releaseAfter takes the packet on to Returned once pledged. That is the
	// only route to Returned, which would otherwise be the one custody status
	// the demo never shows.
	releaseAfter bool
}

// pledgePlans covers both cash treatments: an advance that lands in the till,
// and one recorded for the paper trail with no cash effect.
var pledgePlans = []pledgePlan{
	{6, 0, 60000, 18, loan.BankPledgeCashTreatmentCashIn, false},
	{8, 1, 45000, 22, loan.BankPledgeCashTreatmentCashIn, false},
	{10, 2, 38000, 26, loan.BankPledgeCashTreatmentCashIn, false},
	{12, 3, 70000, 30, loan.BankPledgeCashTreatmentRecordOnly, false},
	{14, 4, 55000, 34, loan.BankPledgeCashTreatmentRecordOnly, true},
	// The five loans appended to loanPlans purely to be pledged. Kept clear
	// of every extension and release target so no checklist or approval
	// chain trips over gold that is sitting at a bank.
	{37, 5, 62000, 12, loan.BankPledgeCashTreatmentCashIn, false},
	{38, 6, 44000, 15, loan.BankPledgeCashTreatmentCashIn, false},
	{39, 7, 85000, 19, loan.BankPledgeCashTreatmentRecordOnly, false},
	{40, 8, 39000, 24, loan.BankPledgeCashTreatmentCashIn, false},
	{41, 9, 71000, 28, loan.BankPledgeCashTreatmentRecordOnly, false},
}

// seedPacketsAndPledges moves the packets into custody and re-pledges some of
// the gold to banks.
//
// The three phases are ordered by the stage graph, not for tidiness: a bank
// pledge needs its packet already stored, and a packet on its way out of
// custody can no longer be pledged.
func seedPacketsAndPledges(ctx context.Context, d *Deps, st *state, rep *Report) error {
	moves := 0

	// Phase 1 — into the locker.
	for i, p := range packetMovePlans {
		n, err := walkPacket(ctx, d, st, p.loanIdx, firstHop(p.path), i)
		if err != nil {
			return err
		}
		moves += n
	}

	// Phase 2 — bank pledges, which need a stored packet.
	actor := st.keep.adminID
	pledges := 0
	for _, p := range pledgePlans {
		if p.loanIdx >= len(st.loanIDs) || p.bankIdx >= len(bankFixtures) {
			continue
		}
		f := bankFixtures[p.bankIdx]
		due := st.clk.daysAhead(120)
		if _, err := d.loanSvc.RecordBankPledge(ctx, st.loanIDs[p.loanIdx], nil, loan.BankPledgeInput{
			BankName:          f.Name,
			PledgedAmount:     p.amount,
			PledgeDate:        st.clk.daysAgo(p.daysAgo),
			BankInterestRate:  9.5,
			ReferenceNumber:   fmt.Sprintf("BP-DEMO-%02d", p.loanIdx),
			BankPledgeDueDate: &due,
			CashTreatment:     p.treatment,
			ActorEmployeeID:   &actor,
			ActorRole:         "Administrator",
		}); err != nil {
			return fmt.Errorf("record bank pledge on loan index %d: %w", p.loanIdx, err)
		}
		pledges++

		if p.releaseAfter {
			n, err := walkPacket(ctx, d, st, p.loanIdx, []string{packet.StatusReturned}, 0)
			if err != nil {
				return err
			}
			moves += n
		}
	}
	rep.created("bank pledges", pledges)

	// Phase 3 — the remaining hops towards release.
	for i, p := range packetMovePlans {
		n, err := walkPacket(ctx, d, st, p.loanIdx, remainingHops(p.path), i)
		if err != nil {
			return err
		}
		moves += n
	}

	rep.created("packet movements", moves)
	return nil
}

func firstHop(path []string) []string {
	if len(path) == 0 {
		return nil
	}
	return path[:1]
}

func remainingHops(path []string) []string {
	if len(path) < 2 {
		return nil
	}
	return path[1:]
}

// walkPacket moves one loan's packet through the given hops, assigning a
// locker on the hop that needs one.
func walkPacket(ctx context.Context, d *Deps, st *state, loanIdx int, hops []string, lockerSeed int) (int, error) {
	if len(hops) == 0 || loanIdx >= len(st.loanIDs) {
		return 0, nil
	}
	pk, err := d.packetRepo.FindActiveByLoanID(ctx, st.loanIDs[loanIdx])
	if err != nil {
		// A rejected loan may have no active packet. Skipping is right — the
		// dataset does not depend on this particular one existing.
		return 0, nil
	}

	moved := 0
	for _, status := range hops {
		var lockerID *uint
		if status == packet.StatusLockerStored && len(st.lockerIDs) > 0 {
			id := st.lockerIDs[lockerSeed%len(st.lockerIDs)]
			lockerID = &id
		}
		if _, err := d.packetSvc.RecordMovement(ctx, pk.ID, status, lockerID, st.keep.adminID, "Demo movement"); err != nil {
			return moved, fmt.Errorf("move packet for loan index %d to %q: %w", loanIdx, status, err)
		}
		moved++
	}
	return moved, nil
}
