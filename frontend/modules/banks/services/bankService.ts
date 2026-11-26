import { apiFetchEnveloped as apiFetch } from "@/common/services/httpClient";
import { enqueueAndWait, newEntry, offlineReady } from "@/common/offline";
import { queueWrite } from "@/common/offline/queueWrite";
import { refuse } from "@/common/offline/validate";
import { createsBank } from "@/common/offline/setupAdjust";
import { rewriteUnsent } from "@/common/offline/setupQueue";
import { dropUnsentRecord } from "@/common/offline/unsent";
import { localRequestId } from "@/common/offline/requestRef";
import { ApiError } from "@/common/services/httpClient";
import { currentActor } from "@/common/offline/actor";
import type { BackendBank, BankFormInput } from "@/modules/banks/types/bank-types";

/* The server's own bank checks (name, account number, phone, name + bank-branch unique), made before an entry is queued. The list
 * read counts banks still waiting to be sent; when it cannot be read nothing is blocked. */
async function checkBank(input: BankFormInput, selfId?: number): Promise<BackendBank | undefined> {
	const name = input.name.trim();
	if (!name) refuse("name is required");
	const acc = (input.accountNo || "").trim();
	if (acc && !/^\d{1,18}$/.test(acc)) refuse("account number must be digits only, up to 18 digits");
	const phone = (input.phone || "").trim();
	if (phone && !/^\d{10}$/.test(phone)) refuse("phone number must be exactly 10 digits");
	let all: BackendBank[] = [];
	try {
		all = (await apiFetch<BackendBank[]>("/banks?mgmt=1")) || [];
		if (!Array.isArray(all)) all = [];
	} catch {
		return undefined;
	}
	const branch = (input.branch || "").trim().toLowerCase();
	const same = all.find((b) => b.name.trim().toLowerCase() === name.toLowerCase() && (b.branch || "").trim().toLowerCase() === branch && b.id !== selfId);
	if (same && selfId !== undefined) refuse("a bank with this name and branch already exists", 409);
	return same;
}

function draftBank(id: number, input: BankFormInput): BackendBank {
	const now = new Date().toISOString();
	return { id, name: input.name.trim(), branchId: input.branchId, branchName: "", branch: (input.branch || "").trim(), ifsc: (input.ifsc || "").trim(), accountNo: (input.accountNo || "").trim(), phone: (input.phone || "").trim(), balance: 0, createdAt: now, updatedAt: now };
}

/* Server-side search (by name) — backs the bank SearchableSelect in
 * RepledgeModal.tsx, same pattern as ornamentTypesApi.ts's search. */
export async function searchBanks(q: string): Promise<BackendBank[]> {
	const rec = await apiFetch<BackendBank[]>(`/banks?q=${encodeURIComponent(q)}`);
	return rec || [];
}

/* Backend-paginated bank search for SearchableSelect's / FilterPanel's fetchFn contract
 * (`page` is 0-based here; GET /banks takes limit/offset and reports hasMore). */
export const BANK_SEARCH_PAGE_SIZE = 20;
export async function searchBanksPage(q: string, page: number): Promise<{ items: BackendBank[]; hasMore: boolean }> {
  const params = new URLSearchParams({ limit: String(BANK_SEARCH_PAGE_SIZE), offset: String(page * BANK_SEARCH_PAGE_SIZE) });
  if (q.trim()) params.set("search", q.trim());
  const res = await apiFetch<{ items: BackendBank[] | null; hasMore: boolean }>(`/banks?${params}`);
  return { items: res.items || [], hasMore: !!res.hasMore };
}

/* Creates a new bank, or — if one with the same name (case insensitive)
 * already exists — returns the existing row instead (the backend's
 * find-or-create behaviour). */
export async function createBank(name: string): Promise<BackendBank> {
	return apiFetch<BackendBank>("/banks", {
		method: "POST",
		body: JSON.stringify({ name }),
	});
}

export async function createBankFull(input: BankFormInput): Promise<BackendBank> {
	// Desktop: queued and listed at once (management list only; a bank that is not on the server yet is kept out of the pickers)
	if (offlineReady()) {
		// the server returns the existing bank when one has the same name and branch, and makes no new one
		const existing = await checkBank(input);
		if (existing) return existing;
		const entry = newEntry("POST", "/banks", { ...input, name: input.name.trim() }, currentActor());
		entry.targets = [entry.id];
		await enqueueAndWait(entry, () => undefined);
		return draftBank(localRequestId(entry.id), input);
	}
	return apiFetch<BackendBank>("/banks", {
		method: "POST",
		body: JSON.stringify(input),
	});
}

/* Bank Management admin page's list — no pagination at this scale, same
 * convention as Branches.tsx/listBranches(). */
export async function listBanks(): Promise<BackendBank[]> {
	return (await apiFetch<BackendBank[]>("/banks")) || [];
}

export const BANKS_PAGE_SIZE = 10;

/* Paginated variant of listBanks for the Bank Management admin table — the
 * backend's GET /banks already supports limit/offset/total (mirrors
 * loan/customer's List, see backend/internal/bank/handler.go), this just
 * wasn't wired up on the frontend yet. `page` is 1-based, same convention as
 * listLoansPage/listBankPledgeHistoryPage. `totalBalance` is the server's
 * sum of `balance` over every matching bank (not just this page) — the Bank
 * Management page's "Net Bank Balance" card. */
export async function listBanksPage(page: number, limit: number = BANKS_PAGE_SIZE, q?: string, branchId?: string): Promise<{ items: BackendBank[]; hasMore: boolean; total: number; totalBalance: number }> {
	const params = new URLSearchParams({ limit: String(limit), offset: String((page - 1) * limit) });
	if (q?.trim()) params.set("search", q.trim());
	if (branchId) params.set("branchId", branchId);
	const res = await apiFetch<{ items: BackendBank[] | null; hasMore: boolean; total?: number; totalBalance?: number }>(`/banks?${params}${offlineReady() ? "&mgmt=1" : ""}`);
	return { items: res.items || [], hasMore: !!res.hasMore, total: res.total ?? 0, totalBalance: res.totalBalance ?? 0 };
}

/* The Party Transactions page's bank-drill-down header needs the bank's own
 * name/details. */
export async function getBank(id: number): Promise<BackendBank> {
	return apiFetch<BackendBank>(`/banks/${id}`);
}

export async function updateBank(id: number, input: BankFormInput): Promise<BackendBank> {
	if (offlineReady()) {
		await checkBank(input, id);
		// a bank not sent yet: its creating entry is rewritten with the edit
		if (id < 0) {
			await rewriteUnsent(id, createsBank, (b) => ({ ...b, ...input, name: input.name.trim() }));
			return draftBank(id, input);
		}
		return queueWrite("PUT", `/banks/${id}`, { ...input, name: input.name.trim() }, draftBank(id, input), () => apiFetch<BackendBank>(`/banks/${id}`, { method: "PUT", body: JSON.stringify(input) }));
	}
	return apiFetch<BackendBank>(`/banks/${id}`, { method: "PUT", body: JSON.stringify(input) });
}

/* Hard-deletes a bank — the backend refuses (409) while any transaction or
 * bank-pledge record still references it; the caller should catch that and
 * point staff at mergeBanks instead. */
export async function deleteBank(id: number): Promise<void> {
	if (offlineReady()) {
		// a bank not sent yet is taken back: nothing was ever recorded on the server for it
		if (id < 0) {
			if (!(await dropUnsentRecord(id, createsBank))) throw new ApiError("Not synced yet. Try again once it has synced.", 409);
			return;
		}
		// whether the bank has transactions (the server refuses then) is not known on this PC, so the server decides
		return queueWrite("DELETE", `/banks/${id}`, undefined, undefined, async () => {
			await apiFetch<{ deleted: boolean }>(`/banks/${id}`, { method: "DELETE" });
		});
	}
	await apiFetch<{ deleted: boolean }>(`/banks/${id}`, { method: "DELETE" });
}

/* Reassigns every transaction/pledge from sourceId onto targetId, then
 * deletes sourceId (now unreferenced) — the "merge duplicate bank" action.
 * Returns the surviving (target) bank. */
export async function mergeBanks(sourceId: number, targetId: number): Promise<BackendBank> {
	return apiFetch<BackendBank>(`/banks/${sourceId}/merge`, {
		method: "POST",
		body: JSON.stringify({ targetId }),
	});
}
