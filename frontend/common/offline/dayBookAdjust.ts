/* The Day Book report while the server does not answer: the server's last answer with this PC's waiting entries applied. A line
 * written here shows in its date order, an edit changes the line, a delete removes it, and the totals are worked out again.
 * Once an entry has been sent the server's own rows include it and it is no longer in the outbox, so nothing is counted twice. */

import { offlineStore } from "@/common/services/desktopBridge";
import { queryOf } from "./cashAdjust";
import { refuse } from "./validate";
import type { OutboxEntry } from "./types";

type Row = { id: number; date: string; particulars: string; debit: number; credit: number; interest: number };
type Input = { date: string; particulars: string; debit: number; credit: number; interest: number };
type Env = { success?: boolean; data?: { rows?: Row[]; totals?: { debit: number; credit: number; interest: number }; totalCount?: number } };

const PARTICULARS_MAX = 255;
const ENTRY = /^\/reports\/day-book(?:\/(-?\d+))?$/;
const round2 = (v: number) => Math.round(v * 100) / 100;

/* The server's own checks on a Day Book line (dayBookInput), with its words, made before the line is queued. */
export function checkDayBookLocally(input: Input): void {
  const date = /^\d{4}-\d{2}-\d{2}$/.test((input.date ?? "").trim()) ? new Date(`${input.date.trim()}T00:00:00Z`) : null;
  if (!date || Number.isNaN(date.getTime())) refuse("date is required");
  const limit = new Date();
  limit.setUTCDate(limit.getUTCDate() + 1);
  if (date.getTime() > limit.getTime()) refuse("date cannot be in the future");
  const particulars = (input.particulars ?? "").trim();
  if (!particulars) refuse("particulars are required");
  if ([...particulars].length > PARTICULARS_MAX) refuse(`particulars can be at most ${PARTICULARS_MAX} characters`);
  if (input.debit < 0 || input.credit < 0 || input.interest < 0) refuse("amounts cannot be negative");
  if (!input.debit && !input.credit && !input.interest) refuse("enter a debit, credit or interest amount");
}

async function waiting(): Promise<OutboxEntry[]> {
  const found: OutboxEntry[] = [];
  for (const line of await offlineStore.readAllOutbox().catch(() => [] as string[])) {
    try {
      const e = JSON.parse(line) as OutboxEntry;
      if (ENTRY.test(e.path.split("?")[0])) found.push(e);
    } catch {
      /* a line that cannot be read changes nothing */
    }
  }
  return found;
}

export async function adjustDayBook(path: string, body: string): Promise<string> {
  const entries = await waiting();
  if (!entries.length) return body;
  let env: Env;
  try {
    env = JSON.parse(body) as Env;
  } catch {
    return body;
  }
  const data = env.data;
  if (!data || !Array.isArray(data.rows)) return body;
  const qs = queryOf(path);
  const from = qs.get("from") ?? "";
  const to = qs.get("to") ?? "";
  const searching = !!qs.get("search");
  let rows = [...data.rows];
  let n = 0;
  for (const e of entries) {
    const id = Number(ENTRY.exec(e.path.split("?")[0])?.[1] ?? 0);
    const b = (e.body ?? {}) as Partial<Input>;
    n += 1;
    if (e.method === "POST" && !id) {
      const date = String(b.date ?? "").slice(0, 10);
      // a line outside the period on screen, or one a search would not match, is left out like the server would
      if (searching || (from && date < from) || (to && date > to)) continue;
      rows.push({ id: -n, date, particulars: String(b.particulars ?? "").trim(), debit: Number(b.debit) || 0, credit: Number(b.credit) || 0, interest: Number(b.interest) || 0 });
    } else if (e.method === "PATCH" && id) {
      rows = rows.map((r) => (r.id === id ? { ...r, date: String(b.date ?? r.date).slice(0, 10), particulars: String(b.particulars ?? r.particulars).trim(), debit: Number(b.debit) || 0, credit: Number(b.credit) || 0, interest: Number(b.interest) || 0 } : r));
      // an edit that moves the line out of the period on screen takes it off this list
      rows = rows.filter((r) => r.id !== id || ((!from || r.date >= from) && (!to || r.date <= to)));
    } else if (e.method === "DELETE" && id) {
      rows = rows.filter((r) => r.id !== id);
    }
  }
  // the server's order: by date, then in the order the lines were made (a line not yet numbered comes last)
  const rank = (r: Row) => (r.id > 0 ? r.id : Number.MAX_SAFE_INTEGER + r.id);
  rows.sort((a, b) => a.date.localeCompare(b.date) || rank(a) - rank(b));
  data.rows = rows;
  data.totalCount = rows.length;
  data.totals = {
    debit: round2(rows.reduce((s, r) => s + r.debit, 0)),
    credit: round2(rows.reduce((s, r) => s + r.credit, 0)),
    interest: round2(rows.reduce((s, r) => s + r.interest, 0)),
  };
  return JSON.stringify(env);
}
