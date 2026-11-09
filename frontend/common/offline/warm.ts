/* Fetches the lists the app shows on almost every screen, right after sign-in and then now and then, so each
 * one is on this PC before the server stops answering. Without this a screen only works offline if it was
 * opened online first.
 *
 * Two tiers: the lists every few minutes, and the pages that belong to one record (a personal loan, an investment,
 * a bank's ledger, a loan's auction case) about every half hour, since those are many requests. */

import { quietly, warmAllPages, warmGet, warmJson } from "@/common/services/httpClient";
import { setAuctionStage } from "./auctionStages";
import { warmImages } from "./imageCache";
import { listLocal } from "./localCopy";
import { COPY_STATUS_EVENT } from "./pull";
import { employeeId } from "./session";

// one big page, so any smaller page or search of the same list can be cut from it offline
const ALL = "limit=200&offset=0";
const PER_RECORD = "limit=100&offset=0";
// the per-record tier is refreshed this often, and at most this often after a send (so what was just saved is also kept)
const HEAVY_EVERY_MS = 10 * 60_000;
const HEAVY_MIN_GAP_MS = 60_000;
// Nothing is cut short: every record of a list, and of the pages that belong to one record, is kept on this PC.
const NO_CAP = 1_000_000;

/* A list with a limit in its address is kept whole (every page, joined), anything else as the single answer it gives. */
async function warmList(path: string, branch?: number | null): Promise<void> {
	if (/[?&]limit=/.test(path)) await warmAllPages(path, branch);
	else await warmGet(path, branch);
}

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
	"/employees",
	`/employees?${ALL}`,
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
	"day-book",
];

type Row = { id?: number; code?: string; status?: string; engine?: string };

/* The rows of a list answer, whether the server sent a bare list or a page of {items}. */
function rowsOf(json: unknown): Row[] {
	const data = (json as { data?: unknown } | null)?.data;
	const rows = Array.isArray(data) ? data : Array.isArray((data as { items?: unknown[] } | undefined)?.items) ? (data as { items: unknown[] }).items : [];
	return rows.filter((r): r is Row => !!r && typeof (r as Row).id === "number" && ((r as Row).id as number) > 0);
}

/* Every row of a list, however many pages it has (kept whole on the way, see warmAllPages). */
async function listRows(path: string): Promise<unknown[]> {
	if (/[?&]limit=/.test(path)) {
		const all = await warmAllPages(path);
		if (all) return all;
	}
	const data = ((await warmJson(path)) as { data?: unknown } | null)?.data;
	return Array.isArray(data) ? data : Array.isArray((data as { items?: unknown[] } | undefined)?.items) ? (data as { items: unknown[] }).items : [];
}

const withIds = (rows: unknown[]): Row[] => rows.filter((r): r is Row => !!r && typeof (r as Row).id === "number" && ((r as Row).id as number) > 0);

async function idsOf(path: string, max: number): Promise<number[]> {
	return withIds(await listRows(path))
		.slice(0, max)
		.map((r) => r.id as number);
}

/* Investments (id, engine) — the transactions list exists only for live-accrual ones; the server answers 400 for the rest. */
async function investmentsOf(max: number): Promise<{ id: number; live: boolean }[]> {
	return withIds(await listRows(`/investments?${ALL}`))
		.slice(0, max)
		.map((r) => ({ id: r.id as number, live: r.engine === "Live" }));
}

/* A packet's details page reads the packet and its movements, so those are kept for each packet as well. */
async function warmPackets(): Promise<void> {
	const rows = rowsOf(await warmJson("/packets")).slice(0, NO_CAP);
	for (const p of rows) {
		await warmGet(`/packets/${p.id}`);
		await warmGet(`/packets/${p.id}/movements`);
		// the packet page is opened by its code
		if (p.code) await warmGet(`/packets/by-code/${encodeURIComponent(p.code)}`);
	}
}

/* The Roles & Permissions page reads one matrix per role, so each role's is kept. A permission change made offline is queued like any
 * other save and shown on top of this copy (accessAdjust.ts) until it syncs. */
async function warmRoleMatrices(): Promise<void> {
	const emp = employeeId();
	if (!emp) return;
	for (const id of await idsOf("/roles", NO_CAP)) await warmGet(`/employees/${emp}/permissions?role_id=${id}`);
}

/* The detail page of a personal loan: the loan, its approvals, schedule, payments and history. */
async function warmPersonalLoans(): Promise<void> {
	for (const id of await idsOf(`/personal-loans?${ALL}`, NO_CAP)) {
		await warmGet(`/personal-loans/${id}`);
		await warmGet(`/personal-loans/${id}/approvals`);
		await warmGet(`/personal-loans/${id}/schedule?${PER_RECORD}`);
		await warmGet(`/personal-loans/${id}/payments?${PER_RECORD}&order=desc`);
		await warmGet(`/personal-loans/${id}/history?${PER_RECORD}`);
	}
}

/* The detail page of an investment: the investment, its ledger, schedule, transactions and pending interest. */
async function warmInvestments(): Promise<void> {
	for (const { id, live } of await investmentsOf(NO_CAP)) {
		await warmGet(`/investments/${id}`);
		await warmGet(`/investments/${id}/ledger`);
		await warmGet(`/investments/${id}/ledger?${PER_RECORD}`);
		await warmGet(`/investments/${id}/schedule?${PER_RECORD}`);
		if (live) await warmGet(`/investments/${id}/transactions?${PER_RECORD}`);
		await warmGet(`/investments/${id}/pending-interest`);
	}
}

/* The ledgers that belong to one bank, one branch or one customer. */
async function warmLedgers(): Promise<void> {
	for (const id of await idsOf("/banks", NO_CAP)) {
		await warmList(`/banks/${id}/ledger?${ALL}`);
		await warmList(`/cash-movements/transactions/bank/${id}?${ALL}`);
	}
	for (const id of await idsOf("/branches", NO_CAP)) await warmList(`/cash-movements/transactions/branch/${id}?${ALL}`);
	const customers = listLocal("customers")
		.map((c) => c.id)
		.filter((id): id is number => typeof id === "number" && id > 0)
		.slice(0, NO_CAP);
	for (const id of customers) await warmList(`/cash-movements/transactions/customer/${id}?${ALL}`);
	// each expense category's ledger, and the ledger of each payment mode the server has one for (the Cash one is in PATHS)
	for (const id of await idsOf("/expense-categories", NO_CAP)) await warmList(`/expense-categories/${id}/ledger?${ALL}`);
	for (const mode of ["UPI", "Bank Transfer"]) await warmList(`/cash-movements/mode-ledger?mode=${encodeURIComponent(mode)}&${ALL}`);
}

/* The auction case of each open loan (Active tab) and every case ever opened against it (History), and its bank
 * pledge history. */
async function warmAuctions(): Promise<void> {
	const open = listLocal("loans")
		.filter((l) => typeof l.id === "number" && (l.id as number) > 0 && !/released|voided|rejected/i.test(String(l.status ?? "")))
		.slice(0, NO_CAP);
	for (const l of open) {
		// the stage of the loan's latest case (none: no case); an answer that did not come leaves what is kept as it was
		const answer = (await warmJson(`/loans/${l.id}/auction?optional=1`)) as { data?: { stage?: string } | null } | null;
		if (answer) setAuctionStage(l.id as number, answer.data?.stage ?? null);
		await warmGet(`/loans/${l.id}/auction/history`);
		await warmGet(`/loans/${l.id}/bank-pledge/history`);
	}
}

/* The History tables' edit screens read the sale of each concluded case (what was sold, for how much, the surplus), so it is kept
 * for each case, along with the case's own history. */
async function warmConcludedAuctions(): Promise<void> {
	for (const hasSale of ["true", "false"]) {
		const rows = (await listRows(`/loans/auctions/concluded?${ALL}&hasSale=${hasSale}`)) as { loanId?: number }[];
		for (const r of rows.slice(0, NO_CAP)) {
			if (!r.loanId || r.loanId <= 0) continue;
			await warmGet(`/loans/${r.loanId}/auction/sale`);
			await warmGet(`/loans/${r.loanId}/auction/history`);
		}
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
	const ids = await idsOf("/branches", NO_CAP);
	for (const branch of [null, ...ids]) {
		for (const p of BRANCH_PATHS) await warmList(p, branch);
		for (const r of REPORTS) await warmGet(`/reports/${r}`, branch);
	}
}

/* The logo and the photos the local copy points at (customer photos, ornament pictures, KYC documents), so offline they
 * show instead of broken images. */
async function warmPictures(): Promise<void> {
	const profile = await warmJson("/business-profile");
	// the logo's address is in the branding answer, not the profile
	const branding = await warmJson("/branding");
	// a customer's detail answer carries the photo and KYC documents the list rows may not, so each is read and scanned too
	const details: unknown[] = [];
	for (const c of listLocal("customers")) {
		if (typeof c.id === "number" && c.id > 0) details.push(await warmJson(`/customers/${c.id}`));
	}
	// no 200-picture cap: every customer's photos are kept, not just the first ones
	await warmImages([branding, profile, listLocal("customers"), listLocal("loans"), details], NO_CAP);
}

let running = false;
let lastHeavy = 0;
let warmedOnce = false;
let rerun: { force: boolean } | null = null;

/* True once a whole warm-up (the lists and the per-record pages) has run to the end since sign-in. */
export function warmCompleted(): boolean {
	return warmedOnce;
}

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
			for (const p of PATHS) await warmList(p);
			for (const r of REPORTS) await warmGet(`/reports/${r}`);
			await warmCalendar();
			await warmRoleMatrices();
			if (Date.now() - lastHeavy > (force ? HEAVY_MIN_GAP_MS : HEAVY_EVERY_MS)) {
				await warmPackets();
				await warmPersonalLoans();
				await warmInvestments();
				await warmLedgers();
				await warmAuctions();
				await warmConcludedAuctions();
				await warmBranches();
				await warmPictures();
				lastHeavy = Date.now();
				if (!warmedOnce) {
					warmedOnce = true;
					if (typeof window !== "undefined") window.dispatchEvent(new Event(COPY_STATUS_EVENT));
				}
			}
		});
	} finally {
		running = false;
		const next = rerun;
		rerun = null;
		if (next) void warmReadCache(next.force);
	}
}
