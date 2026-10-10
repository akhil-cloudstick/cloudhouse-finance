package models

import (
	"cloudhouse/backend/config"
	"time"
)

type Role struct {
	config.TenantScoped
	ID          uint      `json:"id" gorm:"primaryKey"`
	Name        string    `json:"name" gorm:"index;not null;size:60"`
	Description string    `json:"description"`
	IsActive    bool      `json:"is_active" gorm:"not null;default:true"`
	IsSystem    bool      `json:"is_system" gorm:"not null;default:false"`
	CreatedAt   time.Time `json:"created_at"`
	UpdatedAt   time.Time `json:"updated_at"`
}

type Permission struct {
	ID          uint   `json:"id" gorm:"primaryKey"`
	Name        string `json:"name" gorm:"uniqueIndex;not null;size:120"`
	Description string `json:"description"`
	ModuleName  string `json:"module_name" gorm:"not null;index;size:80"`
	IsActive    bool   `json:"is_active" gorm:"not null;default:true"`
}

type RolePermission struct {
	config.TenantScoped
	ID           uint `json:"id" gorm:"primaryKey"`
	RoleID       uint `json:"role_id" gorm:"not null;index;uniqueIndex:idx_role_permission"`
	PermissionID uint `json:"permission_id" gorm:"not null;index;uniqueIndex:idx_role_permission"`
	Permission   bool `json:"permission" gorm:"not null;default:true"`
}
