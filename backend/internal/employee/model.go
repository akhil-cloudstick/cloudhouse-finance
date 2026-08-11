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
	// Email/PasswordHash enable login for this employee (see internal/auth).
	// Email is nullable/unique so existing unmigrated employees can keep
	// blank emails without violating the unique index (GORM/Postgres treat
	// multiple NULLs as distinct under a unique index, but multiple empty
	// strings would collide — the service layer stores "" as NULL via a
	// pointer-less convention: see employee/service.go Update()).
	// The uniqueIndex is declared as a partial index (WHERE email <> '') so
	// that any number of employees without an email set (empty string, the
	// zero value — Postgres does NOT treat repeated '' as NULL) can coexist;
	// only non-blank emails are required to be unique.
	Email                   string     `json:"email,omitempty" gorm:"uniqueIndex:idx_employees_email,where:email <> '';size:120"`
	PasswordHash            string     `json:"-" gorm:"size:255"`
	PasswordResetTokenHash  string     `json:"-" gorm:"size:64"`
	PasswordResetExpiresAt  *time.Time `json:"-"`
	CreatedAt      time.Time      `json:"createdAt"`
	UpdatedAt      time.Time      `json:"updatedAt"`
	DeletedAt      gorm.DeletedAt `json:"-" gorm:"index"`
}

func (Employee) TableName() string {
	return "employees"
}
