import { apiFetchEnveloped as apiFetch } from "@/common/services/httpClient";
import { enqueueAndWait, newEntry, offlineReady, uuid7 } from "@/common/offline";
import { actorRoleOf, readEmployees, readRoles, SAVED_ON_PC } from "@/common/offline/accessChecks";
import { currentActor } from "@/common/offline/actor";
import { createsEmployee, localRequestId } from "@/common/offline/requestRef";
import { forgetSecret, holdSecret } from "@/common/offline/secrets";
import { waitingEntries } from "@/common/offline/setupAdjust";
import { rewriteUnsent } from "@/common/offline/setupQueue";
import { dropUnsentRecord } from "@/common/offline/unsent";
import { refuse } from "@/common/offline/validate";
import { isSmallScreen } from "@/common/utils/responsive";
import type { BackendEmployee, EmployeeView, EmployeeFormInput, EmployeeUpdateInput } from "@/modules/employees/types/employee-types";

function toView(e: BackendEmployee): EmployeeView {
	return {
		id: e.id,
		code: e.code,
		name: e.name,
		role: e.role,
		branchId: e.branchId,
		branchName: e.branch?.name || "",
		phone: e.phone,
		username: e.username || "",
		loansProcessed: e.loansProcessed,
		collections: e.collections,
		followups: e.followups,
		pending: e.pending,
	};
}

export async function listEmployees(): Promise<EmployeeView[]> {
	const rec = await apiFetch<BackendEmployee[]>("/employees");
	return (rec || []).map(toView);
}

/* Page size for the paginated Employees table (Employees.tsx). */
export const EMPLOYEES_PAGE_SIZE = 12;

export async function listEmployeesPage(
	page: number,
	limit?: number,
	q?: string,
	filters?: { role?: string; branchId?: string }
): Promise<{ items: EmployeeView[]; hasMore: boolean; total: number }> {
	const pageSize = limit ?? (isSmallScreen() ? 8 : 12);
	const params = new URLSearchParams({
		limit: String(pageSize),
		offset: String((page - 1) * pageSize),
	});
	if (q?.trim()) params.set("search", q.trim());
	if (filters?.role) params.set("role", filters.role);
	if (filters?.branchId) params.set("branchId", filters.branchId);
	const rec = await apiFetch<{ items: BackendEmployee[]; hasMore: boolean; total?: number }>(`/employees?${params}`);
	return { items: (rec?.items || []).map(toView), hasMore: !!rec?.hasMore, total: rec?.total ?? 0 };
}

export async function getEmployee(id: number): Promise<EmployeeView> {
	const rec = await apiFetch<BackendEmployee>(`/employees/${id}`);
	return toView(rec);
}

/* The server's own employee checks (name, role, branch, phone, username, password, system roles, own role, phone / username already
 * used), made before an entry is queued from what this PC holds. Where the answer is not on this PC nothing is blocked. */
const USERNAME = /^[A-Za-z0-9._-]{3,60}$/;
const NOT_SYNCED = "Not synced yet. Try again once it has synced.";

async function checkEmployee(input: EmployeeFormInput, selfId?: number): Promise<void> {
	if (!input.name.trim()) refuse("name is required");
	if (!input.role) refuse("role is required");
	if (!input.branchId) refuse("branch is required");
	// a branch made on this PC has no server id yet, and no entry may carry a local one
	if (input.branchId < 0) refuse("This branch has not synced yet. Try again once it has synced.", 409);
	if (input.phone && !/^\d{10}$/.test(input.phone)) refuse("phone must be a 10-digit number");
	const username = (input.username || "").trim();
	if (username && !USERNAME.test(username)) refuse("invalid username (3+ letters, numbers, . _ -)");
	if (input.password && input.password.length < 8) refuse("password must be at least 8 characters");
	const roles = await readRoles();
	if (roles) {
		const role = roles.find((r) => r.name === input.role);
		if (!role) refuse("role does not exist");
		const mine = actorRoleOf(roles);
		if (role.isSystem && mine && !mine.isSystem) refuse("You cannot assign a system role", 403);
	}
	const all = await readEmployees();
	if (all) {
		if (input.phone && all.some((e) => e.id !== selfId && e.phone === input.phone)) refuse("phone number is already in use by another employee", 409);
		if (username && all.some((e) => e.id !== selfId && (e.username || "") === username)) refuse("username is already in use by another employee", 409);
	}
}

/* Puts the request in the outbox. A password never goes in the entry: it is kept sealed (secrets.ts) under the entry's id. */
async function queueEmployee(method: "POST" | "PUT" | "DELETE", path: string, body: Record<string, unknown> | undefined, password?: string) {
	const id = uuid7();
	const stored = body ? { ...body, ...(password ? { password: await holdSecret(id, password) } : {}) } : undefined;
	const entry = newEntry(method, path, stored, currentActor(), [id], id);
	try {
		await enqueueAndWait(entry, () => undefined);
	} catch (e) {
		if (password) await forgetSecret(id);
		throw e;
	}
	return entry;
}

/* The fields of a form, without the password (it is handled apart) and without what was left out. */
function withoutPassword(o: object): Record<string, unknown> {
	return Object.fromEntries(Object.entries(o).filter(([k, v]) => v !== undefined && k !== "password"));
}

function draftView(id: number, input: EmployeeFormInput): EmployeeView {
	return { id, code: "Pending", name: input.name.trim(), role: input.role, branchId: input.branchId, branchName: "", phone: input.phone, username: (input.username || "").trim(), loansProcessed: 0, collections: 0, followups: 0, pending: 0, queued: true, message: SAVED_ON_PC };
}

export async function createEmployee(input: EmployeeFormInput): Promise<EmployeeView> {
	// Desktop: queued and listed at once; the password stays sealed on this PC until it is sent
	if (offlineReady()) {
		await checkEmployee(input);
		const entry = await queueEmployee("POST", "/employees", withoutPassword(input), input.password);
		return draftView(localRequestId(entry.id), input);
	}
	const rec = await apiFetch<BackendEmployee>("/employees", {
		method: "POST",
		body: JSON.stringify(input),
	});
	return toView(rec);
}

export async function updateEmployee(id: number, input: EmployeeUpdateInput): Promise<EmployeeView> {
	if (offlineReady()) {
		await checkEmployee(input, id);
		// the server refuses a change of the signed-in person's own role
		const me = currentActor();
		if (id === me.id) {
			let current = me.role;
			try {
				current = (await apiFetch<BackendEmployee>(`/employees/${id}`))?.role || me.role;
			} catch {
				/* the role of this sign-in stands */
			}
			if (current && input.role !== current) refuse("You cannot change your own role", 403);
		}
		if (id < 0) {
			// made on this PC and not sent yet: the edit makes its entry a better "create"
			const creator = (await waitingEntries()).find((e) => createsEmployee(e) && localRequestId(e.id) === id);
			if (!creator) return refuse(NOT_SYNCED, 409);
			const password = input.password ? await holdSecret(creator.id, input.password) : undefined;
			const fields = withoutPassword({ name: input.name, role: input.role, branchId: input.branchId, phone: input.phone, username: input.username });
			await rewriteUnsent(id, createsEmployee, (body) => ({ ...body, ...fields, ...(password ? { password } : {}) }));
			return draftView(id, input);
		}
		await queueEmployee("PUT", `/employees/${id}`, withoutPassword(input), input.password);
		return { ...draftView(id, input), code: "", loansProcessed: input.loansProcessed, collections: input.collections, followups: input.followups, pending: input.pending };
	}
	const rec = await apiFetch<BackendEmployee>(`/employees/${id}`, {
		method: "PUT",
		body: JSON.stringify(input),
	});
	return toView(rec);
}

/* Says whether the delete was only saved on this PC for now (so the page can tell the person so). */
export async function deleteEmployee(id: number): Promise<{ queued: boolean; message?: string }> {
	if (offlineReady()) {
		// the signed-in person cannot take their own account away: it would lock them out
		if (id === currentActor().id) refuse("You cannot delete your own account", 403);
		if (id < 0) {
			const creator = (await waitingEntries()).find((e) => createsEmployee(e) && localRequestId(e.id) === id);
			if (!(await dropUnsentRecord(id, createsEmployee))) refuse(NOT_SYNCED, 409);
			if (creator) await forgetSecret(creator.id);
			return { queued: true, message: "Employee removed. It was never sent." };
		}
		await queueEmployee("DELETE", `/employees/${id}`, undefined);
		return { queued: true, message: SAVED_ON_PC };
	}
	await apiFetch<void>(`/employees/${id}`, { method: "DELETE" });
	return { queued: false };
}
