// Package packet implements Gold Packet Management / Barcode-QR tracking:
// each Loan gets exactly one active tracking Packet (auto-created right
// after loan creation — see Service.Create), which moves through a fixed
// set of stages, each transition stamped as a PacketMovement row (date/
// time, locker, responsible employee, remarks).
//
// internal/packet imports internal/loan (to preload joined loan/customer/
// branch display fields onto Packet) but deliberately does NOT import
// internal/locker — capacity/existence checks against a lockerId go
// through the narrow LockerCapacityProvider interface in service.go
// instead, satisfied by locker.Repository at the main.go wiring level.
package packet

import (
	"time"

	"cloudhouse/backend/internal/loan"
	"cloudhouse/backend/internal/platform"
)

// Packet stage values. "Loan Created" is not a Packet row state — it's the
// moment before a packet exists; the packet's own first real status is
// PacketGenerated.
const (
	StatusPacketGenerated = "Packet Generated"
	StatusLockerStored    = "Locker Stored"
	StatusBankPledged     = "Bank Pledged"
	StatusReturned        = "Returned"
	StatusReadyForRelease = "Ready For Release"
	StatusReleased        = "Released"
)

// Packet represents one tracked bundle of a loan's pledged ornaments. A
// packet always represents *all* of its loan's ornaments — there is no
// ornament-level split/subset logic.
type Packet struct {
	platform.TenantScoped
	ID     uint      `json:"id" gorm:"primaryKey"`
	Code   string    `json:"code" gorm:"index;not null;size:30"`
	LoanID uint      `json:"loanId" gorm:"not null;index"`
	Loan   loan.Loan `json:"loan" gorm:"foreignKey:LoanID"`

	Status string `json:"status" gorm:"not null;size:30"`

	// CurrentLockerID is null whenever the packet is not physically checked
	// into a locker (e.g. Bank Pledged, Ready For Release, Released).
	CurrentLockerID *uint `json:"currentLockerId"`

	Movements []PacketMovement `json:"movements,omitempty" gorm:"foreignKey:PacketID"`

	CreatedAt time.Time `json:"createdAt"`
	UpdatedAt time.Time `json:"updatedAt"`
}

func (Packet) TableName() string { return "packets" }

// PacketMovement is one audit row in a packet's stage history.
type PacketMovement struct {
	platform.TenantScoped
	ID       uint `json:"id" gorm:"primaryKey"`
	PacketID uint `json:"packetId" gorm:"not null;index"`

	FromStatus string `json:"fromStatus" gorm:"size:30"`
	ToStatus   string `json:"toStatus" gorm:"not null;size:30"`

	LockerID *uint `json:"lockerId"`

	// ActorEmployeeID follows the same attribution pattern as
	// LoanApproval.ActorEmployeeID; movements triggered automatically by
	// loan-level bank-pledge actions (no staff-entered employeeId) record 0.
	ActorEmployeeID uint   `json:"actorEmployeeId"`
	Remarks         string `json:"remarks" gorm:"size:255"`

	CreatedAt time.Time `json:"createdAt"`
}

func (PacketMovement) TableName() string { return "packet_movements" }
