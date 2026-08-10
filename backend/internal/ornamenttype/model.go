// Package ornamenttype implements a small reference-data resource: the set
// of ornament type names (e.g. "Chain", "Ring") offered to staff when
// entering ornaments on a loan. It mirrors internal/scheme's layering.
package ornamenttype

import "time"

// OrnamentType is a named ornament category. Name is unique
// (case-sensitively at the DB level; case-insensitive matching is handled
// in the service layer for the "find or create" flow).
type OrnamentType struct {
	ID        uint      `json:"id" gorm:"primaryKey"`
	Name      string    `json:"name" gorm:"uniqueIndex;not null"`
	CreatedAt time.Time `json:"createdAt"`
	UpdatedAt time.Time `json:"updatedAt"`
}

// TableName pins the GORM table name explicitly.
func (OrnamentType) TableName() string {
	return "ornament_types"
}
