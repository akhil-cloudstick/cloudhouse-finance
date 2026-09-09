// Package bank implements a small reference-data resource: the set of
// external banks staff can pick from when re-pledging a loan's gold with a
// bank (RepledgeModalContent's "Bank" field). It mirrors
// internal/ornamenttype's layering — a name-based lookup list with a
// find-or-create endpoint, so picking a bank that doesn't exist yet just
// creates it.
package bank

import (
	"cloudhouse/backend/internal/platform"
	"time"
)

// Bank is a named external bank a loan's gold can be re-pledged with. Name
// is unique (case-insensitively, enforced in the service layer's
// find-or-create flow). Branch/IFSC are optional descriptive fields.
type Bank struct {
	platform.TenantScoped
	ID        uint      `json:"id" gorm:"primaryKey"`
	Name      string    `json:"name" gorm:"index;not null;size:120"`
	Branch    string    `json:"branch" gorm:"size:120"`
	Ifsc      string    `json:"ifsc" gorm:"size:20"`
	AccountNo string    `json:"accountNo" gorm:"size:40"`
	Phone     string    `json:"phone" gorm:"size:20"`
	CreatedAt time.Time `json:"createdAt"`
	UpdatedAt time.Time `json:"updatedAt"`
}

// TableName pins the GORM table name explicitly.
func (Bank) TableName() string {
	return "banks"
}
