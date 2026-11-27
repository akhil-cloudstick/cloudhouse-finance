

// Shape of GET /employees/:id/permissions/by-employee's data (see
// backend/internal/authz.Repository.BootstrapPermissions) — one boolean map
// per module, keyed by the underscored permission name. Mirrors
// src/common/services/permissionService.ts's PermissionMap.
export type PermissionMap = Record<string, Record<string, boolean>>;
