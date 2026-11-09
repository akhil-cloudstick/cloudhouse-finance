/* Gold rates published on this PC that the server has not been sent yet. The latest rate and the rate history the
 * screens show are the server's last answer, which cannot know about them, so each waiting "publish rate" entry is
 * added to that answer in the shape the server will use once it is sent: it becomes the latest rate (a karat the entry
 * does not set carries forward from the one before, as the server does) and the top row of the history. When it has been
 * sent the server's own answer includes it and it is no longer in the outbox, so nothing is shown twice. */

import { offlineStore } from "@/common/services/desktopBridge";
import type { OutboxEntry } from "./types";

type Rate = { id: string | number; date: string; k24: number; k22: number; k18: number; setBy: string; createdAt?: string };
type RateBody = { rates?: Partial<Record<number, number>>; karat?: number; rate?: number; setBy?: string; date?: string };

/* The waiting publishes, oldest first. */
async function waiting(): Promise<{ entry: OutboxEntry; body: RateBody }[]> {
	const found: { entry: OutboxEntry; body: RateBody }[] = [];
	for (const line of await offlineStore.readAllOutbox().catch(() => [] as string[])) {
		try {
			const entry = JSON.parse(line) as OutboxEntry;
			if (entry.method === "POST" && entry.path === "/gold-rates") found.push({ entry, body: (entry.body ?? {}) as RateBody });
		} catch {
			/* a line that cannot be read adds nothing */
		}
	}
	return found;
}

/* The rows the waiting entries make, oldest first, each carrying forward from the one before it (starting from `base`). */
async function waitingRows(base: Rate | null): Promise<Rate[]> {
	const rows: Rate[] = [];
	let prev: Rate | null = base;
	for (const { entry, body } of await waiting()) {
		const set = body.rates ?? (body.karat && body.rate ? { [body.karat]: body.rate } : {});
		const row: Rate = {
			id: `offline-${entry.id}`,
			date: body.date ?? entry.occurredAt.slice(0, 10),
			k24: Number(set[24] ?? prev?.k24 ?? 0),
			k22: Number(set[22] ?? prev?.k22 ?? 0),
			k18: Number(set[18] ?? prev?.k18 ?? 0),
			setBy: body.setBy ?? "—",
			createdAt: entry.occurredAt,
		};
		rows.push(row);
		prev = row;
	}
	return rows;
}

/* The newest of the rows kept for this PC, for a rate to carry forward from. */
function newestOf(data: unknown): Rate | null {
	const list = Array.isArray(data) ? data : Array.isArray((data as { items?: unknown[] } | undefined)?.items) ? (data as { items: unknown[] }).items : null;
	return list && list.length ? (list[0] as Rate) : null;
}

/* GET /gold-rates/latest: the newest waiting rate. `body` is null when this PC has never seen an answer. */
export async function adjustLatestRate(body: string | null): Promise<string | null> {
	const rows = await waitingRows(await baseOf(body, "latest"));
	if (!rows.length) return body;
	return JSON.stringify({ success: true, data: rows[rows.length - 1] });
}

/* GET /gold-rates: the waiting rates are listed on top, newest first. Only the first page of the paged history is
 * changed, and a page of it keeps its size. */
export async function adjustRateHistory(path: string, body: string | null): Promise<string | null> {
	const rows = await waitingRows(await baseOf(body, "list"));
	if (!rows.length) return body;
	let env: { data?: unknown; [k: string]: unknown } = { success: true, data: [] };
	if (body !== null) {
		try {
			env = JSON.parse(body) as typeof env;
		} catch {
			return body;
		}
	}
	const newestFirst = [...rows].reverse();
	const data = env.data;
	if (Array.isArray(data)) return JSON.stringify({ ...env, data: [...newestFirst, ...data] });
	const d = data as { items?: Rate[]; hasMore?: boolean; total?: number; limit?: number; offset?: number } | undefined;
	if (!d || !Array.isArray(d.items)) return JSON.stringify({ ...env, data: newestFirst });
	const qs = new URLSearchParams(path.includes("?") ? path.slice(path.indexOf("?") + 1) : "");
	if ((Number(qs.get("offset") ?? "0") || 0) > 0 || (Number(qs.get("page") ?? "1") || 1) > 1) return body;
	const limit = Number(qs.get("limit") ?? "0") || d.items.length + newestFirst.length;
	const total = (d.total ?? d.items.length) + newestFirst.length;
	return JSON.stringify({ ...env, data: { ...d, items: [...newestFirst, ...d.items].slice(0, limit), total, hasMore: total > limit } });
}

async function baseOf(body: string | null, shape: "latest" | "list"): Promise<Rate | null> {
	if (body === null) return null;
	try {
		const env = JSON.parse(body) as { data?: unknown };
		return shape === "latest" ? ((env.data as Rate | undefined) ?? null) : newestOf(env.data);
	} catch {
		return null;
	}
}
