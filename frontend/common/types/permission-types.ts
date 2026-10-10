

/* Shape of GET /employees/:id/permissions/by-employee's data (see
 * backend/internal/authz.Repository.BootstrapPermissions) — one boolean map
 * per module, keyed by the underscored permission name. */
export type PermissionMap = Record<string, Record<string, boolean>>;
/* A related permission in the hierarchy (backend/internal/authz/dependencies.go)
 * and whether the role holds it — label is the short name used in messages,
 * e.g. "Scheme module". */
export type PermissionRef = {
  permission_id: number;
  name: string;
  label: string;
  granted: boolean;
};
/* Admin matrix shapes — see backend/internal/authz.Repository.AdminMatrix.
 * parents must all be on before this one can be; dependents are switched off
 * with it; soft_parents only warn (a picker or panel comes up empty). */
export type PermissionRow = {
  id: number;
  role_id: number;
  permission_id: number;
  permission: boolean;
  permissions: { id: number; name: string; description: string; moduleName: string; isActive: boolean };
  parents: PermissionRef[];
  soft_parents: PermissionRef[];
  dependents: PermissionRef[];
};
export type Role = {
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
  role: Role;
  data: Record<string, PermissionRow[]>;
};
