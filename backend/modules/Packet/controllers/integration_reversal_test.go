package controllers

// Runs against the scratch database (see packet_integration_test.go):
//
//	DB_NAME=ambikagold_scratch MIGRATIONS_DIR=../../../migrations go test ./modules/Packet/controllers/ -run IntegrationReversal -v

import (
	"testing"

	"cloudhouse/backend/config"
)

// A released packet goes back to the status (and locker) it had before, with a movement recording it, even though
// Released has no way back in the normal transitions.
func TestIntegrationReversal_ReleasedPacketGoesBackToItsLocker(t *testing.T) {
	ctx := integrationCtx(t)

	var packetID uint
	var origStatus string
	var origLocker *uint
	if err := config.BaseDB.Raw(`SELECT id, status, current_locker_id FROM packets WHERE loan_id = ? ORDER BY id LIMIT 1`, scratchTemplate).
		Row().Scan(&packetID, &origStatus, &origLocker); err != nil {
		t.Fatalf("the template loan has no packet: %v", err)
	}
	var locker *uint
	var lockerID uint
	if err := config.BaseDB.Raw(`SELECT id FROM lockers WHERE tenant_id = ? ORDER BY id LIMIT 1`, scratchTenant).Scan(&lockerID).Error; err == nil && lockerID != 0 {
		locker = &lockerID
	}

	var before int64
	config.BaseDB.Raw(`SELECT count(*) FROM packet_movements WHERE packet_id = ?`, packetID).Scan(&before)
	t.Cleanup(func() {
		config.BaseDB.Exec(`DELETE FROM packet_movements WHERE packet_id = ? AND id > (SELECT COALESCE(max(id),0) FROM (SELECT id FROM packet_movements WHERE packet_id = ? ORDER BY id LIMIT ?) x)`, packetID, packetID, before)
		config.BaseDB.Exec(`UPDATE packets SET status = ?, current_locker_id = ? WHERE id = ?`, origStatus, origLocker, packetID)
	})

	// stored in a locker, then the gold released
	config.BaseDB.Exec(`INSERT INTO packet_movements (tenant_id, packet_id, from_status, to_status, locker_id, remarks, created_at) VALUES (?, ?, 'Packet Generated', 'Locker Stored', ?, 'test store', now())`, scratchTenant, packetID, locker)
	config.BaseDB.Exec(`INSERT INTO packet_movements (tenant_id, packet_id, from_status, to_status, remarks, created_at) VALUES (?, ?, 'Locker Stored', 'Released', 'test release', now())`, scratchTenant, packetID)
	config.BaseDB.Exec(`UPDATE packets SET status = 'Released', current_locker_id = NULL WHERE id = ?`, packetID)

	prev, err := PreviewReversal(ctx, scratchTemplate)
	if err != nil || prev == nil {
		t.Fatalf("expected a reversal to offer, got %v, %v", prev, err)
	}
	if prev.CurrentStatus != "Released" || prev.PreviousStatus != "Locker Stored" {
		t.Fatalf("preview = %+v, want Released -> Locker Stored", prev)
	}
	if (locker == nil) != (prev.LockerID == nil) || (locker != nil && *prev.LockerID != *locker) {
		t.Fatalf("preview locker = %v, want %v", prev.LockerID, locker)
	}

	p, err := ReverseToPrevious(ctx, scratchTemplate, 0, "test reversal")
	if err != nil || p == nil {
		t.Fatalf("reverse failed: %v", err)
	}
	var status string
	var cur *uint
	config.BaseDB.Raw(`SELECT status, current_locker_id FROM packets WHERE id = ?`, packetID).Row().Scan(&status, &cur)
	if status != "Locker Stored" {
		t.Fatalf("packet status = %q, want Locker Stored", status)
	}
	if (locker == nil) != (cur == nil) || (locker != nil && *cur != *locker) {
		t.Fatalf("packet locker = %v, want %v", cur, locker)
	}
	var moves int64
	config.BaseDB.Raw(`SELECT count(*) FROM packet_movements WHERE packet_id = ? AND from_status = 'Released' AND to_status = 'Locker Stored' AND remarks = 'test reversal'`, packetID).Scan(&moves)
	if moves != 1 {
		t.Fatalf("reversal movements = %d, want 1", moves)
	}
}
