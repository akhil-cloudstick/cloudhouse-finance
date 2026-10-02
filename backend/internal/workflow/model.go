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

// ApprovalChain is one tenant's ordered approver roles for one scope: a
// flow key, or "cat:<category>" for the chain a category shares across all
// its flows (see ApprovalCategoryMode). A missing row means the flow's
// legacy default applies (see Service.Chain). RoleIDs is comma-separated in
// approval order ("4,7,2"); an empty string is a saved empty chain.
type ApprovalChain struct {
	platform.TenantScoped
	ID        uint      `json:"id" gorm:"primaryKey"`
	Scope     string    `json:"scope" gorm:"size:60;not null;index:idx_approval_chains_scope"`
	RoleIDs   string    `json:"roleIds" gorm:"size:500"`
	UpdatedAt time.Time `json:"updatedAt"`
}

func (ApprovalChain) TableName() string { return "approval_chains" }

// ApprovalCategoryMode records whether a category's flows share one chain.
// A missing row means not shared.
type ApprovalCategoryMode struct {
	platform.TenantScoped
	ID        uint      `json:"id" gorm:"primaryKey"`
	Category  string    `json:"category" gorm:"size:40;not null;index:idx_approval_category_modes_category"`
	Shared    bool      `json:"shared"`
	UpdatedAt time.Time `json:"updatedAt"`
}

func (ApprovalCategoryMode) TableName() string { return "approval_category_modes" }

// sharedScope is the ApprovalChain scope of a category's shared chain.
func sharedScope(category string) string { return "cat:" + category }

// roleRow is the slice of authz.Role this package reads — queried straight
// from the tenant-scoped roles table so workflow need not import authz.
type roleRow struct {
	ID       uint
	Name     string
	IsActive bool
	IsSystem bool
}

func (roleRow) TableName() string { return "roles" }
