/* Passwords (and any other secret) typed while a change waits in the outbox. The outbox entry and the logs never hold the value: the entry
 * carries the placeholder "secret:<entry id>", and the value lives in data/pending_secrets.json, a file the desktop shell seals for this
 * Windows user (localstore secretFiles). The sender swaps the value in just before the entry is sent and deletes it once the entry is
 * saved (or refused to nobody), and discarding an entry from review deletes it too. */

import { offlineStore } from "@/common/services/desktopBridge";

const FILE = "data/pending_secrets.json";
export const SECRET_REF = "secret:";

type Secrets = Record<string, string>;

// every change to the file goes one after the other, so two saves never overwrite each other
let chain: Promise<unknown> = Promise.resolve();

function serial<T>(job: () => Promise<T>): Promise<T> {
  const next = chain.then(job, job);
  chain = next.catch(() => undefined);
  return next;
}

async function load(): Promise<Secrets> {
  try {
    const text = await offlineStore.readFile(FILE);
    const parsed = text ? (JSON.parse(text) as unknown) : {};
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? (parsed as Secrets) : {};
  } catch {
    return {};
  }
}

/* Keeps the value under the entry id and returns the placeholder to put in the entry's body. */
export function holdSecret(entryId: string, value: string): Promise<string> {
  return serial(async () => {
    const all = await load();
    all[entryId] = value;
    await offlineStore.writeFile(FILE, JSON.stringify(all));
    return `${SECRET_REF}${entryId}`;
  });
}

/* Deletes what was kept for these entries (it was sent, discarded or taken back). */
export function forgetSecrets(entryIds: string[]): Promise<void> {
  if (!entryIds.length) return Promise.resolve();
  return serial(async () => {
    const all = await load();
    let any = false;
    for (const id of entryIds) {
      if (id in all) {
        delete all[id];
        any = true;
      }
    }
    if (any) await offlineStore.writeFile(FILE, JSON.stringify(all));
  });
}

export const forgetSecret = (entryId: string) => forgetSecrets([entryId]);

/* True when the body carries a placeholder somewhere. */
export function hasSecretRef(body: unknown): boolean {
  if (typeof body === "string") return body.startsWith(SECRET_REF);
  if (Array.isArray(body)) return body.some(hasSecretRef);
  if (body && typeof body === "object") return Object.values(body as Record<string, unknown>).some(hasSecretRef);
  return false;
}

/* The body with every placeholder swapped for the kept value; null when a value was lost (the entry then cannot be sent as it was meant). */
export async function resolveSecrets(body: unknown): Promise<unknown | null> {
  if (!hasSecretRef(body)) return body;
  const all = await serial(load);
  const walk = (v: unknown): unknown | null => {
    if (typeof v === "string") {
      if (!v.startsWith(SECRET_REF)) return v;
      const value = all[v.slice(SECRET_REF.length)];
      return typeof value === "string" ? value : null;
    }
    if (Array.isArray(v)) {
      const out: unknown[] = [];
      for (const x of v) {
        const r = walk(x);
        if (r === null) return null;
        out.push(r);
      }
      return out;
    }
    if (v && typeof v === "object") {
      const out: Record<string, unknown> = {};
      for (const [k, x] of Object.entries(v as Record<string, unknown>)) {
        const r = walk(x);
        if (r === null && x !== null) return null;
        out[k] = r;
      }
      return out;
    }
    return v;
  };
  return walk(body);
}
