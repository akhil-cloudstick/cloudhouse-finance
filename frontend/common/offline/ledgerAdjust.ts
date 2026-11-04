/* The ledgers and the Cash page's Expenses and Gold Sales tables while the server does not answer. Like cashAdjust.ts, this adds
 * the entries still waiting in the outbox to the server's last answer: an expense, a cash-in, a self transfer and a gold sale
 * made on this PC show at the top of every ledger they belong to (Cash, UPI / Bank Transfer / Cheque, a bank's, an expense
 * category's) with the balance carried on from them, and in the two tables. Once an entry has been sent the server's own rows
 * include it and it is no longer in the outbox, so nothing is shown twice.
 *
 * Only the first page of a list that is not narrowed to one transaction is changed, as in cashAdjust.ts. */

import { offlineStore } from "@/common/services/desktopBridge";
import { movementRows, pendingMoney, purposeOf, queryOf, round2, whenOf, type Pending } from "./cashAdjust";
import { listLocal } from "./localCopy";
import type { OutboxEntry } from "./types";

const CASH_LEDGER = /\/cash-movements\/cash-ledger(\?|$)/;
const MODE_LEDGER = /\/cash-movements\/mode-ledger(\?|$)/;
const BANK_LEDGER = /\/banks\/(\d+)\/ledger(\?|$)/;
const CATEGORY_LEDGER = /\/expense-categories\/(-?\d+)\/ledger(\?|$)/;
export const LEDGER_PATH = /\/(cash-movements\/(cash|mode)-ledger|banks\/\d+\/ledger|expense-categories\/-?\d+\/ledger)(\?|$)/;

type Row = Record<string, unknown>;
type Page = { items?: Row[]; hasMore?: boolean; limit?: number; offset?: number; total?: number; totalDebit?: number; totalCredit?: number; categoryName?: string; [k: string]: unknown };
type Env = { success?: boolean; data?: unknown; [k: string]: unknown };

const csv = (qs: URLSearchParams, ...keys: string[]) => (keys.map((k) => qs.get(k)).find((v) => v) ?? "").split(",").map((s) => s.trim()).filter(Boolean);

/* A list that is not the first page, or is narrowed to one transaction or a search, is left as the server gave it. */
function leftAlone(qs: URLSearchParams): boolean {
  if (qs.get("focus_amount") || qs.get("focusAmount") || qs.get("q") || qs.get("search") || qs.get("types")) return true;
  return (Number(qs.get("page") ?? "1") || 1) > 1 || (Number(qs.get("offset") ?? "0") || 0) > 0;
}

function inBranch(p: { branchId: number | null }, ids: number[]): boolean {
  return !ids.length || p.branchId == null || ids.includes(p.branchId);
}

function inDates(p: Pending, qs: URLSearchParams): boolean {
  const from = qs.get("from_date") ?? qs.get("fromDate") ?? "";
  const to = qs.get("to_date") ?? qs.get("toDate") ?? "";
  const day = whenOf(p).slice(0, 10);
  return (!from || day >= from) && (!to || day <= to);
}

function typeOf(p: Pending): string {
  if (p.expense) return p.category ?? "";
  if (p.source) return p.source;
  // a loan disbursal or payment is "Loan" / "Collection"; the other labelled entries (a top-up apart) have no source of their own
  return p.label && !/^Loan top-up/.test(p.label) ? "" : p.out ? "Loan" : "Collection";
}

function ledgerRow(p: Pending, n: number, method: string, amount: number, bankId?: number, bankName?: string): Row {
  return {
    id: -n, // not on the server yet; never clashes with a real id
    date: whenOf(p),
    description: p.expense ? `${p.category ?? ""}${p.remarks ? ` — ${p.remarks}` : ""}` : purposeOf(p),
    type: typeOf(p),
    method,
    reference: p.label ? purposeOf(p) : p.loanNumber,
    debitOrCredit: p.out ? "debit" : "credit",
    amount,
    runningBalance: 0,
    bankId: bankId ?? null,
    bankName: bankName ?? "",
    customerId: p.customerId ?? 0,
    customerName: "",
  };
}

/* The rows the waiting entries add to this ledger, newest first. */
function rowsFor(path: string, qs: URLSearchParams, pending: Pending[], categoryName: string): Row[] {
  const branches = csv(qs, "branch_ids", "branchIds", "branch_id", "branchId").map(Number);
  const modes = csv(qs, "modes").map((m) => m.toLowerCase());
  const bankFilter = Number(qs.get("bank_id") ?? qs.get("bankId") ?? "0") || 0;
  const bank = BANK_LEDGER.exec(path);
  const mode = MODE_LEDGER.test(path) ? (qs.get("mode") ?? "") : CASH_LEDGER.test(path) ? "Cash" : "";
  const rows: Row[] = [];
  let n = 0;
  for (const p of pending) {
    if (!inBranch(p, branches) || !inDates(p, qs)) continue;
    if (CATEGORY_LEDGER.test(path)) {
      // one row per expense, as the server lists it
      if (!p.expense || (p.category ?? "").trim().toLowerCase() !== categoryName.trim().toLowerCase()) continue;
      n += 1;
      const total = p.parts.reduce((s, x) => s + x.amount, 0);
      rows.push(ledgerRow(p, n, p.parts.map((x) => x.mode).join(" + "), total));
      continue;
    }
    for (const part of p.parts) {
      n += 1;
      if (bank) {
        if (part.bankId !== Number(bank[1]) || (modes.length && !modes.includes(part.mode.toLowerCase()))) continue;
      } else if (part.mode.toLowerCase() !== mode.toLowerCase() || (bankFilter && part.bankId !== bankFilter)) continue;
      rows.push(ledgerRow(p, n, part.mode, part.amount, part.bankId, part.bankName));
    }
  }
  return rows;
}

/* The name of a category made on this PC and not sent yet (its id is a local, negative one). */
function localCategoryName(id: number): string {
  const found = (listLocal("categories") as unknown as { id?: number; name?: string }[]).find((c) => c.id === id);
  return found?.name ?? "";
}

/* `body` is the last answer kept for this ledger, or null when none was. A category made on this PC has no answer on the
 * server at all, so its ledger is built from the waiting entries alone; any other ledger that was never kept stays unavailable. */
export async function adjustLedger(path: string, body: string | null): Promise<string | null> {
  const qs = queryOf(path);
  let env: Env | null = null;
  if (body !== null) {
    try {
      env = JSON.parse(body) as Env;
    } catch {
      return body;
    }
  }
  if (leftAlone(qs)) return body;

  const categoryId = CATEGORY_LEDGER.exec(path)?.[1];
  const known = !Array.isArray(env?.data) && env?.data && typeof env.data === "object" ? (env.data as Page) : null;
  const categoryName = categoryId ? (known?.categoryName || (Number(categoryId) < 0 ? localCategoryName(Number(categoryId)) : "")) : "";
  if (env === null && !(categoryId && Number(categoryId) < 0 && categoryName)) return null;
  if (categoryId && !categoryName) return body;

  const rows = rowsFor(path, qs, await pendingMoney(0), categoryName);
  if (env === null) {
    // nothing on the server for it: the page is just the waiting rows
    env = { success: true, data: { items: [], total: 0, totalDebit: 0, totalCredit: 0, categoryName } };
  }
  if (!rows.length) return body ?? JSON.stringify(env);

  const data = env.data;
  const items = (Array.isArray(data) ? data : (data as Page | undefined)?.items) as Row[] | undefined;
  if (!Array.isArray(items)) return body;

  // each row's balance is the one after it: the newest server row's balance, moved on by every waiting row up to and including it
  let balance = Number(items[0]?.runningBalance) || 0;
  for (let i = rows.length - 1; i >= 0; i--) {
    balance += (rows[i].debitOrCredit === "debit" ? -1 : 1) * Number(rows[i].amount);
    rows[i].runningBalance = round2(balance);
  }
  if (Array.isArray(data)) {
    env.data = [...rows, ...data];
    return JSON.stringify(env);
  }
  const page = data as Page;
  const limit = Number(qs.get("limit") ?? "0") || 0;
  const debit = rows.filter((r) => r.debitOrCredit === "debit").reduce((s, r) => s + Number(r.amount), 0);
  const credit = rows.filter((r) => r.debitOrCredit === "credit").reduce((s, r) => s + Number(r.amount), 0);
  page.items = limit > 0 ? [...rows, ...items].slice(0, limit) : [...rows, ...items];
  page.total = (page.total ?? items.length) + rows.length;
  if (limit > 0) page.hasMore = page.total > limit;
  page.totalDebit = round2((page.totalDebit ?? 0) + debit);
  page.totalCredit = round2((page.totalCredit ?? 0) + credit);
  return JSON.stringify(env);
}

/* ---- the Cash page's Expenses and Gold Sales tables ---- */

async function waiting(match: (e: OutboxEntry) => boolean): Promise<OutboxEntry[]> {
  const found: OutboxEntry[] = [];
  for (const line of await offlineStore.readAllOutbox().catch(() => [] as string[])) {
    try {
      const e = JSON.parse(line) as OutboxEntry;
      if (e.method === "POST" && match(e)) found.push(e);
    } catch {
      /* a line that cannot be read adds nothing */
    }
  }
  return found.reverse();
}

function mergeTable(path: string, body: string, rows: Row[], totals: Record<string, number>): string {
  if (!rows.length) return body;
  const qs = queryOf(path);
  if (leftAlone(qs)) return body;
  let env: Env;
  try {
    env = JSON.parse(body) as Env;
  } catch {
    return body;
  }
  const data = env.data;
  const items = (Array.isArray(data) ? data : (data as Page | undefined)?.items) as Row[] | undefined;
  if (!Array.isArray(items)) return body;
  if (Array.isArray(data)) {
    env.data = [...rows, ...data];
    return JSON.stringify(env);
  }
  const page = data as Page;
  const limit = Number(qs.get("limit") ?? "0") || 0;
  page.items = limit > 0 ? [...rows, ...items].slice(0, limit) : [...rows, ...items];
  page.total = (page.total ?? items.length) + rows.length;
  if (limit > 0) page.hasMore = page.total > limit;
  for (const [key, add] of Object.entries(totals)) if (typeof page[key] === "number") page[key] = round2((page[key] as number) + add);
  return JSON.stringify(env);
}

/* The Expenses table: expenses made on this PC and not sent yet are listed first. */
export async function adjustExpenses(path: string, body: string): Promise<string> {
  const branches = csv(queryOf(path), "branch_ids", "branchIds", "branch_id", "branchId").map(Number);
  const rows: Row[] = [];
  let sum = 0;
  let n = 0;
  for (const p of await pendingMoney(0)) {
    if (!p.expense || !inBranch(p, branches)) continue;
    n += 1;
    const total = p.parts.reduce((s, x) => s + x.amount, 0);
    const b = (p.entry.body ?? {}) as { payee?: string; receiptImage?: string };
    rows.push({
      id: -n,
      occurredOn: whenOf(p),
      category: p.category ?? "",
      amount: total,
      mode: p.parts.map((x) => x.mode).join(" + "),
      payee: b.payee ?? "",
      fromBankId: p.parts[0]?.bankId,
      branchId: p.branchId ?? undefined,
      status: "",
      approvalStage: "",
      remarks: p.remarks ?? "",
      receiptImage: b.receiptImage,
      createdAt: p.entry.occurredAt,
    });
    sum += total;
  }
  return mergeTable(path, body, rows, { totalAmount: sum });
}

/* The Gold Sales table: sales made on this PC and not sent yet are listed first. */
export async function adjustGoldSales(path: string, body: string): Promise<string> {
  const branches = csv(queryOf(path), "branch_ids", "branchIds", "branch_id", "branchId").map(Number);
  const rows: Row[] = [];
  const totals = { totalSold: 0, totalCost: 0, totalProfit: 0 };
  let n = 0;
  for (const e of await waiting((x) => x.path === "/gold-sales")) {
    const g = (e.body ?? {}) as { ornamentType?: string; soldAmount?: number; costAmount?: number; costMode?: string; costBankId?: number; branchId?: number; mode?: string; bankId?: number; soldOn?: string; remarks?: string };
    if (branches.length && g.branchId && !branches.includes(Number(g.branchId))) continue;
    n += 1;
    const sold = Number(g.soldAmount) || 0;
    const cost = Number(g.costAmount) || 0;
    rows.push({
      id: -n,
      ornamentType: g.ornamentType ?? "",
      soldAmount: sold,
      costAmount: cost,
      profit: round2(sold - cost),
      soldOn: g.soldOn ? `${g.soldOn.slice(0, 10)}T${e.occurredAt.slice(11)}` : e.occurredAt,
      branchId: g.branchId,
      mode: g.mode || "Cash",
      bankId: g.bankId ?? null,
      costMode: g.costMode,
      remarks: g.remarks ?? "",
      createdAt: e.occurredAt,
    });
    totals.totalSold += sold;
    totals.totalCost += cost;
    totals.totalProfit += sold - cost;
  }
  return mergeTable(path, body, rows, totals);
}

/* ---- the ledgers of one bank, one customer and one branch (the "transactions" pages) ---- */

export const PARTY_PATH = /\/cash-movements\/transactions\/(bank|customer|branch)\/(\d+)(\?|$)/;

/* The waiting entries that belong to this party are listed at the top of its first page, newest first, and the totals move
 * with them. A page after the first, or a search, is left as the server gave it. `body` is null when no answer was ever kept. */
export async function adjustPartyLedger(path: string, body: string | null): Promise<string | null> {
  if (body === null) return null;
  const m = PARTY_PATH.exec(path);
  if (!m) return body;
  const qs = queryOf(path);
  if (leftAlone(qs)) return body;
  let env: Env;
  try {
    env = JSON.parse(body) as Env;
  } catch {
    return body;
  }
  const kind = m[1];
  const id = Number(m[2]);
  const page = env.data as Page | undefined;
  if (!page || Array.isArray(page) || !Array.isArray(page.items)) return body;
  const modes = csv(qs, "modes").map((x) => x.toLowerCase());
  const pending = (await pendingMoney(kind === "branch" ? id : 0))
    .filter((p) => inDates(p, qs))
    .map((p) => {
      if (kind === "customer") return p.customerId === id ? p : null;
      if (kind === "branch") return p.branchId === id ? p : null;
      const parts = p.parts.filter((x) => x.bankId === id);
      return parts.length ? { ...p, parts } : null;
    })
    .filter((p): p is Pending => p !== null)
    .map((p) => (modes.length ? { ...p, parts: p.parts.filter((x) => modes.includes(x.mode.toLowerCase())) } : p))
    .filter((p) => p.parts.length > 0);
  if (!pending.length) return body;
  const limit = Number(qs.get("limit") ?? "0") || 0;
  const items = page.items;

  if (kind === "customer") {
    // ledger rows, each with the balance after it
    const rows: Row[] = [];
    let n = 0;
    for (const p of pending) for (const part of p.parts) rows.push(ledgerRow(p, (n += 1), part.mode, part.amount, part.bankId, part.bankName));
    let balance = Number(items[0]?.runningBalance) || 0;
    for (let i = rows.length - 1; i >= 0; i--) {
      balance += (rows[i].debitOrCredit === "debit" ? -1 : 1) * Number(rows[i].amount);
      rows[i].runningBalance = round2(balance);
    }
    const debit = rows.filter((r) => r.debitOrCredit === "debit").reduce((s, r) => s + Number(r.amount), 0);
    const credit = rows.filter((r) => r.debitOrCredit === "credit").reduce((s, r) => s + Number(r.amount), 0);
    page.items = limit > 0 ? [...rows, ...items].slice(0, limit) : [...rows, ...items];
    page.total = (page.total ?? items.length) + rows.length;
    if (limit > 0) page.hasMore = page.total > limit;
    page.totalDebit = round2((Number(page.totalDebit) || 0) + debit);
    page.totalCredit = round2((Number(page.totalCredit) || 0) + credit);
    return JSON.stringify(env);
  }

  // a bank's or a branch's rows are cash movements, with in / out totals
  const rows = movementRows(pending);
  const totals = (page as { totals?: { totalIn: number; totalOut: number; net: number; inCount: number; outCount: number } }).totals;
  page.items = limit > 0 ? [...rows, ...items].slice(0, limit) : [...rows, ...items];
  page.total = (page.total ?? items.length) + rows.length;
  if (limit > 0) page.hasMore = page.total > limit;
  if (totals) {
    const inRows = rows.filter((r) => r.type === "in");
    const outRows = rows.filter((r) => r.type === "out");
    totals.totalIn = round2(totals.totalIn + inRows.reduce((s, r) => s + Number(r.amount), 0));
    totals.totalOut = round2(totals.totalOut + outRows.reduce((s, r) => s + Number(r.amount), 0));
    totals.net = round2(totals.totalIn - totals.totalOut);
    totals.inCount += inRows.length;
    totals.outCount += outRows.length;
  }
  return JSON.stringify(env);
}
