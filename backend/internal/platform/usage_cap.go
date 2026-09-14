package platform

import (
	"context"
	"fmt"
	"time"

	"cloudhouse/backend/internal/platform/httpx"
)

// UsageCounter tracks how many times ONE business has used a shared outbound
// channel (WhatsApp, SMS, KYC verification) on a given day.
//
// Multi-tenancy plan, Step 13. Shared KYC/SMS/WhatsApp credentials stay
// shared by explicit product decision — the alternative (separate
// credentials per business) was rejected knowingly, accepting
// noisy-neighbour rate limits, the vendor's bill, and weak regulatory
// attribution as the cost. This is the other half of that decision: a per-
// business daily cap, so one tenant cannot spend the whole deployment's
// shared quota or budget on its own.
//
// Mirrors Sequence's shape deliberately (see sequence.go) — allocation
// bookkeeping, not business data, so it is exempt from the automatic tenant
// filter the same way `sequences` is (see
// platform.TestScopedTableSetIsNotEmptyAndHasNoGlobals's global-table list
// and the isolation harness's matching exemption).
type UsageCounter struct {
	TenantID uint      `gorm:"primaryKey"`
	Category string    `gorm:"primaryKey;size:40"`
	Day      time.Time `gorm:"primaryKey"` // truncated to the date, no time component
	Count    uint      `gorm:"not null;default:0"`
}

func (UsageCounter) TableName() string { return "usage_counters" }

// Usage categories. One per shared-credential channel this caps.
const (
	UsageWhatsApp    = "whatsapp"
	UsageSMS         = "sms"
	UsageSetuPAN     = "setu_pan"
	UsageSetuAadhaar = "setu_aadhaar"
	UsageSetuEsign   = "setu_esign"
)

// DefaultDailyUsageCap is the fallback ceiling for a category with no
// explicit override in dailyUsageCaps. Generous on purpose — this exists to
// catch a runaway loop or a compromised account spending the shared
// deployment's quota, not to constrain a business's ordinary daily volume.
const DefaultDailyUsageCap = 2000

// dailyUsageCaps overrides the default per category. KYC verification calls
// (Setu) cost real money per call in a way a WhatsApp/SMS send does not, so
// they get a tighter cap.
var dailyUsageCaps = map[string]uint{
	UsageSetuPAN:     200,
	UsageSetuAadhaar: 200,
	UsageSetuEsign:   100,
}

func capFor(category string) uint {
	if c, ok := dailyUsageCaps[category]; ok {
		return c
	}
	return DefaultDailyUsageCap
}

// ErrUsageCapExceeded is returned by CheckAndRecordUsage once a business has
// used up its daily allowance for a category. Typed via httpx.NewConflict
// (same convention as ErrLockerFull, ErrInUse, etc.) so httpx.FailErr renders
// it as a specific 409 with this exact message, instead of falling through
// to the generic 400 "something went wrong" every untyped error gets.
var ErrUsageCapExceeded = httpx.NewConflict("daily usage limit reached for this business — try again tomorrow, or contact support")

// CheckAndRecordUsage atomically increments today's counter for
// (tenantID, category) and refuses if that PUSHES the count over the cap —
// so the call that would exceed the limit is the one refused, not silently
// let through one late. Call this BEFORE the outbound send/API call it
// guards, never after: the point is to stop the call from happening at all,
// not to count it retroactively.
//
// The upsert-and-check happens as one round trip (INSERT ... ON CONFLICT DO
// UPDATE ... RETURNING), so two concurrent requests from the same business
// cannot both slip through half a count over the cap the way a separate
// read-then-write would allow — the same race ReserveBranchSlot's own
// transaction closes for branch quota.
//
// tenantID must be non-zero; a cross-tenant/background context has no
// business to charge the usage to and must resolve one before calling this.
// The handle is platform.DB so callers can pass either the shared pool or a
// ConnPinner without caring which. The query deliberately runs on the SHARED
// pool (context.Background carries no pinned connection): usage_counters is
// deployment-wide bookkeeping for shared provider credentials, not one
// business's data, so it is exempt from the tenant filter and carries no RLS
// policy — see its type doc.
func CheckAndRecordUsage(db DB, tenantID uint, category string) error {
	if tenantID == 0 {
		return fmt.Errorf("platform: CheckAndRecordUsage requires a tenant (category %q)", category)
	}
	today := time.Now().UTC().Truncate(24 * time.Hour)

	var count uint
	err := db.WithContext(context.Background()).Raw(`
		INSERT INTO usage_counters (tenant_id, category, day, count)
		VALUES (?, ?, ?, 1)
		ON CONFLICT (tenant_id, category, day)
		DO UPDATE SET count = usage_counters.count + 1
		RETURNING count`, tenantID, category, today).Scan(&count).Error
	if err != nil {
		return fmt.Errorf("recording usage: %w", err)
	}
	if count > capFor(category) {
		return ErrUsageCapExceeded
	}
	return nil
}
