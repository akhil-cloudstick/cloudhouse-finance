// Package goldrate implements the daily gold rate entry + history domain
// (frontend/components/GoldRates.tsx). Each publish is an append-only row —
// there is no in-place "current rate" record; the latest row by Date/ID is
// treated as the current rate, mirroring legacy's rates + rateHistory pair
// (frontend/lib/data.ts's Rates/RateHistoryEntry, now unified into one table).
//
// K24 is always published directly. K22/K18 can now ALSO be published
// directly (Manual mode — see RateModalContent), independent of what
// K24×ratio would derive — this is the second life of the columns
// described below: they were once retired to legacy_k22/legacy_k18
// (read-only, unused) and are now real, live columns again, under new
// names, populated on every publish. Every publish writes a full
// snapshot of all three columns: whichever karat was directly set this
// time takes the new value; the other two carry forward unchanged from
// the previous latest row (see Service.Publish) — so K22/K18 only ever
// change when something (Manual entry, or Auto explicitly re-deriving
// off K24) actually touches that karat, never silently on every 24K-only
// publish.
//
// For any purity that ISN'T exactly 24K/22K/18K (16K, a custom
// fineness%, etc.), the rate is still derived off K24 exactly as before
// — see internal/loan/purity.go's rateForPurity. legacy_k22/legacy_k18
// are the OLD, unrelated pre-2024 columns from before purity resolution
// ever moved to per-ornament computation; a one-time migration once
// renamed the original k22/k18 columns to those legacy_* names on
// existing databases (that step has since been removed — it would
// conflict with these columns' second life below, renaming the live
// K22/K18 fields away into an already-occupied name). legacy_k22/
// legacy_k18 stay orphaned in the schema, untouched by anything here —
// K22/K18 below are new columns under new Go field names, not a
// revival of reading those legacy ones.
package goldrate

import "time"

// GoldRate represents one published daily rate snapshot — 24K always
// published, 22K/18K either carried forward or independently published.
type GoldRate struct {
	ID        uint      `json:"id" gorm:"primaryKey"`
	Date      time.Time `json:"date" gorm:"not null;index"`
	K24       float64   `json:"k24" gorm:"not null"`
	K22       float64   `json:"k22" gorm:"not null;default:0"`
	K18       float64   `json:"k18" gorm:"not null;default:0"`
	SetBy     string    `json:"setBy" gorm:"not null;size:120"`
	CreatedAt time.Time `json:"createdAt"`
}

func (GoldRate) TableName() string {
	return "gold_rates"
}
