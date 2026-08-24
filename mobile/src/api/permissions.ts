import { apiRequestEnveloped } from "./client";

// Shape of GET /employees/:id/permissions/by-employee's data (see
// backend/internal/authz.Repository.BootstrapPermissions) — one boolean map
// per module, keyed by the underscored permission name. Mirrors
// frontend/common/services/permissionService.ts's PermissionMap.
export type PermissionMap = Record<string, Record<string, boolean>>;

export function fetchMyPermissions(employeeId: number): Promise<PermissionMap> {
  return apiRequestEnveloped<PermissionMap>(`/employees/${employeeId}/permissions/by-employee`);
}
