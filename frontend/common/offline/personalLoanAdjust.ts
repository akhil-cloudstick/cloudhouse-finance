/* Personal loans made on this PC that the server has not been sent yet. The personal loan list the screen shows is the
 * server's last answer, which cannot know about them, so each waiting "create personal loan" entry is added to that answer
 * as a PENDING row, in the same shape the server will use once it is sent. When it has been sent the server's own answer
 * includes the loan and it is no longer in the outbox, so nothing is shown twice. */

import { offlineStore } from "@/common/services/desktopBridge";
import { localRequestId } from "./requestRef";
import type { OutboxEntry } from "./types";

type Body = {
  branchId?: number;
  customerId?: number | string;
  principalAmount?: number;
  interestType?: string;
  interestValue?: number;
  frequency?: string;
  tenureCount?: number;
  fullDisbursement?: boolean;
  penalInterestRate?: number;
  gracePeriodDays?: number;
};
type View = { customerName?: string; customerCode?: string; status?: string };

const round2 = (n: number) => Math.round(n * 100) / 100;

async function waiting(): Promise<{ entry: OutboxEntry; body: Body; view: View }[]> {
  const found: { entry: OutboxEntry; body: Body; view: View }[] = [];
  for (const line of await offlineStore.readAllOutbox().catch(() => [] as string[])) {
    try {
      const entry = JSON.parse(line) as OutboxEntry;
      if (entry.method === "POST" && entry.path === "/personal-loans") found.push({ entry, body: (entry.body ?? {}) as Body, view: (entry.view ?? {}) as View });
    } catch {
      /* a line that cannot be read adds nothing */
    }
  }
  return found;
}

/* The row the server will make for a waiting entry. */
export function pendingPersonalLoanRow(entry: OutboxEntry, b: Body, v: View): Record<string, unknown> {
  const principal = Number(b.principalAmount) || 0;
  const value = Number(b.interestValue) || 0;
  const interest = round2(b.interestType === "Percentage" ? (principal * value) / 100 : value);
  const obligation = b.fullDisbursement ? round2(principal + interest) : principal;
  const tenure = Number(b.tenureCount) || 0;
  return {
    id: localRequestId(entry.id),
    loanNumber: "Pending",
    branchId: b.branchId ?? null,
    customerId: 0,
    customer: { id: 0, name: v.customerName ?? "—", code: v.customerCode ?? "", phone: "" },
    principalAmount: principal,
    interestType: b.interestType,
    interestValue: value,
    interestAmount: interest,
    disbursedAmount: b.fullDisbursement ? principal : round2(principal - interest),
    fullDisbursement: !!b.fullDisbursement,
    frequency: b.frequency,
    tenureCount: tenure,
    installmentAmount: tenure > 0 ? round2(obligation / tenure) : 0,
    outstandingAmount: obligation,
    totalPaid: 0,
    status: v.status ?? "Active",
    approvalStage: "",
    openedDate: entry.occurredAt.slice(0, 10),
    disbursedAt: entry.occurredAt,
    closedAt: null,
    renewedFromLoanId: null,
    renewedToLoanId: null,
    penalInterestRate: b.penalInterestRate ?? 0,
    penalFlatAmount: 0,
    gracePeriodDays: b.gracePeriodDays ?? 0,
    penalCycleCount: 0,
    totalPenalInterestCharged: 0,
    lastPenalAppliedAt: null,
    createdAt: entry.occurredAt,
    syncPending: true,
  };
}

/* GET /personal-loans...: a row for each waiting loan, on the first page, narrowed by the same search, status and
 * frequency the screen asked for. */
export async function adjustPersonalLoans(path: string, kept: string | null): Promise<string | null> {
  // with nothing kept from the server (the page was never opened online) the waiting loans are still listed
  const body = kept ?? JSON.stringify({ success: true, data: { items: [], hasMore: false, total: 0 } });
  const qs = new URLSearchParams(path.includes("?") ? path.slice(path.indexOf("?") + 1) : "");
  if ((Number(qs.get("offset") ?? "0") || 0) > 0) return kept;
  // a list for one customer is for a customer the server numbers; a waiting loan is not listed there
  if (qs.get("customerId") || qs.get("customer_id")) return kept;
  let env: { data?: unknown; [k: string]: unknown };
  try {
    env = JSON.parse(body) as typeof env;
  } catch {
    return kept;
  }
  const q = (qs.get("q") ?? "").trim().toLowerCase();
  const csv = (k: string) => (qs.get(k) ?? "").split(",").map((s) => s.trim().toLowerCase()).filter(Boolean);
  const statuses = csv("status");
  const frequencies = csv("frequency");
  const rows = (await waiting())
    .map(({ entry, body: b, view }) => pendingPersonalLoanRow(entry, b, view))
    .filter((r) => {
      const customer = r.customer as { name: string; code: string };
      return (!q || `${r.loanNumber} ${customer.name} ${customer.code}`.toLowerCase().includes(q)) &&
        (!statuses.length || statuses.includes(String(r.status).toLowerCase())) &&
        (!frequencies.length || frequencies.includes(String(r.frequency).toLowerCase()));
    })
    .reverse();
  if (!rows.length) return kept;
  const d = env.data as { items?: unknown[]; hasMore?: boolean; total?: number } | undefined;
  if (Array.isArray(env.data)) return JSON.stringify({ ...env, data: [...rows, ...env.data] });
  if (!d || !Array.isArray(d.items)) return kept;
  const limit = Number(qs.get("limit") ?? "0") || d.items.length + rows.length;
  const total = (d.total ?? d.items.length) + rows.length;
  return JSON.stringify({ ...env, data: { ...d, items: [...rows, ...d.items].slice(0, limit), total, hasMore: total > limit } });
}

/* ---- payments collected on this PC and not sent yet ------------------------------------------------------------------
 * The personal loan screens (the loan, its ledger, the list) show the server's last answer, which cannot know about a
 * payment still waiting in the outbox. Each waiting "record payment" entry is applied to those answers here, in the shape
 * the server will use once it is sent. Once it has been sent the server's own answer includes it and it is no longer in
 * the outbox, so nothing is counted twice. A waiting payment is listed under a local (negative) id. */

type PayBody = { amount?: number; cashAmount?: number; upiAmount?: number; bankTransferAmount?: number; chequeAmount?: number; bankId?: number; reference?: string; description?: string };
export type WaitingPayment = { entry: OutboxEntry; loanId: number; body: PayBody; localId: number };

export async function waitingPersonalPayments(loanId?: number): Promise<WaitingPayment[]> {
  const found: WaitingPayment[] = [];
  for (const line of await offlineStore.readAllOutbox().catch(() => [] as string[])) {
    try {
      const entry = JSON.parse(line) as OutboxEntry;
      const m = /^\/personal-loans\/(\d+)\/payments$/.exec(entry.path.split("?")[0]);
      if (entry.method !== "POST" || !m) continue;
      if (loanId !== undefined && Number(m[1]) !== loanId) continue;
      found.push({ entry, loanId: Number(m[1]), body: (entry.body ?? {}) as PayBody, localId: localRequestId(entry.id) });
    } catch {
      /* a line that cannot be read adds nothing */
    }
  }
  return found;
}

const amountOf = (b: PayBody) => Number(b.amount) || (Number(b.cashAmount) || 0) + (Number(b.upiAmount) || 0) + (Number(b.bankTransferAmount) || 0) + (Number(b.chequeAmount) || 0);

/* GET /personal-loans/:id — the loan with the waiting payments taken off what is owed. */
type Installment = { sequenceNo?: number; dueDate?: string; amount?: number; paidAmount?: number; status?: string };

/* A payment is allocated to the installments in order, as the server does: each unpaid one is filled up to its amount and is
 * "Paid" once full, "PartiallyPaid" before that. */
function allocate(items: Installment[], paid: number): Installment[] {
  const sorted = [...items].sort((a, b) => (a.sequenceNo ?? 0) - (b.sequenceNo ?? 0));
  let left = paid;
  return sorted.map((i) => {
    if (left <= 0.005 || i.status === "Paid") return i;
    const room = round2((Number(i.amount) || 0) - (Number(i.paidAmount) || 0));
    if (room <= 0.005) return i;
    const credit = Math.min(left, room);
    left = round2(left - credit);
    const paidAmount = round2((Number(i.paidAmount) || 0) + credit);
    return { ...i, paidAmount, status: paidAmount >= (Number(i.amount) || 0) - 0.005 ? "Paid" : "PartiallyPaid" };
  });
}

const rowsOfSchedule = (body: string | null): Installment[] | null => {
  if (!body) return null;
  try {
    const d = (JSON.parse(body) as { data?: unknown }).data;
    const items = Array.isArray(d) ? d : (d as { items?: unknown } | undefined)?.items;
    return Array.isArray(items) ? (items as Installment[]) : null;
  } catch {
    return null;
  }
};

/* GET /personal-loans/:id — the loan with the waiting payments taken off what is owed. `schedule` is this PC's copy of the
 * loan's schedule (when it has one): the server moves a loan that was "Pending" back to "Active" when it is not past its
 * grace period any more, and closes it when nothing is owed. */
export async function adjustPersonalLoanDetail(path: string, body: string, schedule: string | null = null): Promise<string> {
  const m = /\/personal-loans\/(\d+)(\?|$)/.exec(path);
  if (!m) return body;
  const waiting = await waitingPersonalPayments(Number(m[1]));
  if (!waiting.length) return body;
  try {
    const env = JSON.parse(body) as { data?: Record<string, unknown> };
    const loan = env.data;
    if (!loan || typeof loan !== "object") return body;
    const paid = round2(waiting.reduce((s, w) => s + amountOf(w.body), 0));
    const outstanding = round2(Math.max(0, (Number(loan.outstandingAmount) || 0) - paid));
    let status = String(loan.status ?? "");
    if (outstanding <= 0) status = "Closed";
    else if (status === "Pending") {
      const items = rowsOfSchedule(schedule);
      if (items) {
        const grace = (Number(loan.gracePeriodDays) || 0) * 86_400_000;
        const pastGrace = allocate(items, paid).some((i) => i.status !== "Paid" && i.dueDate && new Date(i.dueDate).getTime() + grace < Date.now());
        status = pastGrace ? "Pending" : "Active";
      }
    }
    env.data = { ...loan, outstandingAmount: outstanding, totalPaid: round2((Number(loan.totalPaid) || 0) + paid), status, closedAt: outstanding <= 0 ? new Date().toISOString() : loan.closedAt, syncPending: true };
    return JSON.stringify(env);
  } catch {
    return body;
  }
}

/* GET /personal-loans/:id/schedule — the installments with the waiting payments allocated to them. */
export async function adjustPersonalLoanSchedule(path: string, body: string): Promise<string> {
  const m = /\/personal-loans\/(\d+)\/schedule(\?|$)/.exec(path);
  if (!m) return body;
  const waiting = await waitingPersonalPayments(Number(m[1]));
  if (!waiting.length) return body;
  try {
    const env = JSON.parse(body) as { data?: unknown };
    const paid = round2(waiting.reduce((s, w) => s + amountOf(w.body), 0));
    const d = env.data;
    if (Array.isArray(d)) env.data = allocate(d as Installment[], paid);
    else if (d && Array.isArray((d as { items?: unknown }).items)) env.data = { ...(d as object), items: allocate((d as { items: Installment[] }).items, paid) };
    else return body;
    return JSON.stringify(env);
  } catch {
    return body;
  }
}

/* GET /personal-loans/:id/payments — the loan's ledger with a row for each mode of each waiting payment, newest first. */
export async function adjustPersonalLoanPayments(path: string, body: string): Promise<string> {
  const m = /\/personal-loans\/(\d+)\/payments(\?|$)/.exec(path);
  if (!m) return body;
  const waiting = await waitingPersonalPayments(Number(m[1]));
  if (!waiting.length) return body;
  const qs = new URLSearchParams(path.includes("?") ? path.slice(path.indexOf("?") + 1) : "");
  // only the first page lists them, and only when the newest comes first (as the loan page asks)
  if ((Number(qs.get("offset") ?? "0") || 0) > 0 || qs.get("order") !== "desc") return body;
  try {
    const env = JSON.parse(body) as { data?: { items?: Record<string, unknown>[]; total?: number; totalCredit?: number; hasMore?: boolean } };
    const d = env.data;
    if (!d || !Array.isArray(d.items)) return body;
    const rows: Record<string, unknown>[] = [];
    let credit = 0;
    // what is still owed after each waiting payment, counted from the newest row the server knows about
    const after = new Map<string, number>();
    let running = Number(d.items[0]?.balance);
    for (const w of waiting) {
      running = Number.isFinite(running) ? round2(Math.max(0, running - amountOf(w.body))) : 0;
      after.set(w.entry.id, running);
    }
    for (const w of [...waiting].reverse()) {
      const modes: [string, number][] = ([["Cash", w.body.cashAmount], ["UPI", w.body.upiAmount], ["Bank Transfer", w.body.bankTransferAmount], ["Cheque", w.body.chequeAmount]] as [string, number | undefined][])
        .filter((x): x is [string, number] => (Number(x[1]) || 0) > 0);
      const parts = modes.length ? modes : ([["Cash", amountOf(w.body)]] as [string, number][]);
      const date = w.entry.occurredAt.slice(0, 10);
      parts.forEach(([mode, amount], index) => {
        credit += amount;
        rows.push({
          id: w.localId, personalLoanId: w.loanId, amount, paidOn: date, method: parts.length > 1 ? "Split" : mode,
          cashAmount: mode === "Cash" ? amount : 0, upiAmount: mode === "UPI" ? amount : 0, bankTransferAmount: mode === "Bank Transfer" ? amount : 0, chequeAmount: mode === "Cheque" ? amount : 0,
          reference: w.body.reference ?? "", description: w.body.description ?? "", runningBalance: after.get(w.entry.id) ?? 0, installmentId: null, bankId: w.body.bankId ?? null, createdAt: w.entry.occurredAt,
          key: `pending-${w.entry.id}-${index}`, kind: "payment", date, refNo: "", particulars: "Payment received (waiting to be sent)", mode,
          debit: 0, credit: amount, balance: after.get(w.entry.id) ?? 0, part: { mode, amount, index, count: parts.length }, syncPending: true,
        });
      });
    }
    d.items = [...rows, ...d.items];
    d.total = (d.total ?? d.items.length) + rows.length;
    d.totalCredit = round2((Number(d.totalCredit) || 0) + credit);
    return JSON.stringify(env);
  } catch {
    return body;
  }
}

/* In a list of personal loans (GET /personal-loans...), what is still owed on each loan with a payment waiting. */
export async function adjustPersonalLoanListPayments(body: string): Promise<string> {
  const waiting = await waitingPersonalPayments();
  if (!waiting.length) return body;
  try {
    const env = JSON.parse(body) as { data?: unknown };
    const take = (rows: Record<string, unknown>[]) =>
      rows.map((r) => {
        const mine = waiting.filter((w) => w.loanId === Number(r.id));
        if (!mine.length) return r;
        const paid = round2(mine.reduce((s, w) => s + amountOf(w.body), 0));
        return { ...r, outstandingAmount: round2(Math.max(0, (Number(r.outstandingAmount) || 0) - paid)), totalPaid: round2((Number(r.totalPaid) || 0) + paid) };
      });
    const d = env.data as { items?: Record<string, unknown>[] } | Record<string, unknown>[] | undefined;
    if (Array.isArray(d)) env.data = take(d);
    else if (d && Array.isArray(d.items)) env.data = { ...d, items: take(d.items) };
    else return body;
    return JSON.stringify(env);
  } catch {
    return body;
  }
}
