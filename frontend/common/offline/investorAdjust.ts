/* Investors made, edited or deleted on this PC and not sent yet. The investors list and an investor's page are the server's last
 * answer, which cannot know about them, so the local copy ("investors": only what is waiting, plus the id each one got once sent)
 * is laid over that answer:
 *   kind "new"    an investor made here; id 0 until the server numbers it, shown under the id "uuid:<uuid>"
 *   kind "edit"   the fields changed on an investor the server has (uuid "inv-<id>")
 *   kind "delete" an investor the server has, deleted here (uuid "inv-<id>")
 * An investor made here keeps its record after it is sent (with the server's id), so an investment made for it can be sent with that
 * id; it is no longer listed then, the server's own answer has it. */

import { listLocal } from "./localCopy";
import { getSelectedBranchId } from "@/common/services/branchSelection";

type Rec = Record<string, unknown> & { uuid: string; id?: number; kind?: string };
type Env = { data?: unknown; [k: string]: unknown };

export const investorOverlayKey = (id: number | string) => `inv-${id}`;

function records(): Rec[] {
	return listLocal("investors") as unknown as Rec[];
}

/* The fields of an overlay record that are laid over a server row. */
function fieldsOf(r: Rec): Record<string, unknown> {
	const { uuid: _u, kind: _k, syncReview: _s, ...rest } = r as Rec & { syncReview?: unknown };
	void _u; void _k; void _s;
	return rest;
}

function matches(r: Rec, words: string[]): boolean {
	if (!words.length) return true;
	const text = [r.name, r.code, r.phone].join(" ").toLowerCase();
	return words.every((w) => text.includes(w));
}

/* GET /investors (a list) and GET /investors/<id> or /investors/uuid:<uuid> (one). */
export function adjustInvestors(path: string, kept: string | null): string | null {
	const all = records();
	if (!all.length) return kept;
	const [base, query = ""] = path.split("?");
	const one = /\/investors\/(uuid:[^/?]+|\d+)$/.exec(base);
	if (one) return adjustOne(one[1], all, kept);
	if (!/\/investors$/.test(base)) return kept;
	const qs = new URLSearchParams(query);
	const edits = new Map<number, Rec>();
	const gone = new Set<number>();
	for (const r of all) {
		if (r.kind === "edit" && r.id) edits.set(Number(r.id), r);
		else if (r.kind === "delete" && r.id) gone.add(Number(r.id));
	}
	const picked = getSelectedBranchId();
	const words = (qs.get("q") || qs.get("search") || "").trim().toLowerCase().split(/\s+/).filter(Boolean);
	const limit = Number(qs.get("limit") ?? "0") || 0;
	const offset = qs.has("offset") ? Number(qs.get("offset")) || 0 : limit > 0 ? ((Number(qs.get("page") ?? "1") || 1) - 1) * limit : 0;
	// the ones made here and not sent yet, on the first page, narrowed like the server would
	const fresh = all
		.filter((r) => r.kind === "new" && !(Number(r.id) > 0) && (!picked || r.branchId === picked) && matches(r, words))
		.sort((a, b) => String(a.createdAt ?? "").localeCompare(String(b.createdAt ?? "")))
		.map((r) => fieldsOf(r));
	let env: Env = { success: true, data: { items: [], hasMore: false, total: 0 } };
	if (kept !== null) {
		try {
			env = JSON.parse(kept) as Env;
		} catch {
			return kept;
		}
	}
	const fix = (row: unknown) => {
		const id = Number((row as { id?: number }).id);
		return edits.has(id) ? { ...(row as object), ...fieldsOf(edits.get(id) as Rec) } : row;
	};
	const keep = (row: unknown) => !gone.has(Number((row as { id?: number }).id));
	if (Array.isArray(env.data)) return JSON.stringify({ ...env, data: [...(offset === 0 ? fresh : []), ...env.data.filter(keep).map(fix)] });
	const d = env.data as { items?: unknown[]; hasMore?: boolean; total?: number } | undefined;
	if (!d || !Array.isArray(d.items)) return kept;
	const items = d.items.filter(keep).map(fix);
	const add = offset === 0 ? fresh : [];
	const removed = d.items.length - items.length;
	const total = Math.max(0, (d.total ?? d.items.length) - removed + fresh.length);
	const rows = [...add, ...items];
	return JSON.stringify({ ...env, data: { ...d, items: limit > 0 ? rows.slice(0, limit) : rows, total, hasMore: limit > 0 ? offset + limit < total : d.hasMore } });
}

function adjustOne(ref: string, all: Rec[], kept: string | null): string | null {
	if (ref.startsWith("uuid:")) {
		const mine = all.find((r) => r.kind === "new" && r.uuid === ref.slice(5));
		return mine ? JSON.stringify({ success: true, data: fieldsOf(mine) }) : kept;
	}
	const id = Number(ref);
	if (all.some((r) => r.kind === "delete" && Number(r.id) === id)) return null;
	const edit = all.find((r) => r.kind === "edit" && Number(r.id) === id);
	if (!edit || kept === null) return kept;
	try {
		const env = JSON.parse(kept) as Env;
		const d = env.data;
		if (!d || typeof d !== "object" || Array.isArray(d)) return kept;
		return JSON.stringify({ ...env, data: { ...(d as object), ...fieldsOf(edit) } });
	} catch {
		return kept;
	}
}
