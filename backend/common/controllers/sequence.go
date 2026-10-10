package controllers

import (
	"fmt"

	"gorm.io/gorm"
)

func NextSequence(db *gorm.DB, tenantID uint, kind string) (uint64, error) {
	if tenantID == 0 {
		return 0, fmt.Errorf("platform: NextSequence requires a tenant (kind %q)", kind)
	}
	var next uint64
	err := db.Raw(`
		INSERT INTO sequences (tenant_id, kind, last_value, updated_at)
		VALUES (?, ?, 1, now())
		ON CONFLICT (tenant_id, kind)
		DO UPDATE SET last_value = sequences.last_value + 1, updated_at = now()
		RETURNING last_value`, tenantID, kind).Scan(&next).Error
	if err != nil {
		return 0, err
	}
	return next, nil
}

func SeedSequenceFrom(db *gorm.DB, tenantID uint, kind string, highest uint64) error {
	if tenantID == 0 {
		return fmt.Errorf("platform: SeedSequenceFrom requires a tenant (kind %q)", kind)
	}
	return db.Exec(`
		INSERT INTO sequences (tenant_id, kind, last_value, updated_at)
		VALUES (?, ?, ?, now())
		ON CONFLICT (tenant_id, kind)
		DO UPDATE SET last_value = GREATEST(sequences.last_value, EXCLUDED.last_value),
		              updated_at = now()`, tenantID, kind, highest).Error
}
