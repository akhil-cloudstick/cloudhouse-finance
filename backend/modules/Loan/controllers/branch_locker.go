package controllers

import (
	common "cloudhouse/backend/common/controllers"
	"cloudhouse/backend/config"
	"cloudhouse/backend/modules/Loan/models"
	lockerModels "cloudhouse/backend/modules/Locker/models"
	packet "cloudhouse/backend/modules/Packet/controllers"
	"context"

	"gorm.io/gorm"
)

// A loan's branch and the locker its gold is kept in can be changed from Edit Loan by a role that may see every branch
// (the handler checks that). The loan's own branch is what changes: the cash that already moved stays booked at the
// branch where it was received or paid, and what is booked from now on follows the loan to its new branch. The gold
// goes to a locker of the loan's (new) branch.

func branchChange(l *models.Loan, in UpdateLoanInput) (uint, bool) {
	if in.BranchID != nil && *in.BranchID != l.BranchID {
		return *in.BranchID, true
	}
	return l.BranchID, false
}

// validateLoanMove checks a branch / locker change before anything is saved.
func validateLoanMove(ctx context.Context, l *models.Loan, in UpdateLoanInput) error {
	if in.BranchID == nil && in.LockerID == nil {
		return nil
	}
	db := config.DB.WithContext(ctx)
	target, branchMoves := branchChange(l, in)
	if branchMoves {
		ok, err := common.BranchExists(ctx, target)
		if err != nil {
			return err
		}
		if !ok {
			return common.NewBadRequest("branch does not exist")
		}
	}
	if in.LockerID != nil {
		var lk lockerModels.Locker
		if err := db.First(&lk, *in.LockerID).Error; err != nil {
			return common.NewBadRequest("locker does not exist")
		}
		if !lk.IsActive {
			return common.NewBadRequest("that locker is inactive")
		}
		if lk.BranchID != target {
			return common.NewBadRequest("the locker must belong to the loan's branch")
		}
		return packet.CheckLockerRoom(ctx, db, l.ID, lk.ID)
	}
	if branchMoves {
		// the gold would stay in a locker of the old branch
		status, lockerID, ok, err := packet.CurrentPlacement(ctx, db, l.ID)
		if err != nil {
			return err
		}
		if ok && lockerID != nil && status == "Locker Stored" {
			var lk lockerModels.Locker
			if err := db.First(&lk, *lockerID).Error; err == nil && lk.BranchID != target {
				return common.NewBadRequest("choose a locker in the new branch for the gold")
			}
		}
	}
	return nil
}

// applyLoanMove saves the branch / locker change in one transaction.
func applyLoanMove(ctx context.Context, loanID uint, in UpdateLoanInput) error {
	if in.BranchID == nil && in.LockerID == nil {
		return nil
	}
	return config.DB.WithContext(ctx).Transaction(func(tx *gorm.DB) error {
		var l models.Loan
		if err := tx.WithContext(ctx).First(&l, loanID).Error; err != nil {
			return common.NewNotFound("loan not found")
		}
		if target, moves := branchChange(&l, in); moves {
			if err := tx.WithContext(ctx).Model(&models.Loan{}).Where("id = ?", loanID).Update("branch_id", target).Error; err != nil {
				return err
			}
		}
		if in.LockerID != nil {
			return packet.AssignLockerTx(ctx, tx, loanID, *in.LockerID, in.ActorEmployeeID, "Locker changed from Edit Loan")
		}
		return nil
	})
}
