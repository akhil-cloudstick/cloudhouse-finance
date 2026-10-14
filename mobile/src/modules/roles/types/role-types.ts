

// Mirrors src/common/services/permissionService.ts — same endpoints,
// same envelope split (the /roles CRUD endpoints are still bare-resource;
// only /employees/:id/permissions has migrated to the house envelope, same
// as src/common/services/permissionService.ts's fetchMyPermissions).

/** One row of GET /employees/:id/permissions's matrix — see
 * backend/internal/authz.Repository.AdminMatrix. */
/** A related permission, with its granted state — parents must all be on before a permission can be; dependents are switched off with it. */
export type PermissionRef = {
  permission_id: number;
  name: string;
  label: string;
  granted: boolean;
};
export type PermissionRow = {
  id: number;
  role_id: number;
  permission_id: number;
  permission: boolean;
  permissions: { id: number; name: string; description: string; moduleName: string; isActive: boolean };
  parents?: PermissionRef[];
  soft_parents?: PermissionRef[];
  dependents?: PermissionRef[];
};
export type RoleRecord = {
  id: number;
  name: string;
  description: string;
  isActive: boolean;
  isSystem: boolean;
  createdAt: string;
  updatedAt: string;
};
export type MatrixResponse = {
  success: boolean;
  role: RoleRecord;
  data: Record<string, PermissionRow[]>;
};
