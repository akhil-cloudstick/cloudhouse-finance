/* Fetches the lists the app shows on almost every screen, right after sign-in and then now and then, so each
 * one is on this PC before the server stops answering. Without this a screen only works offline if it was
 * opened online first.
 *
 * Two tiers: the lists every few minutes, and the pages that belong to one record (a personal loan, an investment,
 * a bank's ledger, a loan's auction case) about every half hour, since those are many requests. */

import { quietly, warmGet, warmJson } from "@/common/services/httpClient";
import { warmImages } from "./imageCache";
import { listLocal } from "./localCopy";
import { employeeId } from "./session";

// one big page, so any smaller page or search of the same list can be cut from it offline
const ALL = "limit=200&offset=0";
const PER_RECORD = "limit=100&offset=0";
// the per-record tier is refreshed this often, and at most this often after a send (so what was just saved is also kept)
const HEAVY_EVERY_MS = 10 * 60_000;
const HEAVY_MIN_GAP_MS = 60_000;

const PATHS = [
  "/schemes",
  "/schemes/active",
  "/gold-rates",
  "/gold-rates/latest",
  "/reminders",
  "/banks",
  "/branches",
  "/branches/switchable",
  "/approval-workflow",
  "/approval-workflow/categories",
  "/business-profile",
  "/ornament-types",
  "/purity-standards",
  "/roles",
  "/auth/me",
  "/banks",
  "/cash-sources",
  "/expense-categories",
  "/lockers",
  "/cash/summary",
  "/loans/requests",
  "/categories?type=self_transfer&limit=100",
  "/categories?type=cash_in&limit=100",
  "/categories?type=expense&limit=100",
  // dashboard
  "/dashboard/needs-attention?page=1",
  "/dashboard/loan-stats",
  "/loans/interest-collected",
  // Extensions & Release, lockers (the packet check-in picker), packets, personal loans, investments
  `/loans/requests?${ALL}`,
  `/lockers?${ALL}`,
  `/packets?${ALL}`,
  `/personal-loans?${ALL}`,
  `/investments?${ALL}`,
  "/investment-plans",
  // auctions: pending decisions, and the two History tables ("conducted" and "closed without auction")
  "/loans/auctions/decisions/pending",
  "/loans/auctions/concluded",
  `/loans/auctions/concluded?${ALL}&hasSale=true`,
  `/loans/auctions/concluded?${ALL}&hasSale=false`,
  "/loans/bank-pledges/history",
  `/loans/bank-pledges/history?${ALL}`,
  // the cash ledger, and the three tables on the Cash page (cash entries, expenses, gold sales)
  `/cash-movements/cash-ledger?${ALL}`,
  `/cash-movements?${ALL}`,
  `/expenses?${ALL}`,
  `/gold-sales?${ALL}`,
  `/loans/risk-assessment?limit=100&offset=0`,
];

const REPORTS = [
  "disbursement",
  "loans/status",
  "interest-collection",
  "outstanding-principal",
  "payment-collection",
  "gold-weight",
  "packets",
  "bank-pledge",
  "loan-extensions",
  "gold-release",
  "auctions",
  "expense-cashflow",
  "kyc",
  "gold-rate-history",
  "employee-performance",
  "communication-history",
  "personal-loans",
  "investments/deposit-register",
  "investments/interest-payout-register",
  "investments/maturity-register",
  "balance-sheet",
  "profit-loss",
  "form-g",
];

type Row = { id?: number; code?: string; status?: string };

/* The rows of a list answer, whether the server sent a bare list or a page of {items}. */
function rowsOf(json: unknown): Row[] {
  const data = (json as { data?: unknown } | null)?.data;
  const rows = Array.isArray(data) ? data : Array.isArray((data as { items?: unknown[] } | undefined)?.items) ? (data as { items: unknown[] }).items : [];
  return rows.filter((r): r is Row => !!r && typeof (r as Row).id === "number" && ((r as Row).id as number) > 0);
}

async function idsOf(path: string, max: number): Promise<number[]> {
  return rowsOf(await warmJson(path))
    .slice(0, max)
    .map((r) => r.id as number);
}

/* A packet's details page reads the packet and its movements, so those are kept for each packet as well. */
async function warmPackets(): Promise<void> {
  const rows = rowsOf(await warmJson("/packets")).slice(0, 150);
  for (const p of rows) {
    await warmGet(`/packets/${p.id}`);
    await warmGet(`/packets/${p.id}/movements`);
    // the packet page is opened by its code
    if (p.code) await warmGet(`/packets/by-code/${encodeURIComponent(p.code)}`);
  }
}

/* The Roles & Permissions page reads one matrix per role, so each role's is kept. They are only viewable offline:
 * changing a permission needs the server, so access can never be changed in a way nobody can review. */
async function warmRoleMatrices(): Promise<void> {
  const emp = employeeId();
  if (!emp) return;
  for (const id of await idsOf("/roles", 40)) await warmGet(`/employees/${emp}/permissions?role_id=${id}`);
}

/* The detail page of a personal loan: the loan, its approvals, schedule, payments and history. */
async function warmPersonalLoans(): Promise<void> {
  for (const id of await idsOf(`/personal-loans?${ALL}`, 40)) {
    await warmGet(`/personal-loans/${id}`);
    await warmGet(`/personal-loans/${id}/approvals`);
    await warmGet(`/personal-loans/${id}/schedule?${PER_RECORD}`);
    await warmGet(`/personal-loans/${id}/payments?${PER_RECORD}&order=desc`);
    await warmGet(`/personal-loans/${id}/history?${PER_RECORD}`);
  }
}

/* The detail page of an investment: the investment, its ledger, schedule, transactions and pending interest. */
async function warmInvestments(): Promise<void> {
  for (const id of await idsOf(`/investments?${ALL}`, 40)) {
    await warmGet(`/investments/${id}`);
    await warmGet(`/investments/${id}/ledger`);
    await warmGet(`/investments/${id}/ledger?${PER_RECORD}`);
    await warmGet(`/investments/${id}/schedule?${PER_RECORD}`);
    await warmGet(`/investments/${id}/transactions?${PER_RECORD}`);
    await warmGet(`/investments/${id}/pending-interest`);
  }
}

/* The ledgers that belong to one bank, one branch or one customer. */
async function warmLedgers(): Promise<void> {
  for (const id of await idsOf("/banks", 40)) {
    await warmGet(`/banks/${id}/ledger?${ALL}`);
    await warmGet(`/cash-movements/transactions/bank/${id}?${ALL}`);
  }
  for (const id of await idsOf("/branches", 40)) await warmGet(`/cash-movements/transactions/branch/${id}?${ALL}`);
  const customers = listLocal("customers")
    .map((c) => c.id)
    .filter((id): id is number => typeof id === "number" && id > 0)
    .slice(0, 1000);
  for (const id of customers) await warmGet(`/cash-movements/transactions/customer/${id}?${ALL}`);
  // each expense category's ledger, and the ledger of each payment mode (the Cash one is in PATHS)
  for (const id of await idsOf("/expense-categories", 60)) await warmGet(`/expense-categories/${id}/ledger?${ALL}`);
  for (const mode of ["UPI", "Bank Transfer", "Cheque"]) await warmGet(`/cash-movements/mode-ledger?mode=${encodeURIComponent(mode)}&${ALL}`);
}

/* The auction case of each open loan (Active tab) and every case ever opened against it (History), and its bank
 * pledge history. */
async function warmAuctions(): Promise<void> {
  const open = listLocal("loans")
    .filter((l) => typeof l.id === "number" && (l.id as number) > 0 && !/released|voided|rejected/i.test(String(l.status ?? "")))
    .slice(0, 60);
  for (const l of open) {
    await warmGet(`/loans/${l.id}/auction?optional=1`);
    await warmGet(`/loans/${l.id}/auction/history`);
    await warmGet(`/loans/${l.id}/bank-pledge/history`);
  }
}

const iso = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;

/* The reminder calendar of last month, this month and the next three, so moving between months works offline. */
async function warmCalendar(): Promise<void> {
  const now = new Date();
  for (let delta = -1; delta <= 3; delta++) {
    const from = new Date(now.getFullYear(), now.getMonth() + delta, 1);
    const to = new Date(now.getFullYear(), now.getMonth() + delta + 1, 0);
    await warmGet(`/reminders/calendar?from=${iso(from)}&to=${iso(to)}`);
  }
}

// what the dashboard and the ledgers show for the branch picked in the header (cards, totals, rows)
const BRANCH_PATHS = [
  "/cash/summary",
  "/dashboard/needs-attention?page=1",
  "/dashboard/loan-stats",
  "/loans/interest-collected",
  "/banks",
  `/cash-movements/cash-ledger?${ALL}`,
  `/cash-movements?${ALL}`,
  `/expenses?${ALL}`,
  `/gold-sales?${ALL}`,
  `/loans/requests?${ALL}`,
  `/packets?${ALL}`,
  `/personal-loans?${ALL}`,
  `/investments?${ALL}`,
  "/loans/risk-assessment?limit=100&offset=0",
];

/* Switching branch changes what those screens ask for, and each branch's answer is its own, so each branch (and "all
 * branches") is kept separately; otherwise a branch that was never opened online shows nothing offline. */
async function warmBranches(): Promise<void> {
  const ids = await idsOf("/branches", 40);
  for (const branch of [null, ...ids]) {
    for (const p of BRANCH_PATHS) await warmGet(p, branch);
    for (const r of REPORTS) await warmGet(`/reports/${r}`, branch);
  }
}

/* The logo and the photos the local copy points at (customer photos, ornament pictures, KYC documents), so offline they
 * show instead of broken images. */
async function warmPictures(): Promise<void> {
  const profile = await warmJson("/business-profile");
  // the logo's address is in the branding answer, not the profile
  const branding = await warmJson("/branding");
  await warmImages([branding, profile, listLocal("customers"), listLocal("loans")]);
}

let running = false;
let lastHeavy = 0;
let rerun: { force: boolean } | null = null;

/* `force` is for right after this PC sent something: the record pages are fetched again without waiting for the interval.
 * A call made while a warm-up is running is not lost; it runs once that one ends. */
export async function warmReadCache(force = false): Promise<void> {
  if (!employeeId()) return;
  if (running) {
    rerun = { force: force || !!rerun?.force };
    return;
  }
  running = true;
  try {
    await quietly(async () => {
      for (const p of PATHS) await warmGet(p);
      for (const r of REPORTS) await warmGet(`/reports/${r}`);
      await warmCalendar();
      await warmRoleMatrices();
      if (Date.now() - lastHeavy > (force ? HEAVY_MIN_GAP_MS : HEAVY_EVERY_MS)) {
        await warmPackets();
        await warmPersonalLoans();
        await warmInvestments();
        await warmLedgers();
        await warmAuctions();
        await warmBranches();
        await warmPictures();
        lastHeavy = Date.now();
      }
    });
  } finally {
    running = false;
    const next = rerun;
    rerun = null;
    if (next) void warmReadCache(next.force);
  }
}
