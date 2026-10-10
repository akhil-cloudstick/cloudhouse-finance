package models

import (
	"time"
)

type SuperAdminUser struct {
	ID           uint      `json:"id" gorm:"primaryKey"`
	Name         string    `json:"name" gorm:"not null;size:120"`
	Username     string    `json:"username" gorm:"uniqueIndex;not null;size:60"`
	PasswordHash string    `json:"-" gorm:"not null"`
	IsActive     bool      `json:"is_active" gorm:"not null;default:true"`
	CreatedAt    time.Time `json:"created_at"`
	UpdatedAt    time.Time `json:"updated_at"`
}

type AuditLog struct {
	ID               uint      `json:"id" gorm:"primaryKey"`
	SuperAdminUserID uint      `json:"super_admin_user_id" gorm:"not null;index"`
	ActorName        string    `json:"actor_name" gorm:"not null;size:120"`
	Action           string    `json:"action" gorm:"not null;size:60;index"`
	TenantID         *uint     `json:"tenant_id,omitempty" gorm:"index"`
	TenantName       string    `json:"tenant_name,omitempty" gorm:"size:160"`
	Detail           string    `json:"detail" gorm:"type:text"`
	Reason           string    `json:"reason" gorm:"not null;type:text"`
	IPAddress        string    `json:"ip_address" gorm:"size:64"`
	CreatedAt        time.Time `json:"created_at"`
}

func (SuperAdminUser) TableName() string { return "superadmin_users" }

func (AuditLog) TableName() string { return "superadmin_audit_logs" }
