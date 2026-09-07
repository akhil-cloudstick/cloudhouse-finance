// Package superadmin implements the console our own team uses to administer
// every business on this deployment: create one, put it on a plan, suspend
// it, adjust its expiry.
//
// Deliberately a separate identity domain from everything else in this
// codebase — its own table (SuperAdminUser), its own JWT scheme
// (platform.SuperAdminClaims), its own middleware (platform.SuperAdminAuthMiddleware)
// — and never gated by platform.CRUDPermissions. Tenant role assignments
// must have no bearing on who can create, suspend or re-tier a business: an
// employee accumulating permissions inside their own tenant must never be
// one misconfigured grant away from these routes. See the multi-tenancy
// plan, Step 7.
//
// Every method here legitimately spans every business on the deployment,
// which is the one thing internal/tenant's own package doc warns is
// dangerous to mount behind ordinary employee auth — this package is
// where that capability finally gets a front door, gated the right way.
package superadmin

import "time"

// SuperAdminUser is our own team's login — never a tenant's employee, never
// carrying a tenant_id, and never reachable through the tenant-scoped query
// filter (it has no TenantScoped embed, so the filter ignores this table
// entirely, exactly like authz.Permission and settings.ApiKeySetting).
type SuperAdminUser struct {
	ID           uint      `json:"id" gorm:"primaryKey"`
	Name         string    `json:"name" gorm:"not null;size:120"`
	Username     string    `json:"username" gorm:"uniqueIndex;not null;size:60"`
	PasswordHash string    `json:"-" gorm:"not null"`
	IsActive     bool      `json:"isActive" gorm:"not null;default:true"`
	CreatedAt    time.Time `json:"createdAt"`
	UpdatedAt    time.Time `json:"updatedAt"`
}

func (SuperAdminUser) TableName() string { return "superadmin_users" }

// AuditLog is an append-only record of every privileged superadmin action —
// every one that moves money or unlocks access, per the plan: create/suspend/
// reactivate a business, change its tier, adjust its expiry.
//
// No update or delete route exists anywhere for this table, on purpose: a
// log that can be edited after the fact is not a log.
type AuditLog struct {
	ID uint `json:"id" gorm:"primaryKey"`

	SuperAdminUserID uint `json:"superAdminUserId" gorm:"not null;index"`
	// ActorName is captured at write time rather than joined from SuperAdminUser
	// on read, so that even if a superadmin account were ever removed, the
	// record of what they did survives intact.
	ActorName string `json:"actorName" gorm:"not null;size:120"`

	// Action is a short fixed string — see the Action* constants below —
	// not free text, so the log stays filterable and every action this
	// package can take is enumerable in one place.
	Action string `json:"action" gorm:"not null;size:60;index"`

	// TenantID is nil only for an action with no single business to point
	// at (there are none today, but the column stays nullable rather than
	// forcing a fake 0 into a "which business" field).
	TenantID *uint `json:"tenantId,omitempty" gorm:"index"`
	// TenantName is captured at write time for the same reason ActorName is
	// — the audit trail must read correctly even after a business is
	// renamed or (eventually) hard-deleted.
	TenantName string `json:"tenantName,omitempty" gorm:"size:160"`

	// Detail is a short machine-generated description of what changed
	// (e.g. "tier: Starter -> Growth"), never itself the accountability —
	// Reason below is.
	Detail string `json:"detail" gorm:"type:text"`

	// Reason is the actor's own stated justification, required on every
	// mutating superadmin action and never inferred or defaulted. This is the
	// whole point of the table: "who did it, when, and the reason they
	// typed" — the plan's own words for why this exists as its own tab
	// rather than being buried as an incidental log line.
	Reason string `json:"reason" gorm:"not null;type:text"`

	IPAddress string    `json:"ipAddress" gorm:"size:64"`
	CreatedAt time.Time `json:"createdAt"`
}

func (AuditLog) TableName() string { return "superadmin_audit_logs" }

// Action* enumerates every privileged action this package can log. Kept as
// a closed set (rather than a free string any caller can invent) so
// "every action that moves money or unlocks access is logged" is something
// this file's contents can actually attest to, not just a convention callers
// are trusted to follow.
const (
	ActionCreateBusiness     = "create_business"
	ActionSuspendBusiness    = "suspend_business"
	ActionReactivateBusiness = "reactivate_business"
	ActionChangeTier         = "change_tier"
	ActionAdjustExpiry       = "adjust_expiry"
	// ActionSetTierPrice logs a tier's Razorpay subscription price being
	// set/changed (plan Step 10, internal/billing) — this moves real money
	// on every business subscribed to that tier going forward, so it gets
	// the same mandatory-reason audit trail as every other lever here.
	ActionSetTierPrice = "set_tier_price"
)
