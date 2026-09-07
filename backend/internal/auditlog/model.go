// Package auditlog is the tenant-side "who did what" record (multi-tenancy
// plan, Step 11) — distinct from internal/superadmin's audit log, which
// records the SUPERADMIN's own actions across every business. This one
// belongs to one business and is TenantScoped like any other domain table:
// a business's own record of its own staff's privileged actions.
//
// First pass, deliberately not exhaustive: wired into employee and branch
// management, the two surfaces where "who changed this" matters most —
// creating/editing/removing a staff login, and creating/editing/deactivating
// a branch. Extending coverage to the rest of the ~90 mutating endpoints is
// follow-on work, not attempted here; see Entry's own doc comment for how a
// new call site adds itself.
package auditlog

import (
	"time"

	"ambikagold/backend/internal/platform"
)

// Action* enumerates what this package can log today. Kept as a closed set
// — like internal/superadmin.Action* — so "what gets logged" stays visible
// in one place rather than becoming free text any caller can invent.
const (
	ActionEmployeeCreated   = "employee_created"
	ActionEmployeeUpdated   = "employee_updated"
	ActionEmployeeDeleted   = "employee_deleted"
	ActionBranchCreated     = "branch_created"
	ActionBranchUpdated     = "branch_updated"
	ActionBranchDeactivated = "branch_deactivated"
)

// Entry is one row: an employee of THIS business did something to some
// entity. Tenant-scoped — the automatic query filter applies to it like
// every other domain table, so one business can never see another's log.
type Entry struct {
	platform.TenantScoped
	ID uint `json:"id" gorm:"primaryKey"`

	// ActorEmployeeID/ActorName: the name is captured at write time (not
	// joined from Employee on read) so the log still reads correctly even
	// after the actor themselves is later deleted — the same reasoning as
	// internal/superadmin.AuditLog's ActorName.
	ActorEmployeeID uint   `json:"actorEmployeeId" gorm:"not null;index"`
	ActorName       string `json:"actorName" gorm:"not null;size:120"`

	Action     string `json:"action" gorm:"not null;size:60;index"`
	EntityType string `json:"entityType" gorm:"not null;size:40"`
	EntityID   uint   `json:"entityId" gorm:"not null;index"`
	// EntityName is captured at write time for the same reason ActorName
	// is — the log must still name what was changed even after that row is
	// itself deleted (an employee, say).
	EntityName string `json:"entityName" gorm:"size:160"`

	Detail string `json:"detail" gorm:"type:text"`

	CreatedAt time.Time `json:"createdAt"`
}

func (Entry) TableName() string { return "audit_log_entries" }
