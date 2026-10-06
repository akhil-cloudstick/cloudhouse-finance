package loan

import (
	"time"

	"cloudhouse/backend/internal/platform"
)

// ApprovalLimit is the schema of the retired per-role sanction ceiling. The
// Loan Operator limit it stored (and the endpoints, seeding and enforcement
// around it) has been removed — nothing reads or writes this table any more.
// The model is kept only so the existing approval_limits table stays in the
// tenant-isolation and hard-delete table lists; dropping the table itself is
// a separate migration.
type ApprovalLimit struct {
	platform.TenantScoped
	ID        uint      `json:"id" gorm:"primaryKey"`
	Role      string    `json:"role" gorm:"index;not null;size:40"`
	MaxAmount float64   `json:"maxAmount" gorm:"not null"`
	UpdatedAt time.Time `json:"updatedAt"`
}

func (ApprovalLimit) TableName() string { return "approval_limits" }
