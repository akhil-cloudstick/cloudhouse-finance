// Package branch implements centralized branch management. A Branch is the
// physical location every other branch-scoped record (employees, expenses,
// cash movements, and — in a future phase — customers/loans/lockers) links
// back to via BranchID.
package branch

import (
	"ambikagold/backend/internal/platform"
	"time"

	"gorm.io/gorm"
)

// Branch represents one physical branch location.
type Branch struct {
	platform.TenantScoped
	ID        uint           `json:"id" gorm:"primaryKey"`
	Name      string         `json:"name" gorm:"index;not null;size:120"`
	Code      string         `json:"code" gorm:"index;size:20"`
	Address   string         `json:"address" gorm:"not null;size:255"`
	Phone     string         `json:"phone" gorm:"size:20"`
	IsActive  bool           `json:"isActive" gorm:"not null;default:true"`
	CreatedAt time.Time      `json:"createdAt"`
	UpdatedAt time.Time      `json:"updatedAt"`
	DeletedAt gorm.DeletedAt `json:"-" gorm:"index"`
}

func (Branch) TableName() string {
	return "branches"
}
