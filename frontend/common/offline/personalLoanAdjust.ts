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
