/* An extension or release request made on this PC has no server id until it is sent, yet it can be verified, paid and
 * approved in the meantime. The lists show it under a local (negative) id, and those later entries address it as
 * ref:<id of the entry that creates it>; once that entry has been sent the server's request id is kept here, and the
 * sender swaps the ref for it just before the later entry goes. Same idea as pledgeRef.ts. */

import { offlineStore } from "@/common/services/desktopBridge";
import type { OutboxEntry } from "./types";

const FILE = "data/request_refs.json";
export const REQUEST_REF = /\/loans\/requests\/ref:([0-9a-f-]+)(\/|$)/i;
const CREATES_REQUEST = /^\/loans\/uuid:[0-9a-f-]+\/(release|extension)-request$/i;

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
export function localRequestId(entryId: string): number {
  return -(parseInt(entryId.replace(/-/g, "").slice(-7), 16) + 1);
}

export function createsRequest(entry: Pick<OutboxEntry, "method" | "path">): boolean {
  return entry.method === "POST" && CREATES_REQUEST.test(entry.path);
}

/* The reply to the entry that created the request carries the server's id for it. */
export async function rememberRequest(entryId: string, body: unknown): Promise<void> {
  const rec = ((body as { data?: unknown } | undefined)?.data ?? body) as { id?: number } | undefined;
  const id = Number(rec?.id) || 0;
  if (id <= 0) return;
  const map = await load();
  map[entryId] = id;
  await offlineStore.writeFile(FILE, JSON.stringify(map));
}

/* The entry's path with a ref swapped for the server's request id; null when that request never reached the server. */
export async function resolveRequestPath(path: string): Promise<string | null> {
  const m = REQUEST_REF.exec(path);
  if (!m) return path;
  const id = (await load())[m[1]];
  return id ? path.replace(`ref:${m[1]}`, String(id)) : null;
}

/* An investment plan made on this PC works the same way: it is listed under a local id, and an investment made with it
 * carries "plan-ref:<entry id>" as its plan until the sender swaps in the server's plan id. */
export const PLAN_REF = "plan-ref:";

export function createsPlan(entry: Pick<OutboxEntry, "method" | "path">): boolean {
  return entry.method === "POST" && entry.path === "/investment-plans";
}

export function findLocalPlan(localId: number): Promise<{ entryId: string } | { serverId: number } | null> {
  return findLocalRequest(localId, createsPlan);
}

/* The body with every plan ref swapped for the server's plan id; null when that plan never reached the server. */
export async function resolvePlanRefs(body: unknown): Promise<unknown | null> {
  if (typeof body === "string") {
    if (!body.startsWith(PLAN_REF)) return body;
    const id = (await load())[body.slice(PLAN_REF.length)];
    return id ? id : null;
  }
  if (Array.isArray(body)) {
    const out: unknown[] = [];
    for (const v of body) {
      const r = await resolvePlanRefs(v);
      if (r === null) return null;
      out.push(r);
    }
    return out;
  }
  if (body && typeof body === "object") {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(body as Record<string, unknown>)) {
      const r = await resolvePlanRefs(v);
      if (r === null && v !== null) return null;
      out[k] = r;
    }
    return out;
  }
  return body;
}

/* What a local request id points at: the waiting entry that creates it (so later entries can address it by ref), or the
 * server id once that entry has been sent. */
export async function findLocalRequest(localId: number, creates: (e: OutboxEntry) => boolean = createsRequest): Promise<{ entryId: string } | { serverId: number } | null> {
  for (const line of await offlineStore.readAllOutbox().catch(() => [] as string[])) {
    try {
      const e = JSON.parse(line) as OutboxEntry;
      if (creates(e) && localRequestId(e.id) === localId) return { entryId: e.id };
    } catch {
      /* a line that cannot be read creates nothing */
    }
  }
  const map = await load();
  for (const [entryId, serverId] of Object.entries(map)) if (localRequestId(entryId) === localId) return { serverId };
  return null;
}
