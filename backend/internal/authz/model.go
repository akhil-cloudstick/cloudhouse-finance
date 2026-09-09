// Package authz implements the role-based permission model backing
// RequirePermission (see platform/middleware.go): roles, the permission
// catalogue, and the role_permissions grant table joining them. An
// administrator edits role_permissions rows via the endpoints in
// handler.go/routes.go — no code change/redeploy needed to change who may do
// what.
package authz

import (
	"cloudhouse/backend/internal/platform"
	"time"
)

// Role is a staff role (Administrator, Cashier, ...). IsSystem marks a role
// that must never be renamed, deactivated, deleted or have its grants
// changed (Administrator — see repository.go's guards).
type Role struct {
	platform.TenantScoped
	ID          uint      `json:"id" gorm:"primaryKey"`
	Name        string    `json:"name" gorm:"index;not null;size:60"`
	Description string    `json:"description"`
	IsActive    bool      `json:"isActive" gorm:"not null;default:true"`
	IsSystem    bool      `json:"isSystem" gorm:"not null;default:false"`
	CreatedAt   time.Time `json:"createdAt"`
	UpdatedAt   time.Time `json:"updatedAt"`
}

func (Role) TableName() string { return "roles" }

// Permission is one catalogue entry, e.g. {Name: "can view loan", ModuleName:
// "Loan Management"}. Name is the wire contract — it appears verbatim in
// route middleware and (space-for-underscore derived) in the frontend
// permission map, so it is never edited in place once shipped (see the
// standard's renaming rules).
type Permission struct {
	ID          uint   `json:"id" gorm:"primaryKey"`
	Name        string `json:"name" gorm:"uniqueIndex;not null;size:120"`
	Description string `json:"description"`
	ModuleName  string `json:"moduleName" gorm:"not null;index;size:80"`
	IsActive    bool   `json:"isActive" gorm:"not null;default:true"`
}

func (Permission) TableName() string { return "permissions" }

// RolePermission is the grant join row: does Role RoleID hold Permission
// PermissionID. Every (role, permission) pair gets a row (see
// SeedCatalogue/BackfillGrants) — revoking sets Permission=false, it never
// deletes the row (see the standard's §4.2).
type RolePermission struct {
	platform.TenantScoped
	ID           uint `json:"id" gorm:"primaryKey"`
	RoleID       uint `json:"roleId" gorm:"not null;index;uniqueIndex:idx_role_permission"`
	PermissionID uint `json:"permissionId" gorm:"not null;index;uniqueIndex:idx_role_permission"`
	Permission   bool `json:"permission" gorm:"not null;default:true"`
}

func (RolePermission) TableName() string { return "role_permissions" }
