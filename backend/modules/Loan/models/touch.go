package models

import (
	"time"

	"gorm.io/gorm"
)

func TouchLoan(db *gorm.DB, loanID uint) error {
	if loanID == 0 {
		return nil
	}
	return db.Exec("UPDATE loans SET updated_at = ? WHERE id = ?", time.Now(), loanID).Error
}

func TouchLoanOfOrnament(db *gorm.DB, ornamentID uint) error {
	return db.Exec("UPDATE loans SET updated_at = ? WHERE id = (SELECT loan_id FROM ornaments WHERE id = ?)", time.Now(), ornamentID).Error
}

func TouchLoanOfAuction(db *gorm.DB, auctionRecordID uint) error {
	return db.Exec("UPDATE loans SET updated_at = ? WHERE id = (SELECT loan_id FROM auction_records WHERE id = ?)", time.Now(), auctionRecordID).Error
}

func TouchLoanOfPledge(db *gorm.DB, pledgeID uint) error {
	return db.Exec("UPDATE loans SET updated_at = ? WHERE id = (SELECT loan_id FROM bank_pledge_records WHERE id = ?)", time.Now(), pledgeID).Error
}

func TouchLoanOfPacket(db *gorm.DB, packetID uint) error {
	return db.Exec("UPDATE loans SET updated_at = ? WHERE id = (SELECT loan_id FROM packets WHERE id = ?)", time.Now(), packetID).Error
}
