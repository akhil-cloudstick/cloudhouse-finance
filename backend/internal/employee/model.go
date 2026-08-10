// Package employee implements the staff/roles domain
// (frontend/components/Employees.tsx).
package employee

import (
	"time"

	"gorm.io/gorm"

	"ambikagold/backend/internal/branch"
)

// Employee represents a staff member and their running performance
// counters (loans processed, collections, follow-ups, pending items).
type Employee struct {
	ID             uint           `json:"id" gorm:"primaryKey"`
	Code           string         `json:"code" gorm:"uniqueIndex;size:20"`
	Name           string         `json:"name" gorm:"not null;size:120"`
	Role           string         `json:"role" gorm:"not null;size:60"`
	BranchID       uint           `json:"branchId" gorm:"not null"`
	Branch         branch.Branch  `json:"branch" gorm:"foreignKey:BranchID"`
	Phone          string         `json:"phone" gorm:"size:20"`
	LoansProcessed int            `json:"loansProcessed"`
	Collections    float64        `json:"collections"`
	Followups      int            `json:"followups"`
	Pending        int            `json:"pending"`
	CreatedAt      time.Time      `json:"createdAt"`
	UpdatedAt      time.Time      `json:"updatedAt"`
	DeletedAt      gorm.DeletedAt `json:"-" gorm:"index"`
}

func (Employee) TableName() string {
	return "employees"
}
