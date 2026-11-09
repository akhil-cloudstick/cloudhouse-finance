/* What the Employees, Roles & Permissions and Approval Workflow screens check on this PC before a change is queued, from the same
 * (waiting changes included) answers the screens read. Where an answer cannot be read here nothing is blocked: the server decides. */

import { apiFetchEnveloped as apiFetch } from "@/common/services/httpClient";
import type { Role } from "@/common/types/permission-types";
import { currentActor } from "./actor";

export const SAVED_ON_PC = "Saved on this PC. It applies to everyone when it syncs.";

type EmployeeRow = { id: number; name: string; role: string; branchId?: number; phone?: string; username?: string };

export async function readRoles(): Promise<Role[] | null> {
	try {
		const rows = await apiFetch<Role[]>("/roles");
		return Array.isArray(rows) ? rows : null;
	} catch {
		return null;
	}
}

/* Every employee the list holds, whole (the cached list may be one branch's, so a missing one proves nothing). */
export async function readEmployees(): Promise<EmployeeRow[] | null> {
	try {
		const rows = await apiFetch<EmployeeRow[] | { items?: EmployeeRow[] }>("/employees");
		const list = Array.isArray(rows) ? rows : rows?.items;
		return Array.isArray(list) ? list : null;
	} catch {
		return null;
	}
}

/* The role the signed-in person holds, from the role list; undefined when it cannot be known. */
export function actorRoleOf(roles: Role[] | null): Role | undefined {
	const name = currentActor().role;
	return roles?.find((r) => r.name === name);
}
