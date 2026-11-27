import { apiRequest, apiRequestEnveloped } from "@/common/services/httpClient";
import type { RoleRecord, MatrixResponse, PermissionRow, PagedResult, RoleListRow, RoleEmployeeRow } from "@/modules/roles/types/role-types";

export function fetchRoles(): Promise<RoleRecord[]> {
  return apiRequestEnveloped<RoleRecord[]>("/roles");
}

async function fetchPaged<T>(path: string, params: Record<string, string | number | undefined>): Promise<PagedResult<T>> {
  const rec = await apiRequestEnveloped<{ items?: T[]; hasMore?: boolean; total?: number }>(path, { params });
  return { items: rec?.items ?? [], hasMore: !!rec?.hasMore, total: rec?.total ?? 0 };
}

/** Paginated roles list (system roles left out) with how many employees hold each role. */
export function fetchRolesPage(page: number, limit: number, search?: string): Promise<PagedResult<RoleListRow>> {
  return fetchPaged<RoleListRow>("/roles/list", { page, limit, search: search || undefined });
}

/** Paginated list of the employees holding one role. */
export function fetchRoleEmployees(roleId: number, page: number, limit: number): Promise<PagedResult<RoleEmployeeRow>> {
  return fetchPaged<RoleEmployeeRow>(`/roles/${roleId}/employees`, { page, limit });
}

// NOT apiRequestEnveloped: this endpoint's body is flat — {success, role,
// data} — with role and data as siblings of success, not nested under a
// `data` field the way the generic envelope convention expects (see
// backend/internal/authz/handler.go's Matrix). Unwrapping it with
// apiRequestEnveloped silently returned just the inner `data` object and
// dropped `role`, which left `res.role`/`res.data` both undefined here and
// the screen stuck on its loading state forever.
// The API layer renames snake_case response keys to camelCase (permission_id →
// permissionId, role_id → roleId). The screen is keyed on `permission_id`, so
// without this every row's id was undefined: all rows shared one key, ticking one
// ticked all, and Save sent no usable ids ("Nothing to save").
type Idish = { permission_id?: number; permissionId?: number };
const withPermissionId = <T extends Idish>(x: T): T => ({ ...x, permission_id: x.permission_id ?? x.permissionId });
const normaliseRow = (r: PermissionRow): PermissionRow => {
  const row = r as PermissionRow & { roleId?: number };
  return {
    ...withPermissionId(row),
    role_id: row.role_id ?? row.roleId ?? 0,
    parents: row.parents?.map(withPermissionId),
    all_parents: row.all_parents?.map(withPermissionId),
    soft_parents: row.soft_parents?.map(withPermissionId),
    dependents: row.dependents?.map(withPermissionId),
  };
};

export async function fetchRoleMatrix(actingEmployeeId: number, roleId: number, search?: string): Promise<MatrixResponse> {
  const res = await apiRequest<MatrixResponse>(`/employees/${actingEmployeeId}/permissions`, {
    params: { role_id: roleId, search },
  });
  return { ...res, data: Object.fromEntries(Object.entries(res.data ?? {}).map(([mod, rows]) => [mod, rows.map(normaliseRow)])) };
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
