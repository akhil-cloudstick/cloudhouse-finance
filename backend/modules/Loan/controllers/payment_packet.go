package controllers

import (
	"cloudhouse/backend/modules/Loan/models"
	packet "cloudhouse/backend/modules/Packet/controllers"
	"context"
	"log"
)

// A repayment correction can reopen a loan that had been closed and its gold released. The preview then offers to put
// the packet back where it was; the staff member decides, and the choice is never blocked by how far the packet has
// moved (see packet.ReverseToPrevious).

var servicingStatuses = map[string]bool{
	models.StatusActive: true, models.StatusDueSoon: true, models.StatusOverdue: true,
}

// packetReversalOffer is the packet move to offer for an edit with this effect on the loan, or nil.
func packetReversalOffer(ctx context.Context, loanID uint, res *EditPaymentResult) *packet.ReversalPreview {
	prev, err := packet.PreviewReversal(ctx, loanID)
	if err != nil {
		log.Printf("packet reversal preview failed for loan %d: %v", loanID, err)
		return nil
	}
	if prev == nil {
		return nil
	}
	statusChanged := res.Before.Status != res.After.Status
	reopened := prev.CurrentStatus == "Released" && servicingStatuses[res.After.Status]
	if !statusChanged && !reopened {
		return nil
	}
	return prev
}

// applyPacketReversal attaches the offer to res and, when the staff member chose it and the edit was really saved,
// puts the packet back. A failure is reported in the response; the saved edit is not undone.
func applyPacketReversal(ctx context.Context, loanID, actorEmployeeID uint, res *EditPaymentResult, reverse, dryRun bool) {
	res.Packet = packetReversalOffer(ctx, loanID, res)
	if res.Packet == nil || !reverse || dryRun {
		return
	}
	if _, err := packet.ReverseToPrevious(ctx, loanID, actorEmployeeID, "Packet moved back — loan repayment edited"); err != nil {
		res.PacketError = err.Error()
		return
	}
	res.PacketReversed = true
}
