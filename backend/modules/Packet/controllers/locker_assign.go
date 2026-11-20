package controllers

import (
	common "cloudhouse/backend/common/controllers"
	loanModels "cloudhouse/backend/modules/Loan/models"
	"cloudhouse/backend/modules/Packet/models"
	"context"
	"errors"

	"gorm.io/gorm"
)

// CurrentPlacement says where a loan's gold packet is: its status and, when it is stored, the locker. ok is false
// when the loan has no packet.
func CurrentPlacement(ctx context.Context, db *gorm.DB, loanID uint) (status string, lockerID *uint, ok bool, err error) {
	var p models.Packet
	if err := db.WithContext(ctx).Where("loan_id = ?", loanID).Order("id desc").First(&p).Error; err != nil {
		if errors.Is(err, gorm.ErrRecordNotFound) {
			return "", nil, false, nil
		}
		return "", nil, false, err
	}
	return p.Status, p.CurrentLockerID, true, nil
}

// lockerHasRoom refuses a locker that is missing, inactive or full. A packet already in that locker does not count
// against it.
func lockerHasRoom(ctx context.Context, db *gorm.DB, lockerID, exceptPacketID uint) error {
	if LockerCapacity == nil {
		return nil
	}
	capacity, isActive, ok, err := LockerCapacity(ctx, lockerID)
	if err != nil {
		return err
	}
	if !ok || !isActive {
		return common.NewBadRequest("locker does not exist or is inactive")
	}
	var occupied int64
	if err := db.WithContext(ctx).Model(&models.Packet{}).
		Where("current_locker_id = ? AND status = ? AND id <> ?", lockerID, models.StatusLockerStored, exceptPacketID).
		Count(&occupied).Error; err != nil {
		return err
	}
	if int(occupied) >= capacity {
		return common.NewConflict("locker is at full capacity")
	}
	return nil
}

// CheckLockerRoom is the check AssignLockerTx makes, for validating a change before anything is saved.
func CheckLockerRoom(ctx context.Context, db *gorm.DB, loanID, lockerID uint) error {
	var p models.Packet
	if err := db.WithContext(ctx).Where("loan_id = ?", loanID).Order("id desc").First(&p).Error; err != nil {
		if errors.Is(err, gorm.ErrRecordNotFound) {
			return common.NewBadRequest("this loan has no gold packet to put in a locker")
		}
		return err
	}
	return lockerHasRoom(ctx, db, lockerID, p.ID)
}

// AssignLockerTx puts a loan's packet in a locker (moving it from another one), as a movement of its own, inside the
// caller's transaction. Only a packet that is in a locker, or has not been stored yet, can be placed; one that is
// pledged to a bank, returned or released is not in the branch's custody to place.
func AssignLockerTx(ctx context.Context, db *gorm.DB, loanID, lockerID, actorEmployeeID uint, remarks string) error {
	var p models.Packet
	if err := db.WithContext(ctx).Where("loan_id = ?", loanID).Order("id desc").First(&p).Error; err != nil {
		if errors.Is(err, gorm.ErrRecordNotFound) {
			return common.NewBadRequest("this loan has no gold packet to put in a locker")
		}
		return err
	}
	if p.Status != models.StatusLockerStored && !isAllowed(p.Status, models.StatusLockerStored) {
		return common.NewConflict("the gold is " + p.Status + ", so it cannot be placed in a locker right now")
	}
	if p.Status == models.StatusLockerStored && p.CurrentLockerID != nil && *p.CurrentLockerID == lockerID {
		return nil
	}
	if err := lockerHasRoom(ctx, db, lockerID, p.ID); err != nil {
		return err
	}
	from := p.Status
	p.Status = models.StatusLockerStored
	p.CurrentLockerID = &lockerID
	if err := db.WithContext(ctx).Save(&p).Error; err != nil {
		return err
	}
	if err := db.WithContext(ctx).Create(&models.PacketMovement{
		PacketID: p.ID, FromStatus: from, ToStatus: p.Status, LockerID: &lockerID, ActorEmployeeID: actorEmployeeID, Remarks: remarks,
	}).Error; err != nil {
		return err
	}
	return loanModels.TouchLoan(db.WithContext(ctx), p.LoanID)
}
