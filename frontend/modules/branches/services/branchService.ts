import { apiFetchEnveloped, ApiError } from "@/common/services/httpClient";
import { enqueueAndWait, newEntry, offlineReady } from "@/common/offline";
import { currentActor } from "@/common/offline/actor";
import { queueWrite } from "@/common/offline/queueWrite";
import { localRequestId } from "@/common/offline/requestRef";
import { createsBranch } from "@/common/offline/setupAdjust";
import { rewriteUnsent } from "@/common/offline/setupQueue";
import { dropUnsentRecord } from "@/common/offline/unsent";
import { refuse } from "@/common/offline/validate";
import type { BranchView, BranchFormInput, SwitchableBranches, BranchQuota } from "@/modules/branches/types/branch-types";

/* The Branches management list. Branches made on this PC and not sent yet are in it (mgmt=1); the pickers (listActiveBranches) never
 * get them, so a branch with a local id cannot be chosen by another entry. q is searched by the server across every column the table shows. */
export async function listBranches(q?: string): Promise<BranchView[]> {
	return fetchBranches(q, true);
}

async function fetchBranches(q: string | undefined, unsent: boolean): Promise<BranchView[]> {
	const params = new URLSearchParams();
	if (q?.trim()) params.set("search", q.trim());
	if (unsent && offlineReady()) params.set("mgmt", "1");
	const qs = params.toString();
	const rec = await apiFetchEnveloped<BranchView[]>(`/branches${qs ? `?${qs}` : ""}`);
	return rec || [];
}

/* The server's own branch checks (name, code, address required; name and code unique), made before an entry is queued. Where the list
 * cannot be read the uniqueness is left to the server. */
async function checkBranch(input: BranchFormInput, selfId?: number): Promise<void> {
	const name = (input.name || "").trim();
	const code = (input.code || "").trim().toUpperCase();
	if (!name) refuse("name is required");
	if (!code) refuse("branch code is required");
	if (!(input.address || "").trim()) refuse("address is required");
	let all: BranchView[];
	try {
		all = await fetchBranches(undefined, true);
	} catch {
		return;
	}
	if (all.some((b) => b.name === name && b.id !== selfId)) refuse("a branch with this name already exists", 409);
	if (all.some((b) => (b.code || "").toUpperCase() === code && b.id !== selfId)) refuse("a branch with this code already exists", 409);
}

function draftBranch(id: number, input: BranchFormInput, isActive = input.isActive): BranchView {
	return { id, name: input.name.trim(), code: input.code.trim().toUpperCase(), address: input.address, phone: input.phone, isActive };
}

export async function listSwitchableBranches(): Promise<SwitchableBranches> {
	const rec = await apiFetchEnveloped<SwitchableBranches>("/branches/switchable");
	return rec || { branches: [], canSwitch: false };
}

export async function getBranchQuota(): Promise<BranchQuota> {
	return apiFetchEnveloped<BranchQuota>("/branches/quota");
}

export async function getBranch(id: number): Promise<BranchView> {
	return apiFetchEnveloped<BranchView>(`/branches/${id}`);
}

export async function createBranch(input: BranchFormInput): Promise<BranchView> {
	if (offlineReady()) {
		await checkBranch(input);
		const entry = newEntry("POST", "/branches", { ...input, name: input.name.trim() }, currentActor());
		entry.targets = [entry.id];
		await enqueueAndWait(entry, () => undefined);
		return draftBranch(localRequestId(entry.id), input, true);
	}
	return apiFetchEnveloped<BranchView>("/branches", {
		method: "POST",
		body: JSON.stringify(input),
	});
}

export async function updateBranch(id: number, input: BranchFormInput): Promise<BranchView> {
	if (offlineReady()) {
		await checkBranch(input, id);
		// a branch not sent yet: its creating entry is rewritten (it is always created active)
		if (id < 0) {
			await rewriteUnsent(id, createsBranch, (b) => ({ ...b, ...input, name: input.name.trim() }));
			return draftBranch(id, input);
		}
		return queueWrite("PUT", `/branches/${id}`, { ...input, name: input.name.trim() }, draftBranch(id, input), () =>
			apiFetchEnveloped<BranchView>(`/branches/${id}`, { method: "PUT", body: JSON.stringify(input) })
		);
	}
	return apiFetchEnveloped<BranchView>(`/branches/${id}`, {
		method: "PUT",
		body: JSON.stringify(input),
	});
}

/* Deactivates the branch (soft-disable) rather than a hard delete, so
 * historical records that still reference it (employees, expenses, cash
 * movements) keep a valid branch reference. */
export async function deactivateBranch(id: number): Promise<BranchView> {
	if (offlineReady()) {
		// a branch not sent yet is taken back; whether a branch has linked records is not known on this PC, so the server decides
		if (id < 0) {
			const own = (await fetchBranches(undefined, true)).find((b) => b.id === id);
			if (!(await dropUnsentRecord(id, createsBranch)) || !own) refuse("Not synced yet. Try again once it has synced.", 409);
			return { ...own, isActive: false };
		}
		const own = (await fetchBranches(undefined, true)).find((b) => b.id === id);
		const gone: BranchView = { id, name: own?.name ?? "", code: own?.code ?? "", address: own?.address ?? "", phone: own?.phone ?? "", isActive: false };
		return queueWrite("DELETE", `/branches/${id}`, undefined, gone, () => apiFetchEnveloped<BranchView>(`/branches/${id}`, { method: "DELETE" }));
	}
	return apiFetchEnveloped<BranchView>(`/branches/${id}`, { method: "DELETE" });
}

/* Only branches an admin should be able to pick from a dropdown when
 * assigning new records — excludes deactivated branches. */
/* The signed-in employee's own branch (set by auth-context). A role without
 * "can view branch module" still fills branch pickers with it: every role
 * except Administrator/Management only ever works in its own branch, and the
 * backend forces that on every write regardless. When the role is known to
 * lack that permission, GET /branches is not called at all — its 403 would
 * raise the global "no access" toast on every page with a branch picker. */
let ownBranchFallback: BranchView | null = null;
let canListBranches = true;
export function setOwnBranchFallback(branch: { id: number; name: string; code?: string } | null, canList = true) {
	ownBranchFallback = branch
		? { id: branch.id, name: branch.name, code: branch.code || "", address: "", phone: "", isActive: true }
		: null;
	canListBranches = canList;
}

export async function listActiveBranches(): Promise<BranchView[]> {
	if (!canListBranches && ownBranchFallback) return [ownBranchFallback];
	try {
		const all = await fetchBranches(undefined, false);
		return all.filter((b) => b.isActive);
	} catch (e) {
		if (ownBranchFallback && e instanceof ApiError && e.status === 403) return [ownBranchFallback];
		throw e;
	}
}
