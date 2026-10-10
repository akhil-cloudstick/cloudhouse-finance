package models

import (
	"cloudhouse/backend/config"
	"time"
)

const (
	ActionBranchCreated = "branch_created"
	ActionBranchUpdated = "branch_updated"
)

type Entry struct {
	config.TenantScoped
	ID              uint      `json:"id" gorm:"primaryKey"`
	ActorEmployeeID uint      `json:"actor_employee_id" gorm:"not null;index"`
	ActorName       string    `json:"actor_name" gorm:"not null;size:120"`
	Action          string    `json:"action" gorm:"not null;size:60;index"`
	EntityType      string    `json:"entity_type" gorm:"not null;size:40"`
	EntityID        uint      `json:"entity_id" gorm:"not null;index"`
	EntityName      string    `json:"entity_name" gorm:"size:160"`
	Detail          string    `json:"detail" gorm:"type:text"`
	CreatedAt       time.Time `json:"created_at"`
}

func (Entry) TableName() string { return "audit_log_entries" }
