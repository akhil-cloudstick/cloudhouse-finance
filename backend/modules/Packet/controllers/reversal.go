package controllers

import (
	common "cloudhouse/backend/common/controllers"
	"cloudhouse/backend/config"
	"cloudhouse/backend/modules/Packet/models"
	"context"
	"errors"
	"fmt"

	"gorm.io/gorm"
)

// When a loan's repayment is corrected after the loan had been closed and its gold released, the packet may have to
// go back to where it was. These helpers read and undo a loan's latest packet movement. Unlike a normal movement
// they are NOT held to the allowed-transitions table (a released packet has no way forward or back there), and they
// never refuse because a locker is full: the staff member has decided the packet goes back, so a full locker is only
// reported as a warning in the preview.

// ReversalPreview is what reversing the packet's latest movement would do.
type ReversalPreview struct {
	PacketID       uint   `json:"packet_id"`
	Code           string `json:"code"`
	CurrentStatus  string `json:"current_status"`
	PreviousStatus string `json:"previous_status"`
	LockerID       *uint  `json:"locker_id,omitempty"`      // the locker it goes back to, when the previous status is Locker Stored
	LockerWarning  string `json:"locker_warning,omitempty"` // set when that locker is full or no longer active
}

// latestPacketAndMove is the loan's newest packet and the latest movement that actually changed its status.
func latestPacketAndMove(ctx context.Context, db *gorm.DB, loanID uint) (*models.Packet, *models.PacketMovement, error) {
	var p models.Packet
	if err := db.WithContext(ctx).Where("loan_id = ?", loanID).Order("id desc").First(&p).Error; err != nil {
		if errors.Is(err, gorm.ErrRecordNotFound) {
			return nil, nil, nil
		}
		return nil, nil, err
	}
	var mv models.PacketMovement
	err := db.WithContext(ctx).
		Where("packet_id = ? AND from_status <> '' AND from_status <> to_status", p.ID).
		Order("id desc").First(&mv).Error
	if err != nil {
		if errors.Is(err, gorm.ErrRecordNotFound) {
			return &p, nil, nil
		}
		return nil, nil, err
	}
	return &p, &mv, nil
}

// PreviewReversal says what putting the loan's packet back one step would do, or nil when there is nothing to undo.
func PreviewReversal(ctx context.Context, loanID uint) (*ReversalPreview, error) {
	return previewReversal(ctx, config.DB.WithContext(ctx), loanID)
}

func previewReversal(ctx context.Context, db *gorm.DB, loanID uint) (*ReversalPreview, error) {
	p, mv, err := latestPacketAndMove(ctx, db, loanID)
	if err != nil || p == nil || mv == nil || mv.ToStatus != p.Status {
		return nil, err
	}
	prev := &ReversalPreview{PacketID: p.ID, Code: p.Code, CurrentStatus: p.Status, PreviousStatus: mv.FromStatus}
	if mv.FromStatus == models.StatusLockerStored {
		var stored []models.PacketMovement
		if err := db.WithContext(ctx).
			Where("packet_id = ? AND to_status = ? AND locker_id IS NOT NULL AND id < ?", p.ID, models.StatusLockerStored, mv.ID).
			Order("id desc").Limit(1).Find(&stored).Error; err == nil && len(stored) > 0 {
			prev.LockerID = stored[0].LockerID
			prev.LockerWarning = lockerWarning(ctx, db, *prev.LockerID)
		}
	}
	return prev, nil
}

// lockerWarning is why putting a packet back into this locker may be a problem, or "" when it fits.
func lockerWarning(ctx context.Context, db *gorm.DB, lockerID uint) string {
	if LockerCapacity == nil {
		return ""
	}
	capacity, isActive, ok, err := LockerCapacity(ctx, lockerID)
	if err != nil {
		return ""
	}
	if !ok || !isActive {
		return "Its locker no longer exists or is inactive, so the packet goes back there anyway."
	}
	var occupied int64
	if err := db.WithContext(ctx).Model(&models.Packet{}).
		Where("current_locker_id = ? AND status = ?", lockerID, models.StatusLockerStored).Count(&occupied).Error; err != nil {
		return ""
	}
	if int(occupied) >= capacity {
		return fmt.Sprintf("Its locker is full (%d of %d in use), so it will be over capacity once the packet goes back.", occupied, capacity)
	}
	return ""
}

// ReverseToPrevious puts the loan's packet back to the status it had before its latest movement and records that as
// a movement of its own. It returns nil, nil when there is nothing to undo.
func ReverseToPrevious(ctx context.Context, loanID, actorEmployeeID uint, remarks string) (*models.Packet, error) {
	return ReverseToPreviousTx(ctx, config.DB.WithContext(ctx), loanID, actorEmployeeID, remarks)
}

// ReverseToPreviousTx is ReverseToPrevious inside the caller's transaction, so the move is undone together with the
// edit that asked for it: when either fails, neither is kept.
func ReverseToPreviousTx(ctx context.Context, db *gorm.DB, loanID, actorEmployeeID uint, remarks string) (*models.Packet, error) {
	preview, err := previewReversal(ctx, db, loanID)
	if err != nil || preview == nil {
		return nil, err
	}
	var p models.Packet
	if err := db.WithContext(ctx).First(&p, preview.PacketID).Error; err != nil {
		return nil, common.NewNotFound("packet not found")
	}
	from := p.Status
	p.Status = preview.PreviousStatus
	p.CurrentLockerID = preview.LockerID
	if err := db.WithContext(ctx).Save(&p).Error; err != nil {
		return nil, err
	}
	mv := &models.PacketMovement{
		PacketID:        p.ID,
		FromStatus:      from,
		ToStatus:        p.Status,
		LockerID:        preview.LockerID,
		ActorEmployeeID: actorEmployeeID,
		Remarks:         remarks,
	}
	if err := db.WithContext(ctx).Create(mv).Error; err != nil {
		return nil, err
	}
	return &p, nil
}

// RestoreWeightsTx adds back the weights a partial release took off the loan's packet, as a movement of its own
// (status and locker unchanged), inside the caller's transaction.
func RestoreWeightsTx(ctx context.Context, db *gorm.DB, loanID uint, gross, net float64, actorEmployeeID uint, remarks string) error {
	var p models.Packet
	if err := db.WithContext(ctx).Where("loan_id = ?", loanID).Order("id desc").First(&p).Error; err != nil {
		if errors.Is(err, gorm.ErrRecordNotFound) {
			return nil
		}
		return err
	}
	p.TotalGrossWeight += gross
	p.TotalNetWeight += net
	if err := db.WithContext(ctx).Save(&p).Error; err != nil {
		return err
	}
	return db.WithContext(ctx).Create(&models.PacketMovement{
		PacketID: p.ID, FromStatus: p.Status, ToStatus: p.Status, ActorEmployeeID: actorEmployeeID, Remarks: remarks,
	}).Error
}
