import { apiRequest, apiRequestEnveloped } from "./client";

// Mirrors frontend/common/services/permissionService.ts — same endpoints,
// same envelope split (the /roles CRUD endpoints are still bare-resource;
// only /employees/:id/permissions has migrated to the house envelope, same
// as src/api/permissions.ts's fetchMyPermissions).

/** One row of GET /employees/:id/permissions's matrix — see
 * backend/internal/authz.Repository.AdminMatrix. */
export type PermissionRow = {
  id: number;
  role_id: number;
  permission_id: number;
  permission: boolean;
  permissions: { id: number; name: string; description: string; moduleName: string; isActive: boolean };
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

export function fetchRoles(): Promise<Role[]> {
  return apiRequestEnveloped<Role[]>("/roles");
}

export function fetchRoleMatrix(actingEmployeeId: number, roleId: number, search?: string): Promise<MatrixResponse> {
  return apiRequestEnveloped<MatrixResponse>(`/employees/${actingEmployeeId}/permissions`, {
    params: { role_id: roleId, search },
  });
}

export function updateRolePermissions(
  actingEmployeeId: number,
  roleId: number,
  updates: { permission_id: number; permission: boolean }[]
): Promise<string> {
  return apiRequest<string>(`/employees/${actingEmployeeId}/permissions/${roleId}`, {
    method: "PATCH",
    body: updates,
  });
}

export function setAllRolePermissions(actingEmployeeId: number, roleId: number, allowed: boolean): Promise<string> {
  return apiRequest<string>(`/employees/${actingEmployeeId}/permissions/${roleId}/set-all`, {
    method: "PATCH",
    params: { permission: allowed },
  });
}

export function createRole(name: string, description: string): Promise<Role> {
  return apiRequest<Role>("/roles", { method: "POST", body: { name, description } });
}

export function updateRole(id: number, name: string, description: string, isActive: boolean): Promise<Role> {
  return apiRequest<Role>(`/roles/${id}`, { method: "PATCH", body: { name, description, isActive } });
}

export function deleteRole(id: number): Promise<string> {
  return apiRequest<string>(`/roles/${id}`, { method: "DELETE" });
}
