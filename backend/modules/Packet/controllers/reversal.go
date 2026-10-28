package controllers

import (
	common "cloudhouse/backend/common/controllers"
	"cloudhouse/backend/config"
	"cloudhouse/backend/modules/Packet/models"
	"context"
	"errors"

	"gorm.io/gorm"
)

// When a loan's repayment is corrected after the loan had been closed and its gold released, the packet may have to
// go back to where it was. These helpers read and undo a loan's latest packet movement. Unlike a normal movement
// they are NOT held to the allowed-transitions table (a released packet has no way forward or back there), and they
// never check locker capacity: the staff member has decided the packet goes back, and a full locker must not stop it.

// ReversalPreview is what reversing the packet's latest movement would do.
type ReversalPreview struct {
	PacketID       uint   `json:"packet_id"`
	Code           string `json:"code"`
	CurrentStatus  string `json:"current_status"`
	PreviousStatus string `json:"previous_status"`
	LockerID       *uint  `json:"locker_id,omitempty"` // the locker it goes back to, when the previous status is Locker Stored
}

// latestPacketAndMove is the loan's newest packet and the latest movement that actually changed its status.
func latestPacketAndMove(ctx context.Context, loanID uint) (*models.Packet, *models.PacketMovement, error) {
	var p models.Packet
	if err := config.DB.WithContext(ctx).Where("loan_id = ?", loanID).Order("id desc").First(&p).Error; err != nil {
		if errors.Is(err, gorm.ErrRecordNotFound) {
			return nil, nil, nil
		}
		return nil, nil, err
	}
	var mv models.PacketMovement
	err := config.DB.WithContext(ctx).
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
	p, mv, err := latestPacketAndMove(ctx, loanID)
	if err != nil || p == nil || mv == nil || mv.ToStatus != p.Status {
		return nil, err
	}
	prev := &ReversalPreview{PacketID: p.ID, Code: p.Code, CurrentStatus: p.Status, PreviousStatus: mv.FromStatus}
	if mv.FromStatus == models.StatusLockerStored {
		var stored []models.PacketMovement
		if err := config.DB.WithContext(ctx).
			Where("packet_id = ? AND to_status = ? AND locker_id IS NOT NULL AND id < ?", p.ID, models.StatusLockerStored, mv.ID).
			Order("id desc").Limit(1).Find(&stored).Error; err == nil && len(stored) > 0 {
			prev.LockerID = stored[0].LockerID
		}
	}
	return prev, nil
}

// ReverseToPrevious puts the loan's packet back to the status it had before its latest movement and records that as
// a movement of its own. It returns nil, nil when there is nothing to undo.
func ReverseToPrevious(ctx context.Context, loanID, actorEmployeeID uint, remarks string) (*models.Packet, error) {
	preview, err := PreviewReversal(ctx, loanID)
	if err != nil || preview == nil {
		return nil, err
	}
	p, err := findPacketByID(ctx, preview.PacketID)
	if err != nil {
		return nil, common.NewNotFound("packet not found")
	}
	from := p.Status
	p.Status = preview.PreviousStatus
	p.CurrentLockerID = preview.LockerID
	if err := persistPacket(ctx, p); err != nil {
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
	if err := createMovement(ctx, mv); err != nil {
		return nil, err
	}
	return p, nil
}
