package models

import (
	"cloudhouse/backend/config"
	"time"
)

type Snapshot struct {
	config.TenantScoped
	ID                   uint      `json:"id" gorm:"primaryKey"`
	Date                 time.Time `json:"date" gorm:"not null;index"`
	ActiveCount          int       `json:"active_count"`
	OverdueCount         int       `json:"overdue_count"`
	PendingApprovalCount int       `json:"pending_approval_count"`
	OpenedTodayCount     int       `json:"opened_today_count"`
	DueTodayCount        int       `json:"due_today_count"`
	CreatedAt            time.Time `json:"created_at"`
}

func (Snapshot) TableName() string {
	return "dashboard_snapshots"
}
