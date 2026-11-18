import { apiFetchEnveloped as apiFetch, apiFetchEnvelope } from "@/common/services/httpClient";
import type { PermissionMap, Role, MatrixResponse, PagedResult, RoleListRow, RoleEmployeeRow } from "@/common/types/permission-types";

export function fetchMyPermissions(employeeId: number): Promise<PermissionMap> {
  return apiFetch<PermissionMap>(`/employees/${employeeId}/permissions/by-employee`);
}

export function fetchRoles(): Promise<Role[]> {
  return apiFetch<Role[]>("/roles");
}

async function fetchPaged<T>(path: string, params: URLSearchParams): Promise<PagedResult<T>> {
  const rec = await apiFetch<{ items?: T[]; hasMore?: boolean; total?: number }>(`${path}?${params.toString()}`);
  return { items: rec?.items ?? [], hasMore: !!rec?.hasMore, total: rec?.total ?? 0 };
}

/* Paginated roles list (system roles left out) with how many employees hold each role. */
export function fetchRolesPage(page: number, limit: number, search?: string): Promise<PagedResult<RoleListRow>> {
  const q = new URLSearchParams({ page: String(page), limit: String(limit) });
  if (search) q.set("search", search);
  return fetchPaged<RoleListRow>("/roles/list", q);
}

/* Paginated list of the employees holding one role. */
export function fetchRoleEmployees(roleId: number, page: number, limit: number): Promise<PagedResult<RoleEmployeeRow>> {
  return fetchPaged<RoleEmployeeRow>(`/roles/${roleId}/employees`, new URLSearchParams({ page: String(page), limit: String(limit) }));
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
