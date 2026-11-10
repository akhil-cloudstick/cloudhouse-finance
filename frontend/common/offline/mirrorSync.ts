/* Keeps the mirror (the server's business tables, copied row for row into this PC's database) current. It runs in the
 * background after a pull and never blocks a screen.
 *   incremental tables: the rows changed since the table's cursor, a page at a time; a loan that comes down brings its
 *                       whole tree of child rows with it, replacing what the PC held for that loan
 *   whole tables:       small tables with no change time are fetched whole and replaced when they differ
 *   removals:           every so often the server lists the ids this user can see, and the PC drops the rest
 * Each page and its cursor are applied in one transaction, so a dropped connection resumes from the last page. */

import { apiFetchEnveloped } from "@/common/services/httpClient";
import { offlineStore } from "@/common/services/desktopBridge";
import { employeeId } from "./session";
import { setMirror } from "./progress";
import { sharedData } from "./state";

type Row = Record<string, unknown>;
type Relation = { table: string; column: string };
type TableMeta = {
	name: string;
	mode: "incremental" | "whole" | "child";
	primary_key: string[];
	has_deleted_at: boolean;
	parent?: Relation;
	children?: Relation[];
};
type Page = { rows: Row[]; has_more: boolean; next: { after: string; start: string }; cursor: string };
type Batch = { table: string; truncate?: boolean; refresh?: number[]; delete?: number[]; rows?: Row[] };

const PAGE = 2000;
const CHILD_CHUNK = 200;
const IDS_EVERY_MS = 60 * 60_000;

export const MIRROR_STATUS_EVENT = "app:offline-copy-status";

export type MirrorStatus = { ready: boolean; running: boolean; tables: number; rows: number };

let status: MirrorStatus = { ready: false, running: false, tables: 0, rows: 0 };

export function mirrorStatus(): MirrorStatus {
	return status;
}

function announce(next: Partial<MirrorStatus>) {
	status = { ...status, ...next };
	const forward: { running?: boolean; ready?: boolean } = {};
	if (next.running !== undefined) forward.running = next.running;
	if (next.ready !== undefined) forward.ready = next.ready;
	if (forward.running !== undefined || forward.ready !== undefined) setMirror(forward);
	if (typeof window !== "undefined") window.dispatchEvent(new Event(MIRROR_STATUS_EVENT));
}

class NoAnswer extends Error {}

async function api<T>(path: string): Promise<T> {
	try {
		return await apiFetchEnveloped<T>(`/users/${employeeId()}/sync/${path}`);
	} catch (e) {
		if ((e as { status?: number }).status === 0) throw new NoAnswer("no answer from the server");
		throw e;
	}
}

function pk(t: TableMeta): string {
	return t.primary_key[0] ?? "id";
}

function ids(rows: Row[], t: TableMeta): number[] {
	return rows.map((r) => Number(r[pk(t)])).filter((n) => Number.isFinite(n));
}

function chunks<T>(list: T[], size: number): T[][] {
	const out: T[][] = [];
	for (let i = 0; i < list.length; i += size) out.push(list.slice(i, i + size));
	return out;
}

/* The rows that hang off the given parent rows, level by level, added to the batch. */
async function addChildren(parent: TableMeta, parentIds: number[], by: Map<string, TableMeta>, batch: Map<string, Batch>): Promise<void> {
	if (parentIds.length === 0) return;
	for (const rel of parent.children ?? []) {
		const child = by.get(rel.table);
		if (!child) continue;
		const rows: Row[] = [];
		for (const part of chunks(parentIds, CHILD_CHUNK)) {
			const page = await api<Page>(`children/${rel.table}?ids=${part.join(",")}`);
			rows.push(...(page.rows ?? []));
		}
		const entry = batch.get(rel.table) ?? { table: rel.table, rows: [] };
		entry.rows = [...(entry.rows ?? []), ...rows];
		batch.set(rel.table, entry);
		await addChildren(child, ids(rows, child), by, batch);
	}
}

function hashOf(text: string): string {
	let h = 2166136261;
	for (let i = 0; i < text.length; i++) {
		h ^= text.charCodeAt(i);
		h = Math.imul(h, 16777619);
	}
	return `${text.length}:${(h >>> 0).toString(16)}`;
}

async function syncIncremental(t: TableMeta, by: Map<string, TableMeta>): Promise<void> {
	const cursorKey = `cursor.${t.name}`;
	const posKey = `pos.${t.name}`;
	let since = await offlineStore.mirrorState(cursorKey);
	let after = "";
	let start = "";
	const saved = await offlineStore.mirrorState(posKey);
	if (saved) {
		try {
			const p = JSON.parse(saved) as { since: string; after: string; start: string };
			since = p.since;
			after = p.after;
			start = p.start;
		} catch {
			/* an unreadable position starts the table again */
		}
	}
	for (;;) {
		const q = new URLSearchParams({ limit: String(PAGE) });
		if (since) q.set("since", since);
		if (after) q.set("after", after);
		if (start) q.set("start", start);
		const page = await api<Page>(`table/${t.name}?${q.toString()}`);
		const dead: number[] = [];
		const live: Row[] = [];
		page.rows ??= [];
		for (const r of page.rows) {
			if (t.has_deleted_at && r.deleted_at) dead.push(Number(r[pk(t)]));
			else live.push(r);
		}
		const batch = new Map<string, Batch>();
		const liveIds = ids(live, t);
		const own: Batch = { table: t.name, rows: live, delete: dead };
		if ((t.children ?? []).length > 0) own.refresh = liveIds;
		batch.set(t.name, own);
		await addChildren(t, liveIds, by, batch);
		const state: Record<string, string> = page.has_more
			? { [posKey]: JSON.stringify({ since, after: page.next.after, start: page.next.start }) }
			: { [cursorKey]: page.cursor, [posKey]: "" };
		await offlineStore.mirrorApply(JSON.stringify({ tables: Array.from(batch.values()), state }));
		if (!page.has_more) return;
		after = page.next.after;
		start = page.next.start;
	}
}

async function syncWhole(t: TableMeta): Promise<void> {
	const page = await api<Page>(`table/${t.name}`);
	page.rows ??= [];
	const hash = hashOf(JSON.stringify(page.rows));
	if ((await offlineStore.mirrorState(`hash.${t.name}`)) === hash) return;
	await offlineStore.mirrorApply(JSON.stringify({ tables: [{ table: t.name, truncate: true, rows: page.rows }], state: { [`hash.${t.name}`]: hash } }));
}

/* Rows the server no longer shows this user (deleted there, or moved out of the branch) are dropped here, with their children. */
async function dropGone(tables: TableMeta[]): Promise<void> {
	for (const t of tables) {
		const server = await api<{ ids: number[] }>(`table/${t.name}/ids`);
		const live = new Set(server.ids);
		const local = await offlineStore.mirrorIds(t.name);
		if (local.length > 0 && live.size === 0) {
			offlineStore.log("warn", `mirror: the server listed no ${t.name} while ${local.length} are held here; nothing removed`);
			continue;
		}
		const gone = local.filter((id) => !live.has(id));
		if (gone.length === 0) continue;
		for (const part of chunks(gone, 500)) {
			await offlineStore.mirrorApply(JSON.stringify({ tables: [{ table: t.name, delete: part }] }));
		}
		offlineStore.log("info", `mirror: ${gone.length} ${t.name} rows no longer on the server or in this branch were removed`);
	}
}

/* A table the user may no longer view is emptied here, with its cursors, and marked; when the permission comes back the
 * table (or the tree it hangs off) is downloaded again from the start. */
async function applyPermissions(have: Record<string, number>, allowed: Map<string, TableMeta>): Promise<void> {
	const clear: Record<string, string> = {};
	const tables: Batch[] = [];
	for (const name of Object.keys(have)) {
		if (allowed.has(name)) continue;
		const flagged = (await offlineStore.mirrorState(`denied.${name}`)) === "1";
		if (flagged && have[name] === 0) continue;
		tables.push({ table: name, truncate: true });
		clear[`cursor.${name}`] = "";
		clear[`pos.${name}`] = "";
		clear[`hash.${name}`] = "";
		clear[`denied.${name}`] = "1";
	}
	for (const t of allowed.values()) {
		if ((await offlineStore.mirrorState(`denied.${t.name}`)) !== "1") continue;
		clear[`denied.${t.name}`] = "";
		let root = t;
		while (root.parent && allowed.has(root.parent.table)) root = allowed.get(root.parent.table)!;
		clear[`cursor.${root.name}`] = "";
		clear[`pos.${root.name}`] = "";
		clear[`hash.${root.name}`] = "";
	}
	if (tables.length || Object.keys(clear).length) await offlineStore.mirrorApply(JSON.stringify({ tables, state: clear }));
}

let again = false;
let current: Promise<boolean> | null = null;

/* Brings every mirrored table up to date and resolves when the pass has finished (true when every table is current). A call
 * made during a pass gets that pass's result and queues one more, so no request is lost. */
export function syncMirror(why: string): Promise<boolean> {
	if (sharedData()) return Promise.resolve(false); // the main PC downloads for every PC
	if (current) {
		again = true;
		return current;
	}
	current = runMirror(why).finally(() => {
		current = null;
		if (again) {
			again = false;
			void syncMirror("queued");
		}
	});
	return current;
}

async function runMirror(why: string): Promise<boolean> {
	if (!employeeId() || !offlineStore.available()) return false;
	announce({ running: true });
	let ok = false;
	try {
		const info = await api<{ tenant: number; scope: string; tables: TableMeta[] }>("tables");
		// the file holds one business only: another business's rows are cleared before anything is written
		await offlineStore.mirrorBindTenant(info.tenant);
		const have = await offlineStore.mirrorCounts();
		// A different user or branch assignment sees a different set of rows. What changed since the last visit would miss the
		// rest, so every table starts again from the beginning (rows already held are matched by id, and what the new view cannot
		// see is dropped by the check below, which is made to run now).
		if ((await offlineStore.mirrorState("scope")) !== info.scope) {
			const reset: Record<string, string> = { scope: info.scope, "ids.checked_at": "0", "mirror.ready": "" };
			for (const name of Object.keys(have)) {
				reset[`cursor.${name}`] = "";
				reset[`pos.${name}`] = "";
				reset[`hash.${name}`] = "";
			}
			await offlineStore.mirrorApply(JSON.stringify({ tables: [], state: reset }));
			announce({ ready: false });
		}
		const usable = info.tables.filter((t) => t.name in have);
		const by = new Map(usable.map((t) => [t.name, t]));
		await applyPermissions(have, by);
		const roots = usable.filter((t) => t.mode !== "child");
		const failed: string[] = [];
		setMirror({ done: 0, total: roots.length });
		let finished = 0;
		for (const t of roots) {
			try {
				if (t.mode === "incremental") await syncIncremental(t, by);
				else await syncWhole(t);
			} catch (e) {
				// no answer ends the pass; any other failure is recorded for this table and the rest still download
				if (e instanceof NoAnswer) throw e;
				failed.push(t.name);
				offlineStore.log("warn", `mirror: ${t.name} failed: ${e instanceof Error ? e.message : String(e)}`);
			}
			setMirror({ done: ++finished });
		}
		if (failed.length > 0) {
			offlineStore.log("warn", `mirror (${why}): not complete, ${failed.length} table(s) failed: ${failed.join(", ")}`);
			const counts = await offlineStore.mirrorCounts();
			announce({ ready: false, tables: Object.keys(counts).length, rows: Object.values(counts).reduce((a, b) => a + b, 0) });
			return false;
		}
		const checked = Number((await offlineStore.mirrorState("ids.checked_at")) || 0);
		if (Date.now() - checked > IDS_EVERY_MS) {
			await dropGone(roots);
			await offlineStore.mirrorApply(JSON.stringify({ tables: [], state: { "ids.checked_at": String(Date.now()) } }));
		}
		await offlineStore.mirrorApply(JSON.stringify({ tables: [], state: { "mirror.ready": "1" } }));
		const counts = await offlineStore.mirrorCounts();
		announce({ ready: true, tables: Object.keys(counts).length, rows: Object.values(counts).reduce((a, b) => a + b, 0) });
		offlineStore.log("info", `mirror (${why}): up to date`);
		ok = true;
	} catch (e) {
		if (!(e instanceof NoAnswer)) offlineStore.log("warn", `mirror (${why}) failed: ${e instanceof Error ? e.message : String(e)}`);
	} finally {
		announce({ running: false });
	}
	return ok;
}

/* Called once the store is open: whether the mirror was complete at the end of the last session. */
export async function loadMirrorStatus(): Promise<void> {
	try {
		const counts = await offlineStore.mirrorCounts();
		announce({
			ready: (await offlineStore.mirrorState("mirror.ready")) === "1",
			tables: Object.keys(counts).length,
			rows: Object.values(counts).reduce((a, b) => a + b, 0),
		});
	} catch {
		/* the mirror is not available in this build */
	}
}
