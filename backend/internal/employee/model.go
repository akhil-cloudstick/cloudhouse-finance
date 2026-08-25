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
	ID   uint   `json:"id" gorm:"primaryKey"`
	Code string `json:"code" gorm:"uniqueIndex;size:20"`
	Name string `json:"name" gorm:"not null;size:120"`
	// Role is the free-text role name the app reads/writes — kept for
	// display and as the single field Create/Update actually set. RoleID is
	// the authorization key (see internal/authz.Role); internal/migrate
	// keeps it in sync with Role on every boot (see
	// migrate.BackfillEmployeeRoleID), so it never needs to be threaded
	// through employee.Service itself.
	Role     string        `json:"role" gorm:"not null;size:60"`
	RoleID   uint          `json:"roleId"`
	BranchID uint          `json:"branchId" gorm:"not null"`
	Branch   branch.Branch `json:"branch" gorm:"foreignKey:BranchID"`
	// Phone doubles as a login identifier (see internal/auth's Login,
	// which accepts either Username or Phone) — the partial uniqueIndex
	// (WHERE phone <> '') mirrors Email's/Username's convention below, so
	// any number of employees without a phone set can coexist, but a
	// non-blank phone must be unique across employees.
	Phone          string  `json:"phone" gorm:"uniqueIndex:idx_employees_phone,where:phone <> '';size:20"`
	LoansProcessed int     `json:"loansProcessed"`
	Collections    float64 `json:"collections"`
	Followups      int     `json:"followups"`
	Pending        int     `json:"pending"`
	// Username/Phone + PasswordHash enable login for this employee (see
	// internal/auth) — login no longer uses Email (kept below for any
	// other contact-info use, but it plays no role in authentication).
	// Both Username and Phone are nullable/unique via partial indexes
	// (WHERE ... <> '') so any number of employees without one set (empty
	// string, the zero value — Postgres does NOT treat repeated '' as
	// NULL) can coexist; only non-blank values are required to be unique.
	Username     string `json:"username,omitempty" gorm:"uniqueIndex:idx_employees_username,where:username <> '';size:60"`
	Email        string `json:"email,omitempty" gorm:"uniqueIndex:idx_employees_email,where:email <> '';size:120"`
	PasswordHash string `json:"-" gorm:"size:255"`
	// PasswordResetTokenHash/PasswordResetExpiresAt now store the SHA-256
	// hash of a 6-digit SMS OTP (10-minute TTL) rather than a 32-byte
	// emailed link token — same fields, shorter-lived, see
	// internal/auth/service.go's ForgotPassword/ResetPassword.
	PasswordResetTokenHash string         `json:"-" gorm:"size:64"`
	PasswordResetExpiresAt *time.Time     `json:"-"`
	CreatedAt              time.Time      `json:"createdAt"`
	UpdatedAt              time.Time      `json:"updatedAt"`
	DeletedAt              gorm.DeletedAt `json:"-" gorm:"index"`
}

func (Employee) TableName() string {
	return "employees"
}
