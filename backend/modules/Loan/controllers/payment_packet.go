package controllers

import (
	"cloudhouse/backend/config"
	"cloudhouse/backend/modules/Loan/models"
	packet "cloudhouse/backend/modules/Packet/controllers"
	"context"
	"fmt"
	"log"

	"gorm.io/gorm"
)

// A repayment correction can reopen a loan that had been closed and its gold released. The preview then lists what the
// release did to the gold, each with a box to put it back; the staff member decides. The chosen ones are undone in the
// same transaction as the edit, so an edit and its gold are saved together or not at all.

const (
	dependentPacket         = "packet"
	dependentPartialRelease = "partial_release"
)

var servicingStatuses = map[string]bool{
	models.StatusActive: true, models.StatusDueSoon: true, models.StatusOverdue: true,
}

// EditDependent is one thing a release did that the edit may need to undo.
type EditDependent struct {
	Kind        string `json:"kind"`
	Description string `json:"description"`
	Current     string `json:"current"`
	Suggested   string `json:"suggested"`
	Warning     string `json:"warning,omitempty"`
}

// packetChoices are the dependents the staff member ticked.
type packetChoices struct {
	ReversePacket  bool
	RestorePartial bool
	ActorEmployee  uint
}

// partialRelease is what the loan's latest approved partial release handed back.
type partialRelease struct {
	ornamentIDs []uint
	gross, net  float64
}

func findPartialRelease(ctx context.Context, db *gorm.DB, loanID uint) *partialRelease {
	var req models.LoanRequest
	if err := db.WithContext(ctx).Preload("OrnamentSelections").
		Where("loan_id = ? AND type = ? AND status = ? AND is_partial = ?", loanID, models.RequestTypeRelease, models.RequestStatusApproved, true).
		Order("id desc").First(&req).Error; err != nil {
		return nil
	}
	ids := make([]uint, 0, len(req.OrnamentSelections))
	for _, s := range req.OrnamentSelections {
		ids = append(ids, s.OrnamentID)
	}
	if len(ids) == 0 {
		return nil
	}
	var orns []models.Ornament
	if err := db.WithContext(ctx).Where("id IN ? AND released_at IS NOT NULL", ids).Find(&orns).Error; err != nil || len(orns) == 0 {
		return nil
	}
	out := &partialRelease{}
	for _, o := range orns {
		out.ornamentIDs = append(out.ornamentIDs, o.ID)
		out.gross += o.GrossWeight
		out.net += o.NetWeight
	}
	return out
}

// editDependents lists what the gold release did that this edit may need to undo.
func editDependents(ctx context.Context, loanID uint, res *EditPaymentResult) []EditDependent {
	var out []EditDependent
	if prev, err := packet.PreviewReversal(ctx, loanID); err != nil {
		log.Printf("packet reversal preview failed for loan %d: %v", loanID, err)
	} else if prev != nil {
		statusChanged := res.Before.Status != res.After.Status
		reopened := prev.CurrentStatus == "Released" && servicingStatuses[res.After.Status]
		if statusChanged || reopened {
			res.Packet = prev
			out = append(out, EditDependent{
				Kind:        dependentPacket,
				Description: fmt.Sprintf("Gold packet %s", prev.Code),
				Current:     prev.CurrentStatus,
				Suggested:   "Move back to " + prev.PreviousStatus,
				Warning:     prev.LockerWarning,
			})
		}
	}
	if res.After.Total > res.Before.Total+0.01 {
		if pr := findPartialRelease(ctx, config.DB.WithContext(ctx), loanID); pr != nil {
			out = append(out, EditDependent{
				Kind:        dependentPartialRelease,
				Description: fmt.Sprintf("Partial release of %d ornament(s)", len(pr.ornamentIDs)),
				Current:     "Handed back to the customer",
				Suggested:   fmt.Sprintf("Put back in the packet (%.2f g gross)", pr.gross),
			})
		}
	}
	return out
}

// applyEditDependents undoes the ticked dependents inside the edit's transaction. It returns whether ornaments were
// put back, so the caller can refresh the loan's eligible amount once the transaction is saved.
func applyEditDependents(ctx context.Context, tx *gorm.DB, loanID uint, offered []EditDependent, choices packetChoices) (restoredOrnaments bool, err error) {
	for _, d := range offered {
		switch {
		case d.Kind == dependentPacket && choices.ReversePacket:
			if _, err := packet.ReverseToPreviousTx(ctx, tx, loanID, choices.ActorEmployee, "Packet moved back — loan repayment edited"); err != nil {
				return false, err
			}
		case d.Kind == dependentPartialRelease && choices.RestorePartial:
			pr := findPartialRelease(ctx, tx, loanID)
			if pr == nil {
				continue
			}
			if err := tx.WithContext(ctx).Model(&models.Ornament{}).Where("id IN ?", pr.ornamentIDs).Update("released_at", nil).Error; err != nil {
				return false, err
			}
			if err := packet.RestoreWeightsTx(ctx, tx, loanID, pr.gross, pr.net, choices.ActorEmployee, "Partial release undone — loan repayment edited"); err != nil {
				return false, err
			}
			restoredOrnaments = true
		}
	}
	return restoredOrnaments, nil
}
