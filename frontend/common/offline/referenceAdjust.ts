/* Reference lists changed on this PC and not sent yet: purity standards added, and expense or cash categories deleted.
 * The screens show the server's last answer, which cannot know about them, so each waiting entry is applied to that answer
 * here. Once an entry has been sent the server's own list includes the change and it is no longer in the outbox, so nothing is
 * applied twice. */

import { bare, holderOf, num, parse, waitingEntries, type Row } from "./setupAdjust";
import { localRequestId } from "./requestRef";

const PURITY_LIST = /\/purity-standards$/;
const CATEGORY_LIST = /\/(?:expense-)?categories$/;
const CATEGORY_ONE = /\/((?:expense-)?categories)\/(-?\d+)$/;

const finenessForKarat = (karat: number) => Math.round((karat / 24) * 1000) / 10;

/* The row the server will make for a waiting "add purity standard" entry (the same label rules as FindPurityStandardOrCreate). */
function draftPurity(entryId: string, createdAt: string, body: { karat?: number; finenessPercent?: number }): Row {
  const karat = body.karat ?? null;
  const fineness = body.finenessPercent ?? null;
  const label = karat !== null ? `${karat}K` : `${fineness}%`;
  return { id: localRequestId(entryId), karat, finenessPercent: fineness ?? (karat !== null ? finenessForKarat(karat) : null), label, isActive: true, createdAt, updatedAt: createdAt };
}

export async function adjustReferenceLists(path: string, body: string): Promise<string> {
  const p = bare(path);
  const purity = PURITY_LIST.test(p);
  const category = CATEGORY_LIST.test(p) || CATEGORY_ONE.test(p);
  if (!purity && !category) return body;
  const entries = await waitingEntries();
  const env = parse(body);
  if (!env) return body;

  if (purity) {
    const adds = entries.filter((e) => e.method === "POST" && /\/purity-standards$/.test(bare(e.path)));
    const holder = holderOf(env);
    if (!adds.length || !holder) return body;
    const rows = [...holder.rows];
    for (const e of adds) {
      const b = (e.body ?? {}) as { karat?: number; finenessPercent?: number };
      // the server returns the standard it already has for that karat or fineness, and makes no second one
      const has = rows.some((r) => (b.karat !== undefined ? num(r.karat) === b.karat : Math.round(num(r.finenessPercent) * 10) === Math.round(num(b.finenessPercent) * 10)));
      if (!has) rows.push(draftPurity(e.id, e.occurredAt, b));
    }
    return JSON.stringify(holder.put(rows, rows.length - holder.rows.length));
  }

  const gone = new Set<string>();
  for (const e of entries) {
    if (e.method !== "DELETE") continue;
    const m = CATEGORY_ONE.exec(bare(e.path));
    if (m) gone.add(`${m[1]}:${m[2]}`);
  }
  if (!gone.size) return body;
  const holder = holderOf(env);
  if (holder) {
    const kind = /expense-categories/.test(p) ? "expense-categories" : "categories";
    const rows = holder.rows.filter((r) => !gone.has(`${kind}:${num(r.id)}`));
    return rows.length === holder.rows.length ? body : JSON.stringify(holder.put(rows, rows.length - holder.rows.length));
  }
  // one category that was deleted on this PC is gone from its own page too
  const m = CATEGORY_ONE.exec(p);
  return m && gone.has(`${m[1]}:${m[2]}`) ? JSON.stringify({ success: false, error: "category not found" }) : body;
}
