package models

import (
	"cloudhouse/backend/config"
	"time"
)

const (
	ActionRejected = "Rejected"
)

type ApprovalStageSetting struct {
	config.TenantScoped
	ID        uint      `json:"id" gorm:"primaryKey"`
	Flow      string    `json:"flow" gorm:"size:40;not null;index:idx_approval_stage_settings_flow_stage"`
	Stage     string    `json:"stage" gorm:"size:40;not null;index:idx_approval_stage_settings_flow_stage"`
	Enabled   bool      `json:"enabled"`
	UpdatedAt time.Time `json:"updated_at"`
}

type ApprovalAction struct {
	config.TenantScoped
	ID              uint      `json:"id" gorm:"primaryKey"`
	Flow            string    `json:"flow" gorm:"size:40;not null;index:idx_approval_actions_entity"`
	EntityID        uint      `json:"entity_id" gorm:"not null;index:idx_approval_actions_entity"`
	Stage           string    `json:"stage" gorm:"size:40"`
	Action          string    `json:"action" gorm:"size:20"`
	ActorEmployeeID uint      `json:"actor_employee_id"`
	ActorRole       string    `json:"actor_role" gorm:"size:60"`
	Remarks         string    `json:"remarks"`
	CreatedAt       time.Time `json:"created_at"`
}

type ApprovalChain struct {
	config.TenantScoped
	ID        uint      `json:"id" gorm:"primaryKey"`
	Scope     string    `json:"scope" gorm:"size:60;not null;index:idx_approval_chains_scope"`
	RoleIDs   string    `json:"role_ids" gorm:"size:500"`
	UpdatedAt time.Time `json:"updated_at"`
}

type ApprovalCategoryMode struct {
	config.TenantScoped
	ID        uint      `json:"id" gorm:"primaryKey"`
	Category  string    `json:"category" gorm:"size:40;not null;index:idx_approval_category_modes_category"`
	Shared    bool      `json:"shared"`
	UpdatedAt time.Time `json:"updated_at"`
}

type RoleRow struct {
	ID       uint
	Name     string
	IsActive bool
	IsSystem bool
}

func (RoleRow) TableName() string { return "roles" }
