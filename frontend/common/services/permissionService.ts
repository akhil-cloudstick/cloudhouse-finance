import { apiFetchEnveloped as apiFetch, apiFetchEnvelope } from "@/common/services/httpClient";
import { enqueueAndWait, newEntry } from "@/common/offline";
import { actorRoleOf, readEmployees, readRoles, SAVED_ON_PC } from "@/common/offline/accessChecks";
import { currentActor } from "@/common/offline/actor";
import { canQueue, queueWrite } from "@/common/offline/queueWrite";
import { createsRole, findLocalRequest, localRequestId, ROLE_REF } from "@/common/offline/requestRef";
import { waitingEntries } from "@/common/offline/setupAdjust";
import { NOT_SYNCED, rewriteUnsent } from "@/common/offline/setupQueue";
import { dropUnsentRecord } from "@/common/offline/unsent";
import { refuse } from "@/common/offline/validate";
import type { CategoryView } from "@/common/types/approval-workflow-types";
import type { PermissionMap, Role, MatrixResponse, PagedResult, RoleListRow, RoleEmployeeRow } from "@/common/types/permission-types";

/* The server's own role and permission checks, made before an entry is queued from what this PC holds (the lists it shows, waiting
 * changes included). Where an answer is not on this PC nothing is blocked: the server decides. */

const NOT_RUNNING = () => Promise.reject(new Error("offline mode is not running"));

/* A role made on this PC is addressed by the entry that creates it (the sender swaps in the server's id). */
async function roleSegment(roleId: number): Promise<string> {
	if (roleId > 0) return String(roleId);
	const found = await findLocalRequest(roleId, createsRole);
	if (!found) return refuse(NOT_SYNCED, 409);
	return "entryId" in found ? `ref:${found.entryId}` : String(found.serverId);
}

/* Whose permissions may be saved: never the signed-in person's own role (they could switch off what lets them manage roles), and never
 * a system role. */
async function checkRoleMatrixSave(roleId: number): Promise<void> {
	const roles = await readRoles();
	const mine = actorRoleOf(roles);
	if (mine && mine.id === roleId) refuse("You cannot change your own role's permissions", 403);
	if (roles?.find((r) => r.id === roleId)?.isSystem) refuse("System roles cannot be modified", 403);
}

/* Mirrors the server: switching a permission off takes everything under it off, and one that is switched on needs its parents on. */
async function checkHierarchy(actingEmployeeId: number, roleId: number, updates: { permission_id: number; permission: boolean }[]): Promise<void> {
	let matrix: MatrixResponse | null = null;
	try {
		matrix = await apiFetchEnvelope<MatrixResponse>(`/employees/${actingEmployeeId}/permissions?role_id=${roleId}`);
	} catch {
		return;
	}
	const rows = Object.values(matrix?.data ?? {}).flat();
	if (!rows.length) return;
	const after = new Map<number, boolean>(rows.map((r) => [r.permissionId, r.permission]));
	const byId = new Map(rows.map((r) => [r.permissionId, r]));
	for (const u of updates) after.set(u.permission_id, u.permission);
	for (const u of updates) {
		if (u.permission) continue;
		for (const d of byId.get(u.permission_id)?.dependents ?? []) after.set(d.permissionId, false);
	}
	for (const u of updates) {
		const row = byId.get(u.permission_id);
		if (!row || !after.get(u.permission_id)) continue;
		for (const parent of row.parents ?? []) {
			if (!(after.get(parent.permissionId) ?? parent.granted)) refuse(`${parent.label} is disabled, cannot enable ${row.permissions.name.replace(/^can /, "")}`, 409);
		}
	}
}

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

export async function updateRolePermissions(
	actingEmployeeId: number,
	roleId: number,
	updates: { permission_id: number; permission: boolean }[]
): Promise<string> {
	const online = () => apiFetch<string>(`/employees/${actingEmployeeId}/permissions/${roleId}`, { method: "PATCH", body: JSON.stringify(updates) });
	if (!canQueue()) return online();
	await checkRoleMatrixSave(roleId);
	if (updates.length === 0) refuse("Nothing to save. Please change at least one permission and try again.");
	await checkHierarchy(actingEmployeeId, roleId, updates);
	return queueWrite("PATCH", `/employees/${actingEmployeeId}/permissions/${await roleSegment(roleId)}`, updates, SAVED_ON_PC, online);
}

export async function setAllRolePermissions(actingEmployeeId: number, roleId: number, allowed: boolean): Promise<string> {
	const online = () => apiFetch<string>(`/employees/${actingEmployeeId}/permissions/${roleId}/set-all?permission=${allowed}`, { method: "PATCH" });
	if (!canQueue()) return online();
	await checkRoleMatrixSave(roleId);
	return queueWrite("PATCH", `/employees/${actingEmployeeId}/permissions/${await roleSegment(roleId)}/set-all?permission=${allowed}`, undefined, SAVED_ON_PC, online);
}

export async function createRole(name: string, description: string): Promise<Role> {
	if (canQueue()) {
		const trimmed = name.trim();
		if (!trimmed) refuse("name is required");
		const entry = newEntry("POST", "/roles", { name: trimmed, description }, currentActor());
		entry.targets = [entry.id];
		await enqueueAndWait(entry, () => undefined);
		const now = new Date().toISOString();
		return { id: localRequestId(entry.id), name: trimmed, description, isActive: true, isSystem: false, createdAt: now, updatedAt: now };
	}
	return apiFetch<Role>("/roles", { method: "POST", body: JSON.stringify({ name, description }) });
}

export async function updateRole(id: number, name: string, description: string, isActive: boolean): Promise<Role> {
	if (canQueue()) {
		const trimmed = name.trim();
		if (!trimmed) refuse("name is required");
		const roles = await readRoles();
		const role = roles?.find((r) => r.id === id);
		if (role?.isSystem) refuse("System roles cannot be modified", 403);
		// switching the signed-in person's own role off would lock them (and everyone in it) out
		if (!isActive && actorRoleOf(roles)?.id === id) refuse("You cannot deactivate your own role", 403);
		if (id < 0) {
			// made on this PC and not sent yet: the edit makes its entry a better "create" (a new role is always active)
			if (!isActive) refuse(NOT_SYNCED, 409);
			await rewriteUnsent(id, createsRole, (body) => ({ ...body, name: trimmed, description }));
		} else {
			await queueWrite("PATCH", `/roles/${id}`, { name: trimmed, description, isActive }, SAVED_ON_PC, NOT_RUNNING);
		}
		const now = new Date().toISOString();
		return { createdAt: now, isSystem: false, ...(role ?? {}), id, name: trimmed, description, isActive, updatedAt: now };
	}
	return apiFetch<Role>(`/roles/${id}`, { method: "PATCH", body: JSON.stringify({ name, description, isActive }) });
}

/* The first approval workflow (named as the server names it) that has this role as an approver. */
async function approvalUse(roleId: number): Promise<string> {
	let cats: CategoryView[] = [];
	try {
		cats = (await apiFetch<CategoryView[]>("/approval-workflow/categories")) || [];
	} catch {
		return "";
	}
	for (const c of cats) {
		if (c.shared && c.sharedSteps.some((s) => s.roleId === roleId)) return c.label;
		for (const f of c.flows) if (f.steps.some((s) => s.roleId === roleId)) return f.label;
	}
	return "";
}

export async function deleteRole(id: number): Promise<string> {
	if (canQueue()) {
		const roles = await readRoles();
		const role = roles?.find((r) => r.id === id);
		const flow = await approvalUse(id);
		if (flow) refuse(`This role can't be deleted because it is an approver in the ${flow} approval workflow. Remove it from that workflow first.`);
		if (role?.isSystem) refuse("System roles cannot be modified", 403);
		// deleting the signed-in person's own role would lock them out (the server refuses it too while anyone still uses the role)
		if (actorRoleOf(roles)?.id === id) refuse("You cannot delete your own role", 403);
		if (role) {
			const using = ((await readEmployees()) ?? []).filter((e) => e.role === role.name);
			if (using.length > 0) {
				const names = using.map((e) => e.name).sort((a, b) => a.localeCompare(b)).slice(0, 5);
				refuse(`This role can't be deleted because ${using.length} employee(s) still use it (${names.join(", ")}). Move them to another role first.`);
			}
		}
		if (id < 0) {
			// a role that was only ever on this PC is taken back, unless a waiting approval chain still names it
			const waiting = await waitingEntries();
			const creator = waiting.find((e) => createsRole(e) && localRequestId(e.id) === id);
			if (creator && waiting.some((e) => e.path.includes("/approval-workflow/") && JSON.stringify(e.body ?? "").includes(`${ROLE_REF}${creator.id}`))) {
				refuse("This role is named in an approval workflow change that has not synced yet. Try again once it has synced.", 409);
			}
			if (!(await dropUnsentRecord(id, createsRole))) refuse(NOT_SYNCED, 409);
			return "Role removed. It was never sent.";
		}
		return queueWrite("DELETE", `/roles/${id}`, undefined, SAVED_ON_PC, NOT_RUNNING);
	}
	return apiFetch<string>(`/roles/${id}`, { method: "DELETE" });
}
