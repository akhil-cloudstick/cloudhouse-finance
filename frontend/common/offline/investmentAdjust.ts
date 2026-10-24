/* Investment plans and investments made on this PC that the server has not been sent yet. The plan list and the
 * investment list the screens show are the server's last answer, which cannot know about them, so each waiting "create plan" /
 * "create investment" entry is added to that answer in the shape the server will use once it is sent: a plan under a local
 * id, an investment as a PENDING row. When it has been sent the server's own answer includes it and it is no longer in the
 * outbox, so nothing is shown twice. */

import { offlineStore } from "@/common/services/desktopBridge";
import { localRequestId } from "./requestRef";
import type { OutboxEntry } from "./types";

type Plan = Record<string, unknown> & { isActive?: boolean; tenureMonths?: number; interestRateType?: string; interestRatePercent?: number; payoutFrequency?: string; engine?: string };
type InvestmentBody = { branchId?: number; principalAmount?: number; startDate?: string };
type View = { customerName?: string; customerCode?: string; plan?: Plan & { id?: number } };

type Env = { data?: unknown; [k: string]: unknown };

async function waiting(method: string, path: string): Promise<OutboxEntry[]> {
  const found: OutboxEntry[] = [];
  for (const line of await offlineStore.readAllOutbox().catch(() => [] as string[])) {
    try {
      const entry = JSON.parse(line) as OutboxEntry;
      if (entry.method === method && entry.path === path) found.push(entry);
    } catch {
      /* a line that cannot be read adds nothing */
    }
  }
  return found;
}

function queryOf(path: string): URLSearchParams {
  return new URLSearchParams(path.includes("?") ? path.slice(path.indexOf("?") + 1) : "");
}

/* GET /investment-plans...: the waiting plans are listed after the server's, narrowed to active ones when the screen asks. */
export async function adjustInvestmentPlans(path: string, kept: string | null): Promise<string | null> {
  const activeOnly = queryOf(path).get("activeOnly") === "true";
  const rows = (await waiting("POST", "/investment-plans"))
    .map((e) => ({ id: localRequestId(e.id), ...((e.body ?? {}) as Plan) }))
    .filter((p) => !activeOnly || p.isActive !== false);
  if (!rows.length) return kept;
  let env: Env = { success: true, data: [] };
  if (kept !== null) {
    try {
      env = JSON.parse(kept) as Env;
    } catch {
      return kept;
    }
  }
  return JSON.stringify({ ...env, data: [...(Array.isArray(env.data) ? env.data : []), ...rows] });
}

function addMonths(day: string, months: number): string {
  const [y, m, d] = day.split("-").map(Number);
  if (!y || !m || !d) return day;
  return new Date(Date.UTC(y, m - 1 + months, d)).toISOString().slice(0, 10);
}

/* The row the server will make for a waiting investment. */
export function pendingInvestmentRow(entry: OutboxEntry, b: InvestmentBody, v: View): Record<string, unknown> {
  const plan = v.plan ?? {};
  const principal = Number(b.principalAmount) || 0;
  const start = (b.startDate ?? entry.occurredAt).slice(0, 10);
  return {
    id: localRequestId(entry.id),
    investmentNumber: "Pending",
    branchId: b.branchId ?? null,
    customerId: 0,
    customer: { id: 0, name: v.customerName ?? "—", code: v.customerCode ?? "", phone: "" },
    planId: plan.id ?? 0,
    plan,
    principalAmount: principal,
    interestRateType: plan.interestRateType,
    interestRatePercent: plan.interestRatePercent,
    payoutFrequency: plan.payoutFrequency,
    tenureMonths: plan.tenureMonths,
    startDate: start,
    maturityDate: addMonths(start, Number(plan.tenureMonths) || 0),
    status: "Active",
    totalInterestPaid: 0,
    closedAt: null,
    renewedFromInvestmentId: null,
    renewedToInvestmentId: null,
    createdAt: entry.occurredAt,
    engine: plan.engine,
    outstandingPrincipal: principal,
    accruedInterest: 0,
    interestWithdrawn: 0,
    outstandingInterest: 0,
    lastAccrualDate: null,
    syncPending: true,
  };
}

/* GET /investments...: a row for each waiting investment, on the first page, narrowed by the same search and status the
 * screen asked for. */
export async function adjustInvestments(path: string, kept: string | null): Promise<string | null> {
  const qs = queryOf(path);
  if ((Number(qs.get("offset") ?? "0") || 0) > 0) return kept;
  // a list for one investor is for an investor the server numbers; a waiting investment is not listed there
  if (qs.get("customerId") || qs.get("customer_id")) return kept;
  const q = (qs.get("q") ?? "").trim().toLowerCase();
  const status = (qs.get("status") ?? "").toLowerCase();
  const rows = (await waiting("POST", "/investments"))
    .map((e) => pendingInvestmentRow(e, (e.body ?? {}) as InvestmentBody, (e.view ?? {}) as View))
    .filter((r) => {
      const c = r.customer as { name: string; code: string };
      return (!q || `${r.investmentNumber} ${c.name} ${c.code}`.toLowerCase().includes(q)) && (!status || status === String(r.status).toLowerCase());
    })
    .reverse();
  if (!rows.length) return kept;
  let env: Env = { success: true, data: { items: [], hasMore: false, total: 0 } };
  if (kept !== null) {
    try {
      env = JSON.parse(kept) as Env;
    } catch {
      return kept;
    }
  }
  if (Array.isArray(env.data)) return JSON.stringify({ ...env, data: [...rows, ...env.data] });
  const d = env.data as { items?: unknown[]; hasMore?: boolean; total?: number } | undefined;
  if (!d || !Array.isArray(d.items)) return kept;
  const limit = Number(qs.get("limit") ?? "0") || d.items.length + rows.length;
  const total = (d.total ?? d.items.length) + rows.length;
  return JSON.stringify({ ...env, data: { ...d, items: [...rows, ...d.items].slice(0, limit), total, hasMore: total > limit } });
}
