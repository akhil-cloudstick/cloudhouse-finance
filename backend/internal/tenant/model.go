// Package tenant implements the top-level ownership boundary of the
// multi-tenant product: one Tenant is one business that pays for the
// software, and every branch — and through it every customer, loan, packet
// and rupee — belongs to exactly one.
//
// This package deliberately exposes NO HTTP routes. Tenants are administered
// by the vendor, whose identity lives in a separate table with its own
// authentication (see the multi-tenancy plan, Step 7); mounting tenant
// endpoints before that exists would leave the most powerful operations in
// the system reachable by any authenticated employee.
//
// See documents/multitenancy_step0.md for the constraint audit, the
// authorization matrix and the attack-surface inventory this design is
// built on.
package tenant

import (
	"time"

	"gorm.io/gorm"
)

// Tenant status values. Only Active and Suspended are enforced in this
// step; the rest exist so the column never has to be widened later and so
// the billing state machine (plan Step 10) has somewhere to land.
//
// The distinction that matters for a lending product: Suspended restricts
// new lending and administration, but NEVER blocks a borrower repaying or
// collecting gold they have already paid for. Suspension is a commercial
// lever, not a reason to hold someone's property.
const (
	StatusTrial     = "trial"
	StatusActive    = "active"
	StatusPastDue   = "past_due"
	StatusGrace     = "grace"
	StatusOverQuota = "over_quota"
	StatusSuspended = "suspended"
	StatusCancelled = "cancelled"
)

// Tier is a plan the vendor sells. BranchQuota is read through the tenant's
// Tier rather than copied onto the Tenant, so correcting what "Growth"
// includes applies to every business on it at once.
type Tier struct {
	ID   uint   `json:"id" gorm:"primaryKey"`
	Name string `json:"name" gorm:"uniqueIndex;not null;size:60"`
	// BranchQuota is the maximum number of ACTIVE branches. Enforced
	// transactionally at branch creation — a plain count-then-create lets
	// two concurrent requests both pass the check.
	BranchQuota uint `json:"branchQuota" gorm:"not null;default:1"`

	// PriceInPaise is this tier's subscription price, billed monthly via
	// Razorpay Subscriptions (plan Step 10). Zero means "not billed" — a
	// tier seeded with no price (e.g. a manually-comped business) simply
	// has nothing to subscribe to; billing.Service.Subscribe refuses rather
	// than silently charging a wrong amount or the reverse. No GST/tax
	// breakdown yet — this is a plain amount, deliberately, pending
	// GST specifics confirmed against a practising CA (see the plan's
	// Step 10 note); add a tax field there once those are known rather
	// than guessing at a rate or split now.
	PriceInPaise int64 `json:"priceInPaise" gorm:"not null;default:0"`

	// RazorpayPlanID caches the Razorpay Plan created for this tier's
	// price, created lazily on first subscribe rather than up front —
	// so a tier can be renamed/adjusted before anyone has actually
	// subscribed to it without ever having called Razorpay. One Plan is
	// reused for every business on this tier; Razorpay Subscriptions are
	// created per-business against it.
	RazorpayPlanID string `json:"-" gorm:"size:64"`

	IsActive  bool      `json:"isActive" gorm:"not null;default:true"`
	CreatedAt time.Time `json:"createdAt"`
	UpdatedAt time.Time `json:"updatedAt"`
}

func (Tier) TableName() string { return "tiers" }

// Tenant is one paying business.
type Tenant struct {
	ID   uint   `json:"id" gorm:"primaryKey"`
	Name string `json:"name" gorm:"not null;size:160"`

	// Code identifies the business in its login URL (/login/<code>), which
	// is how a staff member's business is established before any credential
	// is entered — usernames are only unique within a business, so "ravi"
	// alone is ambiguous (see documents/multitenancy_step0.md).
	//
	// It is therefore part of the identity, not a display field: treat it as
	// IMMUTABLE after creation. Changing it silently breaks every saved
	// bookmark and link a business has distributed to its own staff.
	Code string `json:"code" gorm:"uniqueIndex;not null;size:32"`

	TierID uint `json:"tierId" gorm:"not null;index"`
	Tier   Tier `json:"tier,omitempty" gorm:"foreignKey:TierID"`

	Status string `json:"status" gorm:"not null;size:20;default:'active';index"`

	// SubscriptionExpiresAt/GracePeriodEndsAt are nil until billing (plan
	// Step 10) and the downgrade flow (Step 5) populate them.
	SubscriptionExpiresAt *time.Time `json:"subscriptionExpiresAt,omitempty"`
	GracePeriodEndsAt     *time.Time `json:"gracePeriodEndsAt,omitempty"`

	// RazorpaySubscriptionID identifies this business's recurring
	// subscription once billing.Service.Subscribe has created one. Empty
	// until then. This, not Status, is what a webhook uses to find which
	// business an event belongs to — Razorpay's payload carries the
	// subscription id, never a tenant id it has no reason to know.
	RazorpaySubscriptionID string `json:"-" gorm:"size:64;index"`

	// SubscriptionNotifiedAt dedupes the expiry-reminder background job
	// (billing.Service.NotifyExpiringSubscriptions) — without it, a tenant
	// sitting inside the reminder window gets messaged on every tick of the
	// job instead of once a day.
	SubscriptionNotifiedAt *time.Time `json:"-"`

	CreatedAt time.Time      `json:"createdAt"`
	UpdatedAt time.Time      `json:"updatedAt"`
	DeletedAt gorm.DeletedAt `json:"-" gorm:"index"`
}

func (Tenant) TableName() string { return "tenants" }

// CanWrite reports whether a tenant in this status may perform ordinary
// administrative writes. Callers that handle repayment or gold release must
// NOT gate on this — see the Status block's doc comment.
func (t *Tenant) CanWrite() bool {
	switch t.Status {
	case StatusSuspended, StatusCancelled:
		return false
	default:
		return true
	}
}
