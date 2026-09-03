package dashboard

import "time"

// Snapshot is one day's captured KPI counts for the mobile dashboard's trend
// indicators — an append-only row per calendar day, mirroring
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
type Snapshot struct {
	ID                   uint      `json:"id" gorm:"primaryKey"`
	Date                 time.Time `json:"date" gorm:"not null;uniqueIndex"`
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
