/* The local copy: this branch's data as the screens read it, kept in data\<entity>.json and mirrored in memory.
 * A Save updates it at the same moment as the outbox, so the screen shows the result at once. A pull
 * overwrites it with what the server has, so the server always wins. */

import { offlineStore } from "@/common/services/desktopBridge";
import type { EntityName, LocalRecord } from "./types";

const ENTITIES: EntityName[] = ["loans", "customers", "schemes", "categories"];

const cache: Record<EntityName, Map<string, LocalRecord>> = { loans: new Map(), customers: new Map(), schemes: new Map(), categories: new Map() };
const listeners = new Set<() => void>();
let writes: Promise<void> = Promise.resolve();
let loaded = false;

function fileOf(entity: EntityName): string {
  return `data/${entity}.json`;
}

function notify() {
  listeners.forEach((fn) => fn());
}

/* Writes are queued one after another so two quick changes never interleave on disk. */
function persist(entity: EntityName): Promise<void> {
  const snapshot = JSON.stringify(Array.from(cache[entity].values()));
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
export function mergeLocal(entity: EntityName, rows: LocalRecord[], removed: string[], keep: Set<string>): Promise<void> {
  for (const r of rows) if (!keep.has(r.uuid)) cache[entity].set(r.uuid, r);
  for (const uuid of removed) if (!keep.has(uuid)) cache[entity].delete(uuid);
  notify();
  return persist(entity);
}

export function subscribeLocal(fn: () => void): () => void {
  listeners.add(fn);
  return () => {
    listeners.delete(fn);
  };
}
