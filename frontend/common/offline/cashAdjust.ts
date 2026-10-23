/* Cash while the server does not answer. The cash figures and the cash ledger the screens show are the server's
 * last answer, which cannot know about a disbursal or a payment taken on this PC since. This adds the entries still
 * waiting in the outbox to that answer: cash in hand and the bank balance move, and the ledger lists a row for each
 * payment mode used, the same as it will once the entry is sent. When an entry has been sent the server's own
 * figures and rows include it and it is no longer in the outbox, so nothing is counted twice.
 *
 * Only entries that move money count: the final approval of a loan (its payout amounts) and a payment. Creating a
 * loan, or an approval stage that is not the last one, does not touch cash. */

import { offlineStore } from "@/common/services/desktopBridge";
import { getLocal } from "./localCopy";
import type { OutboxEntry } from "./types";

const MOVES_MONEY = /^\/loans\/uuid:([0-9a-f-]+)\/(approve|payments)$/i;
const CASH_ENTRY = /^\/(cash-movements|expenses)$/;

const round2 = (n: number) => Math.round(n * 100) / 100;

function today(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

function queryOf(path: string): URLSearchParams {
  return new URLSearchParams(path.includes("?") ? path.slice(path.indexOf("?") + 1) : "");
}

type Part = { mode: string; amount: number; bankId?: number };
type Pending = {
  entry: OutboxEntry;
  out: boolean; // a disbursal (money out) as opposed to a payment (money in)
  parts: Part[];
  loanNumber: string;
  branchId: number | null;
  customerId: number | null;
  label?: string;
};

/* The waiting entries that move money, newest first. */
async function pendingMoney(branch: number): Promise<Pending[]> {
  const found: Pending[] = [];
  for (const line of await offlineStore.readAllOutbox().catch(() => [] as string[])) {
    let entry: OutboxEntry;
    try {
      entry = JSON.parse(line) as OutboxEntry;
    } catch {
      continue;
    }
    // cash added or paid out by hand (Add Cash)
    if (entry.method === "POST" && CASH_ENTRY.test(entry.path)) {
      const isExpense = entry.path === "/expenses";
      const cb = (entry.body ?? {}) as { type?: string; source?: string; purpose?: string; category?: string; amount?: number; mode?: string; bankId?: number; fromBankId?: number; branchId?: number; payments?: { mode: string; amount: number; bankId?: number }[] };
      const cparts: Part[] = (cb.payments?.length ? cb.payments : [{ mode: cb.mode ?? "Cash", amount: Number(cb.amount) || 0, bankId: cb.bankId ?? cb.fromBankId }])
        .map((p) => ({ mode: p.mode || "Cash", amount: Number(p.amount) || 0, bankId: p.bankId }))
        .filter((p) => p.amount > 0);
      if (!cparts.length || (branch && cb.branchId && Number(cb.branchId) !== branch)) continue;
      const label = isExpense ? `Expense — ${cb.category ?? ""}`.trim() : cb.source || cb.purpose || "Cash entry";
      found.push({ entry, out: isExpense || cb.type === "out", parts: cparts, loanNumber: label, branchId: cb.branchId ?? null, customerId: null, label });
      continue;
    }
    const m = MOVES_MONEY.exec(entry.path);
    if (!m) continue;
    const b = (entry.body ?? {}) as Record<string, unknown>;
    const bankId = Number(b.bankId) || undefined;
    const parts: Part[] = [
      { mode: "Cash", amount: Number(b.cashAmount) || 0 },
      { mode: "UPI", amount: Number(b.upiAmount) || 0, bankId },
      { mode: "Bank Transfer", amount: Number(b.bankTransferAmount) || 0, bankId },
      { mode: "Cheque", amount: Number(b.chequeAmount) || 0, bankId },
    ].filter((p) => p.amount > 0);
    if (!parts.length) continue; // an approval stage that is not the payout, or a payment with no amounts
    const out = m[2].toLowerCase() === "approve";
    if (out && b.action === "Rejected") continue;
    const loan = getLocal("loans", m[1]) as { branchId?: number; customerId?: number; loanNumber?: string } | undefined;
    if (branch && loan && Number(loan.branchId) !== branch) continue;
    found.push({
      entry,
      out,
      parts,
      loanNumber: loan?.loanNumber || `PENDING-${m[1].replace(/-/g, "").slice(-8).toUpperCase()}`,
      branchId: loan?.branchId ?? null,
      customerId: loan?.customerId || null,
    });
  }
  return found.reverse();
}

type Summary = {
  cashInHand: number;
  bankBalance: number;
  disbursements?: number;
  collections?: number;
  expectedCash?: number;
};

/* The cash summary: cash in hand, bank balance, and the day's collections and disbursements. */
export async function adjustCashSummary(path: string, body: string): Promise<string> {
  const qs = queryOf(path);
  const date = qs.get("date");
  // a past day's figures do not change with what is entered now
  if (date && date !== today()) return body;
  const branch = Number(qs.get("branch_id") ?? qs.get("branchId") ?? "0") || 0;

  let env: { data?: Summary };
  try {
    env = JSON.parse(body) as { data?: Summary };
  } catch {
    return body;
  }
  const sum = env.data;
  if (!sum || typeof sum.cashInHand !== "number" || typeof sum.bankBalance !== "number") return body;

  let cash = 0;
  let bank = 0;
  let out = 0;
  let inn = 0;
  for (const p of await pendingMoney(branch)) {
    const total = p.parts.reduce((s, x) => s + x.amount, 0);
    const c = p.parts.filter((x) => x.mode === "Cash").reduce((s, x) => s + x.amount, 0);
    const sign = p.out ? -1 : 1;
    cash += sign * c;
    bank += sign * (total - c);
    if (p.out) out += total;
    else inn += total;
  }
  if (!cash && !bank) return body;

  sum.cashInHand = round2(sum.cashInHand + cash);
  sum.bankBalance = round2(sum.bankBalance + bank);
  if (typeof sum.disbursements === "number") sum.disbursements = round2(sum.disbursements + out);
  if (typeof sum.collections === "number") sum.collections = round2(sum.collections + inn);
  if (typeof sum.expectedCash === "number") sum.expectedCash = round2(sum.expectedCash + cash);
  return JSON.stringify(env);
}

/* The bank list: each account's balance moves with the queued entries that went through it. */
export async function adjustBanks(body: string): Promise<string> {
  let env: { data?: unknown };
  try {
    env = JSON.parse(body) as { data?: unknown };
  } catch {
    return body;
  }
  const pending = await pendingMoney(0);
  if (!pending.length) return body;
  const delta = new Map<number, number>();
  for (const p of pending) {
    for (const part of p.parts) {
      if (part.mode === "Cash" || !part.bankId) continue;
      delta.set(part.bankId, (delta.get(part.bankId) ?? 0) + (p.out ? -part.amount : part.amount));
    }
  }
  if (!delta.size) return body;
  const data = env.data as { items?: { id: number; balance?: number }[]; totalBalance?: number } | { id: number; balance?: number }[] | undefined;
  const rows = Array.isArray(data) ? data : data?.items;
  if (!Array.isArray(rows)) return body;
  let moved = 0;
  for (const r of rows) {
    const d = delta.get(r.id);
    if (d && typeof r.balance === "number") {
      r.balance = round2(r.balance + d);
      moved += d;
    }
  }
  if (!Array.isArray(data) && data && typeof data.totalBalance === "number") data.totalBalance = round2(data.totalBalance + moved);
  return JSON.stringify(env);
}

type Row = Record<string, unknown>;

function movementRows(pending: Pending[]): Row[] {
  const rows: Row[] = [];
  let n = 0;
  for (const p of pending) {
    for (const part of p.parts) {
      n += 1;
      rows.push({
        id: -n, // not on the server yet; never clashes with a real id
        type: p.out ? "out" : "in",
        ...(p.out ? {} : { source: "Collection" }),
        purpose: p.label ?? (p.out ? `Loan disbursement — ${p.loanNumber}` : `${(p.entry.body as { type?: string } | undefined)?.type ?? "Payment"} — ${p.loanNumber}`),
        mode: part.mode,
        bankId: part.bankId ?? null,
        amount: part.amount,
        status: "",
        branchId: p.branchId,
        occurredOn: p.entry.occurredAt,
        createdAt: p.entry.occurredAt,
        transactionGroupId: `offline-${p.entry.id}`,
        partyCustomerId: p.customerId,
      });
    }
  }
  return rows;
}

/* The cash ledger (Cash page, dashboard): the waiting entries are listed at the top, newest first, with the balance
 * carried on from them. Only the first page of an unfiltered list is changed; with a filter on, the server's own
 * view is shown as it was. */
export async function adjustCashMovements(path: string, body: string): Promise<string> {
  const qs = queryOf(path);
  for (const filter of ["types", "modes", "category", "customer_ids", "customerIds", "branch_ids", "branchIds", "from_date", "fromDate", "to_date", "toDate", "search"]) {
    if (qs.get(filter)) return body;
  }
  const page = Number(qs.get("page") ?? "1") || 1;
  if (page > 1) return body;
  const branch = Number(qs.get("branch_id") ?? qs.get("branchId") ?? "0") || 0;

  let env: { data?: unknown };
  try {
    env = JSON.parse(body) as { data?: unknown };
  } catch {
    return body;
  }
  const rows = movementRows(await pendingMoney(branch));
  if (!rows.length) return body;

  const data = env.data;
  // an unpaged list (the dashboard's) is just an array
  if (Array.isArray(data)) {
    env.data = [...rows, ...data];
    return JSON.stringify(env);
  }
  const d = data as { items?: Row[]; hasMore?: boolean; total?: number; totalDebit?: number; totalCredit?: number; pageBalance?: number; rowBalances?: number[]; row_balances?: number[] } | undefined;
  if (!d || !Array.isArray(d.items)) return body;
  // a ledger that keeps one balance per row (a filtered view) is left as the server gave it
  if (d.rowBalances || d.row_balances) return body;

  const limit = Number(qs.get("limit") ?? "0") || d.items.length + rows.length;
  const outTotal = rows.filter((r) => r.type === "out").reduce((s, r) => s + Number(r.amount), 0);
  const inTotal = rows.filter((r) => r.type === "in").reduce((s, r) => s + Number(r.amount), 0);
  d.items = [...rows, ...d.items].slice(0, limit);
  d.total = (d.total ?? 0) + rows.length;
  d.hasMore = d.total > limit;
  if (typeof d.totalDebit === "number") d.totalDebit = round2(d.totalDebit + outTotal);
  if (typeof d.totalCredit === "number") d.totalCredit = round2(d.totalCredit + inTotal);
  if (typeof d.pageBalance === "number") d.pageBalance = round2(d.pageBalance + inTotal - outTotal);
  return JSON.stringify(env);
}
