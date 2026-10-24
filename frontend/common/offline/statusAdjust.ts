/* Decisions and movements made on this PC that the server has not been sent yet. The request lists and the packet
 * screens show the server's last answer, which cannot know about them, so each waiting entry is applied to that answer
 * in the same way the server will once it is sent. When it has been sent the server's own answer includes it and it is
 * no longer in the outbox, so nothing is applied twice.
 *
 *  - request decisions (verify, approve, reject, payment): the request is marked "syncPending" (the list shows
 *    "Sending") and a rejection shows as Rejected;
 *  - packet movements: the packet shows its new stage and locker, and the movement list gets the new row. */

import { offlineStore } from "@/common/services/desktopBridge";
import { listLocal } from "./localCopy";
import { localRequestId } from "./requestRef";
import type { OutboxEntry } from "./types";

type Env = { data?: unknown; [k: string]: unknown };

async function waiting(): Promise<OutboxEntry[]> {
  const found: OutboxEntry[] = [];
  for (const line of await offlineStore.readAllOutbox().catch(() => [] as string[])) {
    try {
      found.push(JSON.parse(line) as OutboxEntry);
    } catch {
      /* a line that cannot be read changes nothing */
    }
  }
  return found;
}

function parse(body: string): Env | null {
  try {
    return JSON.parse(body) as Env;
  } catch {
    return null;
  }
}

/* The rows of a list answer: a bare list, or a page of {items}. Returns a setter so the page keeps its shape. */
function rowsOf(env: Env): { rows: Record<string, unknown>[]; put: (rows: Record<string, unknown>[]) => void } | null {
  const d = env.data;
  if (Array.isArray(d)) return { rows: d as Record<string, unknown>[], put: (r) => { env.data = r; } };
  if (d && typeof d === "object" && Array.isArray((d as { items?: unknown[] }).items)) {
    const o = d as { items: Record<string, unknown>[] };
    return { rows: o.items, put: (r) => { o.items = r; } };
  }
  return null;
}

/* GET /loans/requests...: rows with a decision waiting to be sent, and a row for each new extension or release request
 * waiting to be sent (narrowed by the same loan / type / status the screen asked for). */
export async function adjustRequests(path: string, body: string): Promise<string> {
  const env = parse(body);
  if (!env) return body;
  const list = rowsOf(env);
  if (!list) return body;
  const qs = new URLSearchParams(path.includes("?") ? path.slice(path.indexOf("?") + 1) : "");
  const marks = new Map<number, { rejected: boolean; view: Record<string, unknown> }>();
  const fresh: Record<string, unknown>[] = [];
  for (const e of await waiting()) {
    const m = /^\/loans\/requests\/(\d+|ref:[0-9a-f-]+)\/(approve|decide|verify|release-payment)$/i.exec(e.path);
    if (m) {
      // a request made on this PC is addressed by the entry that creates it, and listed under the local id made from it
      const id = m[1].startsWith("ref:") ? localRequestId(m[1].slice(4)) : Number(m[1]);
      const rejected = (e.body as { action?: string } | undefined)?.action === "Rejected";
      // each waiting decision is applied in the order it was made, so a payment then an approval ends as approved
      marks.set(id, { rejected: rejected || !!marks.get(id)?.rejected, view: { ...marks.get(id)?.view, ...e.view } });
      continue;
    }
    const n = /^\/loans\/uuid:([0-9a-f-]+)\/(extension|release)-request$/i.exec(e.path);
    if (!n || e.method !== "POST") continue;
    const loan = listLocal("loans").find((l) => l.uuid === n[1]) as Record<string, unknown> | undefined;
    if (!loan) continue;
    const type = n[2] === "extension" ? "Extension" : "Release";
    const b = (e.body ?? {}) as { months?: number; detail?: string; ornamentIds?: number[] };
    const wantLoan = qs.get("loanId") ?? qs.get("loan_id");
    if (wantLoan && Number(wantLoan) !== Number(loan.id)) continue;
    if (qs.get("type") && qs.get("type") !== type) continue;
    if (qs.get("status") && qs.get("status") !== "Pending") continue;
    fresh.push({
      id: localRequestId(e.id),
      loanId: loan.id,
      loan: { loanNumber: loan.loanNumber, customer: loan.customer, status: loan.status },
      type,
      status: "Pending",
      requestedBy: "Staff",
      detail: b.detail ?? "",
      requestedAt: e.occurredAt,
      requestedExtensionMonths: type === "Extension" ? b.months ?? null : null,
      isPartial: type === "Release" && !!b.ornamentIds?.length,
      ornamentSelections: (b.ornamentIds ?? []).map((ornamentId) => ({ ornamentId })),
      approvalStage: "",
      remarks: "",
      verificationNotes: "",
      customerSawGold: false,
      paymentRecorded: false,
      locked: false,
      charges: 0,
      chargesApplied: 0,
      settlementAmount: 0,
      recordedDiscount: 0,
      recordedPayment: 0,
      ...e.view,
      syncPending: true,
    });
  }
  if (!marks.size && !fresh.length) return body;
  const wantStatus = qs.get("status");
  list.put([
    // decisions made on a request that was itself made on this PC are applied to its row too
    ...fresh
      .map((r) => {
        const mark = marks.get(Number(r.id));
        return mark ? { ...r, ...mark.view, ...(mark.rejected ? { status: "Rejected" } : {}) } : r;
      })
      .filter((r) => !wantStatus || r.status === wantStatus),
    ...list.rows
      .map((r) => {
        const mark = marks.get(Number(r.id));
        return mark ? { ...r, ...mark.view, syncPending: true, ...(mark.rejected ? { status: "Rejected" } : {}) } : r;
      })
      // a request this PC has decided no longer belongs in the list of pending ones
      .filter((r) => !wantStatus || r.status === wantStatus),
  ]);
  return JSON.stringify(env);
}

type Movement = { packetId: number; toStatus: string; lockerId?: number; remarks?: string; at: string };

async function movements(): Promise<Movement[]> {
  const out: Movement[] = [];
  for (const e of await waiting()) {
    const m = /^\/packets\/(\d+)\/movements$/.exec(e.path);
    if (!m || e.method !== "POST") continue;
    const b = (e.body ?? {}) as { toStatus?: string; lockerId?: number; remarks?: string };
    if (b.toStatus) out.push({ packetId: Number(m[1]), toStatus: b.toStatus, lockerId: b.lockerId, remarks: b.remarks, at: e.occurredAt });
  }
  return out;
}

function moved(p: Record<string, unknown>, list: Movement[]): Record<string, unknown> {
  let next = p;
  for (const mv of list) {
    if (Number(p.id) !== mv.packetId) continue;
    next = { ...next, status: mv.toStatus, currentLockerId: mv.lockerId ?? (mv.toStatus === "Locker Stored" ? next.currentLockerId ?? null : null) };
  }
  return next;
}

/* GET /packets..., /packets/ID, /packets/by-code/CODE: the packet shows where it has been moved to. */
export async function adjustPackets(body: string): Promise<string> {
  const env = parse(body);
  if (!env) return body;
  const list = await movements();
  if (!list.length) return body;
  const rows = rowsOf(env);
  if (rows) rows.put(rows.rows.map((p) => moved(p, list)));
  else if (env.data && typeof env.data === "object" && !Array.isArray(env.data)) env.data = moved(env.data as Record<string, unknown>, list);
  else return body;
  return JSON.stringify(env);
}

/* GET /packets/ID/movements: a row for each movement waiting to be sent. */
export async function adjustMovements(path: string, body: string): Promise<string> {
  const id = Number(/\/packets\/(\d+)\/movements/.exec(path)?.[1]);
  const env = parse(body);
  if (!env || !Array.isArray(env.data) || !id) return body;
  const mine = (await movements()).filter((m) => m.packetId === id);
  if (!mine.length) return body;
  let last = (env.data as { toStatus?: string }[]).at(-1)?.toStatus ?? "";
  const extra = mine.map((m) => {
    const row = { id: 0, packetId: id, fromStatus: last, toStatus: m.toStatus, lockerId: m.lockerId ?? null, actorEmployeeId: 0, remarks: m.remarks ?? "", createdAt: m.at };
    last = m.toStatus;
    return row;
  });
  env.data = [...(env.data as unknown[]), ...extra];
  return JSON.stringify(env);
}
