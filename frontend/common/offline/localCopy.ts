/* The local copy: this branch's data as the screens read it, kept in data\<entity>.json and mirrored in memory.
 * A Save updates it at the same moment as the outbox, so the screen shows the result at once. A pull
 * overwrites it with what the server has, so the server always wins. */

import { offlineStore } from "@/common/services/desktopBridge";
import type { EntityName, LocalRecord } from "./types";

const ENTITIES: EntityName[] = ["loans", "customers", "schemes", "categories", "lockers"];

const cache: Record<EntityName, Map<string, LocalRecord>> = { loans: new Map(), customers: new Map(), schemes: new Map(), categories: new Map(), lockers: new Map() };
const listeners = new Set<() => void>();
let writes: Promise<void> = Promise.resolve();
let loaded = false;

function fileOf(entity: EntityName): string {
  return `data/${entity}.json`;
}

function notify() {
  listeners.forEach((fn) => fn());
}

/* While a Save is applying its change, the files it touches are collected here instead of written, so the entry
 * and the local copy can be committed in one transaction (see saveWithEntry). */
let batch: Map<string, string> | null = null;
let saving: Promise<unknown> = Promise.resolve();

/* Writes are queued one after another so two quick changes never interleave on disk. */
function persist(entity: EntityName): Promise<void> {
  const snapshot = JSON.stringify(Array.from(cache[entity].values()));
  if (batch) {
    batch.set(fileOf(entity), snapshot);
    return Promise.resolve();
  }
  writes = writes.then(() => offlineStore.writeFile(fileOf(entity), snapshot)).catch((e) => {
    offlineStore.log("error", `writing ${fileOf(entity)}: ${e instanceof Error ? e.message : String(e)}`);
  });
  return writes;
}

export async function loadLocalCopy(): Promise<void> {
  for (const entity of ENTITIES) {
    cache[entity].clear();
    try {
      const text = await offlineStore.readFile(fileOf(entity));
      const rows = text ? (JSON.parse(text) as LocalRecord[]) : [];
      for (const r of rows) if (r && typeof r.uuid === "string") cache[entity].set(r.uuid, r);
    } catch (e) {
      offlineStore.log("error", `reading ${fileOf(entity)}: ${e instanceof Error ? e.message : String(e)}`);
    }
  }
  loaded = true;
  notify();
}

/* Queues the entry and applies the same change to the local copy as ONE database transaction: either the screen
 * and the outbox both have it, or neither does. If the commit fails the in-memory copy is put back from disk. */
export function saveWithEntry(line: string, applyLocal: () => Promise<void> | void): Promise<void> {
  const run = async () => {
    const files = new Map<string, string>();
    batch = files;
    try {
      await applyLocal();
    } catch (e) {
      batch = null;
      await loadLocalCopy();
      throw e;
    }
    batch = null;
    // behind any write already queued, so an older snapshot can never land after this one
    const commit = writes.then(() => offlineStore.saveEntry(line, Object.fromEntries(files)));
    writes = commit.catch(() => {});
    try {
      await commit;
    } catch (e) {
      await loadLocalCopy();
      throw e;
    }
  };
  const next = saving.then(run, run);
  saving = next.catch(() => {});
  return next;
}

/* Changes (empty line: removes) an entry that is still waiting to be sent and applies the matching change to the local copy
 * as ONE transaction, like saveWithEntry. Refused when the sender has already sent the entry. */
export function changeWithEntry(id: string, line: string, applyLocal: () => Promise<void> | void): Promise<void> {
  const run = async () => {
    const files = new Map<string, string>();
    batch = files;
    try {
      await applyLocal();
    } catch (e) {
      batch = null;
      await loadLocalCopy();
      throw e;
    }
    batch = null;
    const commit = writes.then(() => offlineStore.changeEntry(id, line, Object.fromEntries(files)));
    writes = commit.catch(() => {});
    try {
      await commit;
    } catch (e) {
      await loadLocalCopy();
      throw e;
    }
  };
  const next = saving.then(run, run);
  saving = next.catch(() => {});
  return next;
}

export function isLoaded(): boolean {
  return loaded;
}

export function listLocal(entity: EntityName): LocalRecord[] {
  return Array.from(cache[entity].values());
}

export function getLocal(entity: EntityName, uuid: string): LocalRecord | undefined {
  return cache[entity].get(uuid);
}

/* Adds the record, or merges the given fields into the one with the same UUID. */
export function upsertLocal(entity: EntityName, rec: LocalRecord): Promise<void> {
  cache[entity].set(rec.uuid, { ...cache[entity].get(rec.uuid), ...rec });
  notify();
  return persist(entity);
}

export function removeLocal(entity: EntityName, uuid: string): Promise<void> {
  cache[entity].delete(uuid);
  notify();
  return persist(entity);
}

/* A full pull: what the server sent becomes the whole local copy, except records that still have a waiting
 * entry, which keep their local version until that entry is sent. */
export function replaceLocal(entity: EntityName, rows: LocalRecord[], keep: Set<string>): Promise<void> {
  const next = new Map<string, LocalRecord>();
  for (const r of rows) next.set(r.uuid, r);
  cache[entity].forEach((rec, uuid) => {
    if (keep.has(uuid)) next.set(uuid, rec);
  });
  cache[entity] = next;
  notify();
  return persist(entity);
}

/* An incremental pull: changed rows overwrite, removed rows go. */
export function mergeLocal(entity: EntityName, rows: LocalRecord[], removed: string[], keep: Set<string>, persistNow = true): Promise<void> {
  for (const r of rows) if (!keep.has(r.uuid)) cache[entity].set(r.uuid, r);
  for (const uuid of removed) if (!keep.has(uuid)) cache[entity].delete(uuid);
  notify();
  return persistNow ? persist(entity) : Promise.resolve();
}

/* Writes the entity to disk now; a long download merges many pages in memory and saves at checkpoints. */
export function saveLocal(entity: EntityName): Promise<void> {
  return persist(entity);
}

export function subscribeLocal(fn: () => void): () => void {
  listeners.add(fn);
  return () => {
    listeners.delete(fn);
  };
}
