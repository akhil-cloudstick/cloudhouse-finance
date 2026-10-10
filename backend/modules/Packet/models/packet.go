package models

import (
	"cloudhouse/backend/config"
	loanModels "cloudhouse/backend/modules/Loan/models"
	"time"
)

const (
	StatusLockerStored = "Locker Stored"
	StatusBankPledged  = "Bank Pledged"
	StatusReturned     = "Returned"
	StatusReleased     = "Released"
)

type Packet struct {
	config.TenantScoped
	ID               uint             `json:"id" gorm:"primaryKey"`
	Code             string           `json:"code" gorm:"index;not null;size:30"`
	LoanID           uint             `json:"loan_id" gorm:"not null;index"`
	Loan             loanModels.Loan  `json:"loan" gorm:"foreignKey:LoanID"`
	Status           string           `json:"status" gorm:"not null;size:30"`
	CurrentLockerID  *uint            `json:"current_locker_id"`
	TotalGrossWeight float64          `json:"total_gross_weight" gorm:"type:numeric(16,3);default:0"`
	TotalNetWeight   float64          `json:"total_net_weight" gorm:"type:numeric(16,3);default:0"`
	Movements        []PacketMovement `json:"movements,omitempty" gorm:"foreignKey:PacketID"`
	CreatedAt        time.Time        `json:"created_at"`
	UpdatedAt        time.Time        `json:"updated_at"`
}

type PacketMovement struct {
	config.TenantScoped
	ID              uint      `json:"id" gorm:"primaryKey"`
	PacketID        uint      `json:"packet_id" gorm:"not null;index"`
	FromStatus      string    `json:"from_status" gorm:"size:30"`
	ToStatus        string    `json:"to_status" gorm:"not null;size:30"`
	LockerID        *uint     `json:"locker_id"`
	ActorEmployeeID uint      `json:"actor_employee_id"`
	Remarks         string    `json:"remarks" gorm:"size:255"`
	CreatedAt       time.Time `json:"created_at"`
}
