package controllers

// Runs against the scratch database used by the Loan integration tests (same refusal to run anywhere else):
//
//	DB_NAME=ambikagold_scratch MIGRATIONS_DIR=../../../migrations go test ./modules/Packet/controllers/ -run Integration -v

import (
	"context"
	"os"
	"testing"

	"cloudhouse/backend/config"
	loanModels "cloudhouse/backend/modules/Loan/models"

	"gorm.io/gorm"
)

const (
	scratchTenant   = uint(5)
	scratchTemplate = uint(221) // an Active loan of tenant 5 with one ornament and one packet
)

func integrationCtx(t *testing.T) context.Context {
	t.Helper()
	if os.Getenv("DB_NAME") != "ambikagold_scratch" {
		t.Skip("integration test: set DB_NAME=ambikagold_scratch")
	}
	config.InitDB()
	return config.WithTenant(context.Background(), scratchTenant)
}

// A single packet read lists the ornaments already handed back separately from the ones still inside.
func TestIntegration_PacketListsReleasedOrnaments(t *testing.T) {
	ctx := integrationCtx(t)

	var packetID uint
	var code string
	if err := config.BaseDB.Raw(`SELECT id, code FROM packets WHERE loan_id = ? ORDER BY id LIMIT 1`, scratchTemplate).Row().Scan(&packetID, &code); err != nil {
		t.Fatalf("the template loan has no packet: %v", err)
	}
	var kept uint
	config.BaseDB.Raw(`SELECT id FROM ornaments WHERE loan_id = ? AND released_at IS NULL ORDER BY id LIMIT 1`, scratchTemplate).Scan(&kept)

	var released uint
	err := config.BaseDB.Transaction(func(tx *gorm.DB) error {
		if err := tx.Exec(`CREATE TEMP TABLE tmp_orn ON COMMIT DROP AS SELECT * FROM ornaments WHERE id = ?`, kept).Error; err != nil {
			return err
		}
		if err := tx.Exec(`UPDATE tmp_orn SET id = nextval(pg_get_serial_sequence('ornaments','id')), released_at = now()`).Error; err != nil {
			return err
		}
		if err := tx.Exec(`INSERT INTO ornaments SELECT * FROM tmp_orn`).Error; err != nil {
			return err
		}
		return tx.Raw(`SELECT max(id) FROM ornaments WHERE loan_id = ?`, scratchTemplate).Scan(&released).Error
	})
	if err != nil || released == 0 {
		t.Fatalf("could not create the released ornament: %v", err)
	}
	t.Cleanup(func() { config.BaseDB.Exec(`DELETE FROM ornaments WHERE id = ?`, released) })

	for name, load := range map[string]func() (ids, releasedIDs []uint, err error){
		"by id": func() ([]uint, []uint, error) {
			p, err := findPacketByID(ctx, packetID)
			if err != nil {
				return nil, nil, err
			}
			return ornamentIDs(p.Loan.Ornaments), ornamentIDs(p.ReleasedOrnaments), nil
		},
		"by code": func() ([]uint, []uint, error) {
			p, err := findByCode(ctx, code)
			if err != nil {
				return nil, nil, err
			}
			return ornamentIDs(p.Loan.Ornaments), ornamentIDs(p.ReleasedOrnaments), nil
		},
	} {
		ids, releasedIDs, err := load()
		if err != nil {
			t.Fatalf("%s: %v", name, err)
		}
		if !contains(ids, kept) || contains(ids, released) {
			t.Errorf("%s: ornaments still in the packet = %v, want %d and not %d", name, ids, kept, released)
		}
		if !contains(releasedIDs, released) || contains(releasedIDs, kept) {
			t.Errorf("%s: released ornaments = %v, want %d and not %d", name, releasedIDs, released, kept)
		}
	}
}

func ornamentIDs(list []loanModels.Ornament) []uint {
	ids := make([]uint, len(list))
	for i, o := range list {
		ids[i] = o.ID
	}
	return ids
}

func contains(ids []uint, id uint) bool {
	for _, v := range ids {
		if v == id {
			return true
		}
	}
	return false
}
