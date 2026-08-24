import { apiFetchEnveloped as apiFetch, apiFetchEnvelope } from "@/common/services/httpClient";

/* Shape of GET /employees/:id/permissions/by-employee's data (see
 * backend/internal/authz.Repository.BootstrapPermissions) — one boolean map
 * per module, keyed by the underscored permission name. */
export type PermissionMap = Record<string, Record<string, boolean>>;

export function fetchMyPermissions(employeeId: number): Promise<PermissionMap> {
  return apiFetch<PermissionMap>(`/employees/${employeeId}/permissions/by-employee`);
}

/* Admin matrix shapes — see backend/internal/authz.Repository.AdminMatrix. */
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
  return apiFetch<Role[]>("/roles");
}

export function fetchRoleMatrix(actingEmployeeId: number, roleId: number, search?: string): Promise<MatrixResponse> {
  const q = new URLSearchParams({ role_id: String(roleId) });
  if (search) q.set("search", search);
  return apiFetchEnvelope<MatrixResponse>(`/employees/${actingEmployeeId}/permissions?${q.toString()}`);
}

export function updateRolePermissions(
  actingEmployeeId: number,
  roleId: number,
  updates: { permission_id: number; permission: boolean }[]
): Promise<string> {
  return apiFetch<string>(`/employees/${actingEmployeeId}/permissions/${roleId}`, {
    method: "PATCH",
    body: JSON.stringify(updates),
  });
}

export function setAllRolePermissions(actingEmployeeId: number, roleId: number, allowed: boolean): Promise<string> {
  return apiFetch<string>(`/employees/${actingEmployeeId}/permissions/${roleId}/set-all?permission=${allowed}`, {
    method: "PATCH",
  });
}

export function createRole(name: string, description: string): Promise<Role> {
  return apiFetch<Role>("/roles", { method: "POST", body: JSON.stringify({ name, description }) });
}

export function updateRole(id: number, name: string, description: string, isActive: boolean): Promise<Role> {
  return apiFetch<Role>(`/roles/${id}`, { method: "PATCH", body: JSON.stringify({ name, description, isActive }) });
}

export function deleteRole(id: number): Promise<string> {
  return apiFetch<string>(`/roles/${id}`, { method: "DELETE" });
}
