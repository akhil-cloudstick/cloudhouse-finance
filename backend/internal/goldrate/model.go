// Package goldrate implements the daily gold rate entry + history domain
// (frontend/components/GoldRates.tsx). Each publish is an append-only row —
// there is no in-place "current rate" record; the latest row by Date/ID is
// treated as the current rate, mirroring legacy's rates + rateHistory pair
// (frontend/lib/data.ts's Rates/RateHistoryEntry, now unified into one table).
//
// Only the 24K benchmark is published — every other purity is resolved
// per-ornament at pledge/re-test time as K24 × (karat/24) or K24 ×
// (fineness%/100), see internal/loan/service.go's parsePurity/rateForPurity
// and internal/puritystandard. GoldRate used to also carry independently
// staff-entered K22/K18 columns; those are preserved read-only as
// legacy_k22/legacy_k18 (see MigrateLegacyColumns) rather than dropped,
// since their real historical values aren't reconstructable from K24 alone.
package goldrate

import "time"

// GoldRate represents one published daily 24K benchmark rate.
type GoldRate struct {
	ID        uint      `json:"id" gorm:"primaryKey"`
	Date      time.Time `json:"date" gorm:"not null;index"`
	K24       float64   `json:"k24" gorm:"not null"`
	SetBy     string    `json:"setBy" gorm:"not null;size:120"`
	CreatedAt time.Time `json:"createdAt"`
}

func (GoldRate) TableName() string {
	return "gold_rates"
}
