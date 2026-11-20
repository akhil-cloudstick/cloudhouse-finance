/* A bank re-pledge recorded on this PC has no server id until it is sent, yet it can be released or voided in the
 * meantime. Those later entries address the pledge as ref:<id of the entry that creates it>; once that entry has been
 * sent the server's pledge id is kept here, and the sender swaps the ref for it just before the later entry goes. */

import { offlineStore } from "@/common/services/desktopBridge";

const FILE = "data/pledge_refs.json";
export const PLEDGE_REF = /\/bank-pledge\/ref:([0-9a-f-]+)(\/|$)/i;

let cache: Record<string, number> | null = null;

async function load(): Promise<Record<string, number>> {
	if (cache) return cache;
	try {
		const text = await offlineStore.readFile(FILE);
		cache = text ? (JSON.parse(text) as Record<string, number>) : {};
	} catch {
		cache = {};
	}
	return cache;
}

/* A local id that is never a server id (those are positive) and is stable for the same entry. */
export function localPledgeId(entryId: string): number {
	return -(parseInt(entryId.replace(/-/g, "").slice(-7), 16) + 1);
}

/* The reply to the entry that created the pledge: the newest pledge on the loan is the one just made. */
export async function rememberPledge(entryId: string, body: unknown): Promise<void> {
	const rec = ((body as { data?: unknown } | undefined)?.data ?? body) as { bankPledges?: { id?: number }[]; bank_pledges?: { id?: number }[] } | undefined;
	const ids = (rec?.bankPledges ?? rec?.bank_pledges ?? []).map((p) => Number(p.id) || 0).filter((n) => n > 0);
	if (!ids.length) return;
	const map = await load();
	map[entryId] = Math.max(...ids);
	await offlineStore.writeFile(FILE, JSON.stringify(map));
}

/* The entry's path with a ref swapped for the server's pledge id; null when that pledge never reached the server. */
export async function resolvePledgePath(path: string): Promise<string | null> {
	const m = PLEDGE_REF.exec(path);
	if (!m) return path;
	const id = (await load())[m[1]];
	return id ? path.replace(`ref:${m[1]}`, String(id)) : null;
}
