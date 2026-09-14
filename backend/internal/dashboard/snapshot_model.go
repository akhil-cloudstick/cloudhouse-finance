package dashboard

import (
	"time"

	"cloudhouse/backend/internal/platform"
)

// Snapshot is one day's captured KPI counts for the mobile dashboard's trend
// indicators — an append-only row per calendar day PER BUSINESS, mirroring
// internal/goldrate.GoldRate's "never update in place, latest by Date wins"
// shape. Package dashboard otherwise holds no persisted model of its own
// (see doc comment on model.go); this is the first, added specifically so
// each KPI card can show a real vs-yesterday change rather than a fabricated
// one.
//
// Counts mirror the mobile Dashboard screen's own live computation
// (app/(tabs)/dashboard.tsx): ActiveCount/OverdueCount/PendingApprovalCount
// are loan.Status counts, OpenedTodayCount is loans whose OpenedDate is that
// day, DueTodayCount is open loans whose DueDate is that day.
//
// # Why this is tenant-scoped, and was not
//
// This table shipped with no tenant_id at all, a GLOBALLY unique Date, a
// repository that never attached a context, and a capture job that ran under
// platform.AllowCrossTenant. Every one of those four independently defeated
// the tenant filter, and together they meant one row per day held the counts
// of EVERY business added together — and every business's dashboard read it.
// A customer could infer a competitor's loan book size from the trend cards
// on their own screen. The uniqueness is now per (tenant_id, date), so each
// business captures and reads its own row.
type Snapshot struct {
	platform.TenantScoped
	ID uint `json:"id" gorm:"primaryKey"`
	// Not `uniqueIndex` here: uniqueness is composite, on
	// (tenant_id, date), and is created by internal/migrate's
	// tenantUniqueIndexes pass after the backfill — the same treatment every
	// other per-tenant unique column gets. A bare uniqueIndex on date would
	// let the FIRST business to capture a day lock every other business out
	// of capturing it.
	Date                 time.Time `json:"date" gorm:"not null;index"`
	ActiveCount          int       `json:"activeCount"`
	OverdueCount         int       `json:"overdueCount"`
	PendingApprovalCount int       `json:"pendingApprovalCount"`
	OpenedTodayCount     int       `json:"openedTodayCount"`
	DueTodayCount        int       `json:"dueTodayCount"`
	CreatedAt            time.Time `json:"createdAt"`
}

func (Snapshot) TableName() string {
	return "dashboard_snapshots"
}
