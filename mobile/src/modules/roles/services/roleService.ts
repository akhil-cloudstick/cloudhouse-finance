import { apiRequest, apiRequestEnveloped } from "@/common/services/httpClient";
import type { RoleRecord, MatrixResponse } from "@/modules/roles/types/role-types";

export function fetchRoles(): Promise<RoleRecord[]> {
  return apiRequestEnveloped<RoleRecord[]>("/roles");
}

// NOT apiRequestEnveloped: this endpoint's body is flat {success, role, data}, not the usual envelope.
export function fetchRoleMatrix(actingEmployeeId: number, roleId: number, search?: string): Promise<MatrixResponse> {
  return apiRequest<MatrixResponse>(`/employees/${actingEmployeeId}/permissions`, {
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

export function createRole(name: string, description: string): Promise<RoleRecord> {
  return apiRequest<RoleRecord>("/roles", { method: "POST", body: { name, description } });
}

export function updateRole(id: number, name: string, description: string, isActive: boolean): Promise<RoleRecord> {
  return apiRequest<RoleRecord>(`/roles/${id}`, { method: "PATCH", body: { name, description, isActive } });
}

export function deleteRole(id: number): Promise<string> {
  return apiRequest<string>(`/roles/${id}`, { method: "DELETE" });
}
