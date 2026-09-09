// Package locker implements Locker/Vault management: a real per-branch
// storage unit that packets (internal/packet) are physically checked into
// and out of. Occupancy (current packet count) is DERIVED, never stored —
// see PacketCounter below.
//
// internal/locker must NOT import internal/packet (that would create an
// import cycle with internal/packet's own LockerCapacityProvider
// dependency back onto locker). Instead this package defines the narrow
// PacketCounter interface; the concrete packet.Repository (or a thin
// adapter) is wired into locker.NewService at the main.go level, built
// after internal/packet exists.
package locker

import (
	"time"

	"gorm.io/gorm"

	"cloudhouse/backend/internal/branch"
	"cloudhouse/backend/internal/platform"
)

// Locker represents one physical storage unit (locker/vault) at a branch.
type Locker struct {
	platform.TenantScoped
	ID       uint          `json:"id" gorm:"primaryKey"`
	Code     string        `json:"code" gorm:"index;size:20"`
	BranchID uint          `json:"branchId" gorm:"not null"`
	Branch   branch.Branch `json:"branch" gorm:"foreignKey:BranchID"`
	Capacity int           `json:"capacity" gorm:"not null"`
	IsActive bool          `json:"isActive" gorm:"not null;default:true"`

	CreatedAt time.Time      `json:"createdAt"`
	UpdatedAt time.Time      `json:"updatedAt"`
	DeletedAt gorm.DeletedAt `json:"-" gorm:"index"`
}

func (Locker) TableName() string { return "lockers" }
