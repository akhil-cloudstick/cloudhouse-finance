// Package goldrate implements the daily gold rate entry + history domain
// (frontend/components/GoldRates.tsx). Each publish is an append-only row —
// there is no in-place "current rate" record; the latest row by Date/ID is
// treated as the current rate, mirroring legacy's rates + rateHistory pair
// (frontend/lib/data.ts's Rates/RateHistoryEntry, now unified into one table).
package goldrate

import "time"

// GoldRate represents one published daily rate for all three purities.
type GoldRate struct {
	ID        uint      `json:"id" gorm:"primaryKey"`
	Date      time.Time `json:"date" gorm:"not null;index"`
	K24       float64   `json:"k24" gorm:"not null"`
	K22       float64   `json:"k22" gorm:"not null"`
	K18       float64   `json:"k18" gorm:"not null"`
	SetBy     string    `json:"setBy" gorm:"not null;size:120"`
	CreatedAt time.Time `json:"createdAt"`
}

func (GoldRate) TableName() string {
	return "gold_rates"
}
