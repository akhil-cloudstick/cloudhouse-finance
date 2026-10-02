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
	// two concurrent requests both pass the check. 0 means UNLIMITED (see
	// UnlimitedBranches / Repository.ReserveBranchSlot).
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

// UnlimitedBranches is the BranchQuota value meaning "no branch limit".
const UnlimitedBranches uint = 0

// IsUnlimited reports whether this tier places no cap on active branches.
func (t Tier) IsUnlimited() bool { return t.BranchQuota == UnlimitedBranches }

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

	// --- Business profile ---------------------------------------------------
	//
	// Every field below is OPTIONAL and falls back to a platform default when
	// empty, so a business that predates them keeps working untouched. They
	// are the VENDOR's to set (the superadmin console), never the tenant's: a
	// business must not be able to restate its own name, address or lending
	// registration on its own legal paperwork.

	// LegalName is the full registered name printed on customer documents —
	// the pledge agreement and release form. Empty falls back to Name.
	LegalName string `json:"legalName" gorm:"size:200"`

	// ShortName is the compact identity shown where a full business name
	// does not fit or is not the point — the sidebar's bold headline, the
	// browser tab title, the login page's "Staff access to the X lending
	// console." line — e.g. "CTFI" for "Chittilapilly Thommana Financiers &
	// Investments". Empty falls back to Name, same convention as LegalName
	// falling back to Name: a business that has not set one is far better
	// served by its own name than by truncating it automatically.
	ShortName string `json:"shortName" gorm:"size:40"`

	// LockupTagline is the small uppercase line under the sidebar's bold
	// headline. It is free text because what belongs there differs per
	// business and cannot be derived: "Chittilapilly Thommana" (the full name,
	// under the short code "CTFI") for one, "Gold Finance" (a descriptor, under
	// the name itself) for the next. Empty is meaningful — the frontend then
	// falls back to Name, and suppresses the line entirely when that would
	// merely restate the headline. Deliberately NOT defaulted server-side.
	LockupTagline string `json:"lockupTagline" gorm:"size:120"`

	// AddressLine is the registered address printed under LegalName. One
	// line rather than a structured address, because one line is all any of
	// the document templates actually render.
	AddressLine string `json:"addressLine" gorm:"size:300"`

	// KMLRegNo is the Kerala Money Lenders registration number, required on
	// customer-facing lending documents.
	KMLRegNo string `json:"kmlRegNo" gorm:"size:60"`

	// Policy is the regulatory regime this business lends under, one of
	// tenant.KnownPolicies ("kml"/"gml"). It selects which FAMILY of
	// customer-facing paperwork the business issues — the kml-* or the gml-*
	// templates in backend/templates — and, through PolicyLanguages, narrows
	// which document languages it may be granted at all.
	//
	// EMPTY MEANS KML, not "none": every row predating this column was
	// already issuing the kml-* documents, so that is what unset has always
	// meant in practice and a backfill would only restate it. Never read this
	// field directly — go through PolicyOrDefault, the way EnabledModules and
	// DocumentLanguages are only ever read through HasModule/HasLanguage.
	Policy string `json:"policy" gorm:"size:20"`

	// AppURL is where this business's own frontend is deployed, e.g.
	// https://ambika.cloudhousefinance.com.
	//
	// This DID say "nothing routes by this". It now does, deliberately and in
	// one direction only (see FindByAppURL in host.go): the host a request
	// arrives on may NARROW which business a borrower is signing in to, and
	// may REFUSE a session minted for a different business, but it can never
	// grant access to one. The Host header is client-supplied and is not
	// treated as authentication anywhere — a forged host still needs a valid
	// token for the business it names, which is exactly the position an
	// attacker started from.
	//
	// Staff login is unchanged and still resolves by Code (/login/<code>).
	AppURL string `json:"appUrl" gorm:"size:200"`

	// BrandColor is the primary brand colour as "#rrggbb". The frontend
	// derives its entire ramp (deep/mid/light/pale/faint) from this single
	// value — see frontend/common/config/theme.ts. Empty means the platform
	// default.
	BrandColor string `json:"brandColor" gorm:"size:9"`

	// SecondaryColor/AccentColor are OPTIONAL second and third colours, each
	// deriving its own independent ramp the same way BrandColor does (see
	// theme.ts's deriveBrandRamp, applied per-colour). Most businesses need
	// only BrandColor; these exist for the ones whose mark genuinely uses
	// 2-3 coordinated colours rather than tints of one hue. Empty means "not
	// set" — the frontend simply does not emit the --brand2-*/--brand3-*
	// variables, so CSS that only reads --brand* is unaffected either way.
	SecondaryColor string `json:"secondaryColor" gorm:"size:9"`
	AccentColor    string `json:"accentColor" gorm:"size:9"`

	// SidebarColor is a DIRECTLY-SET colour for the sidebar/login-panel dark
	// ground — deliberately not derived from BrandColor. An earlier version
	// tried to auto-derive a "sidebar navy" from the primary colour's own
	// hue; that produced a plausible-looking colour but never an EXACT one,
	// and matching an existing brand exactly (not "close enough") is the
	// whole point of a vendor hand-entering it here. Empty means "auto": the
	// frontend derives one from BrandColor as before, so a business that has
	// not set this still gets a reasonable default rather than a flat black.
	SidebarColor string `json:"sidebarColor" gorm:"size:9"`

	// FontFamily/FontScale customise typography per business. FontFamily is
	// a key into a fixed, small allow-list the frontend ships fonts for
	// (never a free-form CSS value — see frontend/common/config/theme.ts) so
	// a typo or an arbitrary string can never load a remote font this
	// backend has not vetted. FontScale is a size preset ("compact",
	// "default", "comfortable"); empty means "default" for both.
	FontFamily string `json:"fontFamily" gorm:"size:40"`
	FontScale  string `json:"fontScale" gorm:"size:20"`

	// LogoScale/LogoDisplay tune how a logo of unusual proportions or
	// contrast sits in the fixed sidebar/header slot. LogoScale is a
	// multiplier preset ("small","default","large"); LogoDisplay picks a
	// backing behind the image ("transparent","light-pad","dark-pad") for a
	// logo that only reads clearly against one background. Both are
	// auto-suggested by the console on upload and always
	// vendor-overridable; empty means "default"/"transparent".
	LogoScale   string `json:"logoScale" gorm:"size:20"`
	LogoDisplay string `json:"logoDisplay" gorm:"size:20"`

	// LogoStorageKey points at an uploaded_files row owned by THIS tenant.
	// Stored as the key, not a URL, so the file is always served through a
	// route that re-resolves it from this row: a caller-supplied key must
	// never reach the file store (see internal/branding and upload/serve.go).
	LogoStorageKey string `json:"-" gorm:"size:120"`

	// --- Optional modules and document languages ----------------------------

	// EnabledModules is a comma-separated subset of KnownModules, and
	// EMPTY MEANS NONE — an optional module stays off until the vendor turns
	// it on, including for businesses that predate this column. Never parse
	// it at a call site; read it through HasModule.
	EnabledModules string `json:"-" gorm:"size:200"`

	// DocumentLanguages is a comma-separated subset of KnownLanguages. English
	// is always available and cannot be removed, so an empty value still
	// means ["en"] — read it through HasLanguage, never directly.
	DocumentLanguages string `json:"-" gorm:"size:60"`

	// Modules/Languages are the JSON-facing view of the two columns above,
	// populated by AfterFind so every read path hands the console arrays
	// instead of making each caller remember to split a string.
	Modules []string `json:"modules" gorm:"-"`

	// LogoURL is where this business's logo can be fetched, derived from Code
	// and LogoStorageKey. Derived rather than stored so there is exactly one
	// place that decides the shape of the URL, and so a caller can never be
	// handed a raw storage key to aim at the file store — see
	// internal/branding's logo handler.
	LogoURL   string   `json:"logoUrl" gorm:"-"`
	Languages []string `json:"languages" gorm:"-"`

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
