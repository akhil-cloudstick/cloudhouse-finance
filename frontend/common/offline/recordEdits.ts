/* Edits and deletes of personal loans, investments and investment plans that the server already has, made on this PC and not
 * sent yet. The screens show the server's last answer, which cannot know about them, so each waiting edit or delete is applied
 * to that answer here: an edit changes the row and what is worked out from it, a delete takes the row off the lists and the
 * record's own page. Once an entry has been sent the server's own rows include it and it is no longer in the outbox, so
 * nothing is applied twice. */

import { offlineStore } from "@/common/services/desktopBridge";
import { roundRupee } from "@/common/utils/format";
import type { OutboxEntry } from "./types";

type Row = Record<string, unknown>;
type Env = { success?: boolean; data?: unknown; [k: string]: unknown };
type Kind = "personal" | "investment" | "plan";
type Waiting = { edits: Map<number, Row[]>; deleted: Set<number> };

const num = (v: unknown) => Number(v) || 0;

const ENTRY: Record<Kind, { edit: [string, RegExp]; remove: RegExp }> = {
  personal: { edit: ["PATCH", /^\/personal-loans\/(\d+)$/], remove: /^\/personal-loans\/(\d+)$/ },
  investment: { edit: ["PATCH", /^\/investments\/(\d+)$/], remove: /^\/investments\/(\d+)(?:\/delete)?$/ },
  plan: { edit: ["PUT", /^\/investment-plans\/(\d+)$/], remove: /^\/investment-plans\/(\d+)(?:\/delete)?$/ },
};

async function outbox(): Promise<OutboxEntry[]> {
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

function waitingFor(kind: Kind, entries: OutboxEntry[]): Waiting {
  const w: Waiting = { edits: new Map(), deleted: new Set() };
  const [editMethod, editPath] = ENTRY[kind].edit;
  for (const e of entries) {
    const path = e.path.split("?")[0];
    if (e.method === editMethod) {
      const id = Number(editPath.exec(path)?.[1] ?? 0);
      if (id) w.edits.set(id, [...(w.edits.get(id) ?? []), (e.body ?? {}) as Row]);
    } else if (e.method === "DELETE") {
      const id = Number(ENTRY[kind].remove.exec(path)?.[1] ?? 0);
      if (id) w.deleted.add(id);
    }
  }
  return w;
}

function addMonths(day: string, months: number): string {
  const [y, m, d] = day.split("-").map(Number);
  if (!y || !m || !d) return day;
  return new Date(Date.UTC(y, m - 1 + months, d)).toISOString().slice(0, 10);
}

/* A personal loan with its corrected terms, and what is worked out from them, the way the server will (a loan can only be
 * corrected before any payment, so nothing has been paid yet). */
function editedPersonal(row: Row, edits: Row[]): Row {
  let r = row;
  for (const b of edits) {
    const full = b.fullDisbursement === undefined ? !!r.fullDisbursement : !!b.fullDisbursement;
    const entered = r.fullDisbursement ? num(r.principalAmount) - num(r.interestAmount) : num(r.principalAmount);
    const principal = roundRupee(b.principalAmount === undefined ? entered : num(b.principalAmount));
    const type = String(b.interestType ?? r.interestType);
    const value = b.interestValue === undefined ? num(r.interestValue) : num(b.interestValue);
    const tenure = b.tenureCount === undefined ? num(r.tenureCount) : num(b.tenureCount);
    // the server's rule (computeInterest, edit_loan.go): interest, obligation, disbursed and installment are whole rupees
    const interest = roundRupee(type === "Percentage" ? (principal * value) / 100 : value);
    const obligation = full ? roundRupee(principal + interest) : principal;
    r = {
      ...r,
      principalAmount: obligation,
      interestType: type,
      interestValue: value,
      interestAmount: interest,
      fullDisbursement: full,
      disbursedAmount: full ? principal : roundRupee(principal - interest),
      frequency: b.frequency ?? r.frequency,
      tenureCount: tenure,
      installmentAmount: tenure > 0 ? roundRupee(obligation / tenure) : 0,
      outstandingAmount: obligation,
      penalInterestRate: b.penalInterestRate === undefined ? r.penalInterestRate : num(b.penalInterestRate),
      gracePeriodDays: b.gracePeriodDays === undefined ? r.gracePeriodDays : num(b.gracePeriodDays),
    };
  }
  return r;
}

function editedInvestment(row: Row, edits: Row[]): Row {
  let r = row;
  for (const b of edits) {
    const principal = b.principalAmount === undefined ? num(r.principalAmount) : num(b.principalAmount);
    const start = String(b.startDate ?? r.startDate ?? "").slice(0, 10);
    r = {
      ...r,
      planId: b.planId ?? r.planId,
      principalAmount: principal,
      outstandingPrincipal: principal,
      startDate: start || r.startDate,
      maturityDate: start ? addMonths(start, num(r.tenureMonths)) : r.maturityDate,
    };
  }
  return r;
}

function editedPlan(row: Row, edits: Row[]): Row {
  let r = row;
  for (const b of edits) r = { ...r, ...b };
  return r;
}

const IS_ROW = (v: unknown): v is Row => !!v && typeof v === "object" && !Array.isArray(v);

/* The investments' own copy of their plan follows an edit made to that plan. */
function withPlanEdits(row: Row, plans: Waiting): Row {
  const plan = row.plan;
  const id = num(row.planId);
  if (!IS_ROW(plan) || !id || !plans.edits.has(id)) return row;
  return { ...row, plan: editedPlan(plan, plans.edits.get(id)!) };
}

function applyTo(kind: Kind, row: Row, w: Waiting, plans: Waiting): Row {
  const id = num(row.id);
  let r = row;
  const edits = w.edits.get(id);
  if (edits) r = kind === "personal" ? editedPersonal(r, edits) : kind === "investment" ? editedInvestment(r, edits) : editedPlan(r, edits);
  return kind === "investment" ? withPlanEdits(r, plans) : r;
}

function adjust(kind: Kind, env: Env, w: Waiting, plans: Waiting): Env | null {
  const data = env.data;
  const touch = (rows: Row[]) => rows.filter((r) => !w.deleted.has(num(r.id))).map((r) => applyTo(kind, r, w, plans));
  if (Array.isArray(data)) return { ...env, data: touch(data.filter(IS_ROW)) };
  if (!IS_ROW(data)) return env;
  if (Array.isArray(data.items)) {
    const before = data.items.length;
    const items = touch((data.items as unknown[]).filter(IS_ROW));
    const total = typeof data.total === "number" ? Math.max(0, data.total - (before - items.length)) : data.total;
    return { ...env, data: { ...data, items, total } };
  }
  // one record's own answer
  if (typeof data.id === "number" || typeof data.id === "string") {
    if (w.deleted.has(num(data.id))) return null;
    return { ...env, data: applyTo(kind, data, w, plans) };
  }
  return env;
}

const PERSONAL = /\/personal-loans(\/\d+)?(\?|$)/;
const INVESTMENT = /\/investments(\/\d+)?(\?|$)/;
const PLANS = /\/investment-plans(\?|$)/;

/* The answer for `path` with this PC's waiting edits and deletes applied. null when the record was deleted here. */
export async function adjustRecordEdits(path: string, body: string): Promise<string | null> {
  const kind: Kind | null = PERSONAL.test(path) ? "personal" : INVESTMENT.test(path) ? "investment" : PLANS.test(path) ? "plan" : null;
  if (!kind) return body;
  const entries = await outbox();
  if (!entries.some((e) => e.method === "PATCH" || e.method === "PUT" || e.method === "DELETE")) return body;
  const own = waitingFor(kind, entries);
  const plans = waitingFor("plan", entries);
  if (!own.edits.size && !own.deleted.size && !plans.edits.size) return body;
  let env: Env;
  try {
    env = JSON.parse(body) as Env;
  } catch {
    return body;
  }
  const out = adjust(kind, env, own, plans);
  return out === null ? null : JSON.stringify(out);
}
