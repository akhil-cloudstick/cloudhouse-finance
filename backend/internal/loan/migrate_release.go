package loan

import (
	"log"

	"gorm.io/gorm"
)

// BackfillReleaseChecklistColumns migrates every existing LoanRequest row
// from the retired 4-item checklist (PaymentVerified/PacketVerified/
// BankPledgeVerified/CustomerConfirmed) onto the reworked
// CustomerSawGold/PaymentRecorded/Locked columns. Must run AFTER
// AutoMigrate, which is what actually creates the new columns — both old
// and new columns coexist on the table (the old ones are deliberately not
// dropped; see LoanRequest's own doc comment on why), so this is a plain
// same-table copy, not a cross-migration-boundary one.
//
// The mapping is a judgment call, documented here rather than silently
// applied:
//   - CustomerSawGold <- CustomerConfirmed. The closest existing signal for
//     "has the customer actually seen/confirmed the gold" — imperfect (the
//     old CustomerConfirmed was a broader "customer confirmed [something]"
//     tickbox, not packet-status-gated the way the new field is), but it is
//     the only prior signal that exists, and a false positive here only
//     ever matters for a request already Approved or Rejected (a still-
//     Pending request gets no historical data to migrate — see below).
//   - PaymentRecorded <- PaymentVerified. Same reasoning: PaymentVerified
//     meant "balance settled", which is what PaymentRecorded's own
//     RecordReleaseRequestPayment flip is trying to capture retroactively.
//   - Locked <- true ONLY for a request that has already reached a terminal
//     Approved/Rejected state. A still-Pending request is left Locked=false
//     regardless of its old flags — Locked's whole purpose is to block
//     further edits/rejection on an in-flight request, and a request that
//     is still Pending after this migration runs should remain editable
//     under the new rules rather than being retroactively frozen by data
//     that predates the concept of "locked".
//
// PacketVerified/BankPledgeVerified are NOT migrated onto anything: the new
// checklist replaced BOTH with automatic checks (packet-status gate,
// pledgeRepo.HasActive) rather than a stored boolean, so there is nothing
// for them to become.
//
// Idempotent: only rows where the new columns are still at their AutoMigrate
// default (all false) and the request is Type=Release are touched; a
// second run finds nothing left to do because CustomerSawGold/
// PaymentRecorded/Locked would already reflect this backfill (or a real
// change made after it).
func BackfillReleaseChecklistColumns(db *gorm.DB) error {
	if !db.Migrator().HasTable(&LoanRequest{}) {
		return nil // fresh install
	}
	if !db.Migrator().HasColumn(&LoanRequest{}, "customer_confirmed") ||
		!db.Migrator().HasColumn(&LoanRequest{}, "customer_saw_gold") {
		return nil // legacy column already gone, or new column not yet created
	}

	res := db.Exec(`
		UPDATE loan_requests
		SET customer_saw_gold = customer_confirmed,
		    payment_recorded  = payment_verified,
		    locked            = (status IN (?, ?))
		WHERE type = ?
		  AND customer_saw_gold = false
		  AND payment_recorded = false
		  AND locked = false
		  AND (customer_confirmed = true OR payment_verified = true OR status IN (?, ?))`,
		RequestStatusApproved, RequestStatusRejected, RequestTypeRelease,
		RequestStatusApproved, RequestStatusRejected)
	if res.Error != nil {
		return res.Error
	}
	if res.RowsAffected > 0 {
		log.Printf("backfilled loan_requests: %d release request(s) migrated from the old 4-item checklist to CustomerSawGold/PaymentRecorded/Locked", res.RowsAffected)
	}
	return nil
}

// BackfillPacketWeightTotals seeds packets.total_gross_weight/
// total_net_weight for every packet created BEFORE those columns existed —
// summed from that packet's own loan's CURRENTLY-PLEDGED ornaments
// (released_at IS NULL), the same query Service.Create uses to seed a new
// packet going forward. Must run AFTER AutoMigrate has added the columns
// (nullable-with-default, so this backfill has something to update) and
// after ornaments.released_at exists.
//
// Idempotent: only packets still at the zero default are touched, so a
// packet a later partial release has already adjusted is never double-
// counted or reset.
func BackfillPacketWeightTotals(db *gorm.DB) error {
	if !db.Migrator().HasTable("packets") || !db.Migrator().HasTable(&Ornament{}) {
		return nil // fresh install
	}
	if !db.Migrator().HasColumn("packets", "total_gross_weight") {
		return nil
	}
	res := db.Exec(`
		UPDATE packets p
		SET total_gross_weight = COALESCE(o.gross_sum, 0),
		    total_net_weight   = COALESCE(o.net_sum, 0)
		FROM (
			SELECT loan_id, SUM(gross_weight) AS gross_sum, SUM(net_weight) AS net_sum
			FROM ornaments
			WHERE released_at IS NULL
			GROUP BY loan_id
		) o
		WHERE o.loan_id = p.loan_id
		  AND p.total_gross_weight = 0
		  AND p.total_net_weight = 0`)
	if res.Error != nil {
		return res.Error
	}
	if res.RowsAffected > 0 {
		log.Printf("backfilled packets: %d row(s) -> total_gross_weight/total_net_weight seeded from their loan's currently-pledged ornaments", res.RowsAffected)
	}
	return nil
}
