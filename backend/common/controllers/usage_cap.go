package controllers

import (
	"cloudhouse/backend/config"
	"context"
	"fmt"
	"time"
)

const (
	UsageSetuEsign = "setu_esign"
)

var dailyUsageCaps = map[string]uint{
	"setu_pan":     200,
	"setu_aadhaar": 200,
	UsageSetuEsign: 100,
}

var ErrUsageCapExceeded = NewConflict("daily usage limit reached for this business — try again tomorrow, or contact support")

func capFor(category string) uint {
	if c, ok := dailyUsageCaps[category]; ok {
		return c
	}
	return 2000
}

func CheckAndRecordUsage(db config.Conn, tenantID uint, category string) error {
	if tenantID == 0 {
		return fmt.Errorf("platform: CheckAndRecordUsage requires a tenant (category %q)", category)
	}
	today := time.Now().UTC().Truncate(24 * time.Hour)
	var count uint
	err := db.WithContext(context.Background()).Raw(`
		INSERT INTO usage_counters (tenant_id, category, day, count)
		VALUES (?, ?, ?, 1)
		ON CONFLICT (tenant_id, category, day)
		DO UPDATE SET count = usage_counters.count + 1
		RETURNING count`, tenantID, category, today).Scan(&count).Error
	if err != nil {
		return fmt.Errorf("recording usage: %w", err)
	}
	if count > capFor(category) {
		return ErrUsageCapExceeded
	}
	return nil
}
