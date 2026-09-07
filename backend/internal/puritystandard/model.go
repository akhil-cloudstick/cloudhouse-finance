// Package puritystandard implements a small reference-data resource: the
// set of known gold purities (karat + fineness%) staff can pick from when
// declaring an ornament's purity (NewLoan.tsx's PurityPicker) or recording
// a purity re-test. It mirrors internal/bank's/internal/ornamenttype's
// layering — a lookup list with a find-or-create endpoint, so picking a
// purity that doesn't exist yet just creates it.
//
// This table is suggestion-only: nothing FKs into it. Ornament.Purity and
// OrnamentPurityTest.TestedPurity store a plain unit-suffixed string
// ("22K" / "91.6%") computed at entry time — see internal/loan/service.go's
// parsePurity — rather than a PurityStandardID, so editing/removing a
// PurityStandard row later can never silently reinterpret a historical
// ornament's already-computed GoldValue.
package puritystandard

import (
	"ambikagold/backend/internal/platform"
	"time"
)

// PurityStandard is one known gold purity, describable by karat and/or
// fineness percentage. Karat/FinenessPercent are pointers because a
// staff-created custom entry (via FindOrCreate) may only supply the one
// unit it was entered in; every seeded row (see cmd/migrate) has both,
// computed from the exact karat/24 ratio so the table is internally
// consistent.
type PurityStandard struct {
	platform.TenantScoped
	ID              uint     `json:"id" gorm:"primaryKey"`
	Karat           *int     `json:"karat"`
	FinenessPercent *float64 `json:"finenessPercent"`
	// Label is a human-readable display string, e.g. "22K (916)". Not
	// unique/indexed on its own — Karat/FinenessPercent are what dedupe
	// against in FindOrCreate.
	Label     string    `json:"label" gorm:"not null;size:40"`
	IsActive  bool      `json:"isActive" gorm:"not null;default:true"`
	CreatedAt time.Time `json:"createdAt"`
	UpdatedAt time.Time `json:"updatedAt"`
}

func (PurityStandard) TableName() string {
	return "purity_standards"
}
