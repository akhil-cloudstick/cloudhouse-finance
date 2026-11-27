// A related permission, with its granted state — parents must all be on before a permission can be; dependents are switched off with it.
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
  /** Every permission this one needs, directly or further up the chain — all switched on with it. */
  all_parents?: PermissionRef[];
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
/** Longest role description the backend accepts (RoleDescriptionMax). */
export const ROLE_DESCRIPTION_MAX = 150;
/** One row of GET /roles/list (paginated). */
export type RoleListRow = {
  id: number;
  name: string;
  description: string;
  isActive: boolean;
  isSystem: boolean;
  employee_count: number;
};
/** One employee holding a role — GET /roles/:id/employees (paginated). */
export type RoleEmployeeRow = {
  id: number;
  code: string;
  name: string;
  branchName: string;
};
export type PagedResult<T> = { items: T[]; hasMore: boolean; total: number };
export type MatrixResponse = {
  success: boolean;
  role: RoleRecord;
  data: Record<string, PermissionRow[]>;
};
