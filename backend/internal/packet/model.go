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

	// TotalGrossWeight/TotalNetWeight mirror the physical contents of this
	// packet — initialized from the sum of the loan's ornaments' weights
	// when the packet is first created (see Service.Create), then
	// decremented by RecordPartialGoldReleaseMovement whenever a Partial
	// Ornament Release hands back some (not all) of the loan's gold while
	// the packet itself stays in custody holding the rest. Without this,
	// a vault-inventory audit that scans packet-level weight would drift
	// away from what the locker actually still holds after any partial
	// release — the whole point of tracking it at the packet level instead
	// of only ever re-deriving it from the loan's live ornament rows.
	TotalGrossWeight float64 `json:"totalGrossWeight" gorm:"type:numeric(16,3);default:0"`
	TotalNetWeight   float64 `json:"totalNetWeight" gorm:"type:numeric(16,3);default:0"`

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
