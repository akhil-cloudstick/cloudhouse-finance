package workflow

import (
	"time"

	"cloudhouse/backend/internal/platform"
)

// ApprovalStageSetting is one tenant's on/off for one stage of one flow.
// A missing row means the stage's DefaultEnabled from Catalogue applies, so
// neither existing nor newly provisioned tenants need seeding.
type ApprovalStageSetting struct {
	platform.TenantScoped
	ID        uint      `json:"id" gorm:"primaryKey"`
	Flow      string    `json:"flow" gorm:"size:40;not null;index:idx_approval_stage_settings_flow_stage"`
	Stage     string    `json:"stage" gorm:"size:40;not null;index:idx_approval_stage_settings_flow_stage"`
	Enabled   bool      `json:"enabled"`
	UpdatedAt time.Time `json:"updatedAt"`
}

func (ApprovalStageSetting) TableName() string { return "approval_stage_settings" }

// ApprovalAction is the audit trail for the flows that have no audit table
// of their own (top-up, personal loan): one row per decision taken at a
// stage. The older flows keep loan_approvals / request_approvals.
type ApprovalAction struct {
	platform.TenantScoped
	ID              uint      `json:"id" gorm:"primaryKey"`
	Flow            string    `json:"flow" gorm:"size:40;not null;index:idx_approval_actions_entity"`
	EntityID        uint      `json:"entityId" gorm:"not null;index:idx_approval_actions_entity"`
	Stage           string    `json:"stage" gorm:"size:40"`
	Action          string    `json:"action" gorm:"size:20"`
	ActorEmployeeID uint      `json:"actorEmployeeId"`
	ActorRole       string    `json:"actorRole" gorm:"size:60"`
	Remarks         string    `json:"remarks"`
	CreatedAt       time.Time `json:"createdAt"`
}

func (ApprovalAction) TableName() string { return "approval_actions" }

// Stage-decision actions shared by every flow.
const (
	ActionApproved = "Approved"
	ActionRejected = "Rejected"
)
