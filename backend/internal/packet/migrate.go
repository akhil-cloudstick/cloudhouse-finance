package packet

import (
	"log"

	"gorm.io/gorm"

	"cloudhouse/backend/internal/loan"
)

// BackfillAuctionedPacketStatus corrects packets left stuck at a stale
// in-custody stage (e.g. still "Locker Stored") for a loan whose gold has
// already left custody (sold at auction, or already released) — a gap
// from before Service.RecordAuctionSale reliably drove the packet through
// to Released via loan.PacketMover.RecordGoldReleaseMovement. Without this,
// a packet checked in (or already stored) before that fix landed stays
// visibly wrong (and, worse, keeps occupying a locker slot) forever, since
// nothing else ever revisits it.
//
// Moves each affected packet straight to Released and clears its locker
// slot, recording a PacketMovement audit row for the jump so the packet's
// own history stays legible rather than showing an unexplained gap.
// Idempotent: only packets not already Released are touched, so re-running
// finds nothing once applied.
func BackfillAuctionedPacketStatus(db *gorm.DB) error {
	if !db.Migrator().HasTable(&Packet{}) || !db.Migrator().HasTable(&loan.Loan{}) {
		return nil // fresh install
	}

	var stuck []Packet
	err := db.Model(&Packet{}).
		Joins("JOIN loans ON loans.id = packets.loan_id").
		Where("packets.status <> ?", StatusReleased).
		Where("loans.status IN (?, ?, ?)", loan.StatusAuctioned, loan.StatusAuctionedBalanceDue, loan.StatusClosed).
		Find(&stuck).Error
	if err != nil {
		return err
	}
	if len(stuck) == 0 {
		return nil
	}

	for _, p := range stuck {
		final := &PacketMovement{
			PacketID:   p.ID,
			FromStatus: p.Status,
			ToStatus:   StatusReleased,
			Remarks:    "Backfill: loan's gold already left custody",
		}
		if err := db.Create(final).Error; err != nil {
			return err
		}
		if err := db.Model(&Packet{}).Where("id = ?", p.ID).
			Updates(map[string]any{"status": StatusReleased, "current_locker_id": nil}).Error; err != nil {
			return err
		}
	}
	log.Printf("backfilled %d packet(s) to Released (loan's gold already left custody)", len(stuck))
	return nil
}
