package models

import "time"

const (
	BuildTypeFull    = "full"
	BuildTypeContent = "content"

	StatusQueued    = "queued"
	StatusPreparing = "preparing"
	StatusBuilding  = "building"
	StatusUploading = "uploading"
	StatusVerifying = "verifying"
	StatusDone      = "done"
	StatusFailed    = "failed"
	StatusCancelled = "cancelled"
)

// ReleaseJob is one real build: one tenant (or "common" for content), one OS.
type ReleaseJob struct {
	ID               uint      `json:"id" gorm:"primaryKey"`
	TenantCode       string    `json:"tenant_code" gorm:"not null;size:60;index"`
	OS               string    `json:"os" gorm:"not null;size:10"`
	Version          string    `json:"version" gorm:"not null;size:30"`
	BuildType        string    `json:"build_type" gorm:"not null;size:10;default:full"`
	Status           string    `json:"status" gorm:"not null;size:12;default:queued"`
	DispatchToken    string    `json:"-" gorm:"column:dispatch_token;size:40"`
	GitHubRunID      *int64    `json:"-" gorm:"column:github_run_id"`
	CreatedByAdminID *uint     `json:"-" gorm:"column:created_by_admin_id"`
	CreatedAt        time.Time `json:"created_at"`
	UpdatedAt        time.Time `json:"updated_at"`
}

func (ReleaseJob) TableName() string { return "desktop_release_jobs" }
