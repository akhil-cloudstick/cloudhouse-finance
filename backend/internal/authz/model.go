// Package authz implements the (currently allow-all) role-based permission
// table backing RequirePermission (see platform/middleware.go). It exists
// now so a future admin screen can flip individual (role, resource, action)
// rows to false without any code change/redeploy.
package authz

// Permission is a single (Role, Resource, Action) -> Allowed rule.
// Resource is a module key ("banks", "loans", "customers", ...); Action is
// CRUD-grain ("create", "read", "update", "delete").
type Permission struct {
	ID       uint   `json:"id" gorm:"primaryKey"`
	Role     string `json:"role" gorm:"not null;size:60;uniqueIndex:idx_permissions_role_resource_action"`
	Resource string `json:"resource" gorm:"not null;size:60;uniqueIndex:idx_permissions_role_resource_action"`
	Action   string `json:"action" gorm:"not null;size:20;uniqueIndex:idx_permissions_role_resource_action"`
	Allowed  bool   `json:"allowed"`
}

// TableName pins the GORM table name explicitly.
func (Permission) TableName() string {
	return "permissions"
}
