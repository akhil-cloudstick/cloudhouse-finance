/* Last answers for screens that read the server. Every successful GET is kept on this PC; when the server
 * does not answer, the same request is answered from that copy, so lists, pickers and settings keep working
 * with what this PC last saw. Only a request that got NO answer falls back: an answer from the server (even
 * an error) is always shown as is.
 *
 * A request nobody has made before (a new filter, another page of a list) has no exact copy. It is then
 * answered from the newest copy of the same endpoint: the same data as the last time, cut to the page asked
 * for when it is a list. The store is warmed after sign-in (see warm.ts) so the common lists exist already. */

import { isDesktop, offlineStore } from "@/common/services/desktopBridge";
import { adjustBanks, adjustCashMovements, adjustCashSummary } from "./cashAdjust";
import { adjustLatestRate, adjustRateHistory } from "./goldRateAdjust";
import { adjustExpenses, adjustGoldSales, adjustLedger, LEDGER_PATH } from "./ledgerAdjust";
import { adjustPersonalLoans } from "./personalLoanAdjust";
import { adjustInvestmentPlans, adjustInvestments } from "./investmentAdjust";
import { adjustCalendar, adjustReminders } from "./reminderAdjust";
import { adjustMovements, adjustPackets, adjustRequests } from "./statusAdjust";
import { employeeId, offlineBusiness } from "./session";

const VERSION = 2;
const SKIP = /(^|\/)(auth|sync|uploads)(\/|$)|pdf|statement|export|download|qr|esign|receipt/i;
// Loans and customers are answered from the local copy instead (it also holds loans the server has not numbered yet)
const LOCAL_LOANS = /\/users\/\d+\/(loans|customers)(\?.*)?$|\/users\/\d+\/loans\/by-number\/[^/?]+(\?.*)?$|\/users\/\d+\/(loans|customers)\/\d+(\?.*)?$|\/users\/\d+\/loans\/\d+\/ledger(\?.*)?$|\/users\/(\d+)\/customers\/[^/?]+\/(profile360|loans|ornaments|payments|bank-pledges|auction-history)(\?.*)?$/;
const MAX_BODY = 3 * 1024 * 1024;
const MAX_QUEUED = 300;
// what a cached list is narrowed by when a screen asks for a subset (the server's own filters are not repeated otherwise)
const FILTERS: { params: string[]; fields: string[] }[] = [
  { params: ["status"], fields: ["status"] },
  { params: ["type"], fields: ["type"] },
  { params: ["branchId", "branch_id"], fields: ["branchId"] },
  { params: ["customerId", "customer_id"], fields: ["customerId"] },
  { params: ["lockerId", "locker_id"], fields: ["currentLockerId", "lockerId"] },
  { params: ["loanId", "loan_id"], fields: ["loanId"] },
  { params: ["frequency"], fields: ["frequency"] },
];

let enabled = false;
let opening: Promise<void> | null = null;
const queued: { path: string; view: string; body: string; emp: number }[] = [];

/* Turned on once the PC's store is open. Answers seen before that (the app loads its lists the moment you sign
 * in) were held in memory and are written now. */
/* The sign-in page reads before anyone has signed in (the business's logo and name), when the store is not open
 * yet. If the user has already chosen where it lives, open it for that business so those reads can be kept and
 * recalled too. Does nothing on the web, before the folder is chosen, or when the business is not known. */
async function openForReads(): Promise<void> {
  if (enabled || !isDesktop()) return;
  opening ??= (async () => {
    try {
      const business = offlineBusiness();
      if (await offlineStore.rootChosen()) {
        await offlineStore.open(business, "pc");
        enabled = true;
      }
    } catch {
      /* not available yet; the next read tries again */
    }
  })().finally(() => {
    opening = null;
  });
  await opening;
}

export function setReadCacheEnabled(on: boolean): void {
  enabled = on;
  if (on) {
    for (const q of queued.splice(0)) write(q.path, q.view, q.body, q.emp);
  } else {
    queued.length = 0;
  }
}

/* Two 32-bit FNV-1a hashes, joined: a short stable file name for any request. */
export function hashOf(text: string): string {
  let a = 0x811c9dc5;
  let b = 0x01000193 ^ text.length;
  for (let i = 0; i < text.length; i++) {
    const c = text.charCodeAt(i);
    a = Math.imul(a ^ c, 0x01000193) >>> 0;
    b = Math.imul(b ^ c, 0x85ebca6b) >>> 0;
  }
  return a.toString(16).padStart(8, "0") + b.toString(16).padStart(8, "0");
}

/* The branch the signed-in person is viewing changes what a list returns, so it is part of the key. */
function exactKey(emp: number, path: string, view: string): string {
  return `${emp} ${view} ${path}`;
}

/* The same endpoint whatever the query: the newest answer for it. A full list (no page asked for) and a page
 * of one are kept apart, so a page never replaces the whole list a later page can be cut from. */
function familyKey(emp: number, path: string, view: string, kind: Kind): string {
  // a list that is narrowed by "type" (the categories each form shows) is a different list per type
  const q = queryOf(path);
  const keys = ["role_id", "hasSale", "pageSize", "mode", ...(path.split("?")[0].endsWith("/categories") ? ["type"] : [])];
  const narrow = keys.filter((k) => q.get(k)).map((k) => `${k}=${q.get(k)}`).join("&");
  return `${emp} ${view} ${path.split("?")[0]}${narrow ? `?${narrow}` : ""} ${kind}`;
}

function queryOf(path: string): URLSearchParams {
  return new URLSearchParams(path.includes("?") ? path.slice(path.indexOf("?") + 1) : "");
}

/* Three kinds of copy of one endpoint are kept apart: the whole list (no page asked for), a BIG page (the warm-up asks
 * for 200 rows so any smaller page or filter can be cut from it), and an ordinary small page. A small page a screen
 * happens to open can therefore never replace the big one a later filter (a locker's packets) is cut from. */
type Kind = "*" | "big" | "paged";

function kindOf(path: string): Kind {
  const limit = Number(queryOf(path).get("limit") ?? "0");
  if (!(limit > 0)) return "*";
  return limit >= 100 ? "big" : "paged";
}

function fileOf(key: string): string {
  return `data/rc_${hashOf(key)}.json`;
}

/* What the branch picked in the header does NOT change: the business's own identity and settings. Their copy is kept once,
 * so whichever branch is picked offline still finds it (a copy per branch left a branch that was never opened online with
 * no name or logo). */
const BRANCH_FREE = /\/(branding|business-profile|public\/branding|branches|approval-workflow|roles|schemes|gold-rates|ornament-types|purity-standards|permissions|auth)(\/|\?|$)/;

export function branchScoped(path: string): boolean {
  return !BRANCH_FREE.test(path);
}

export function cacheable(method: string, path: string): boolean {
  return method === "GET" && isDesktop() && !SKIP.test(path) && !LOCAL_LOANS.test(path);
}

function put(key: string, path: string, body: string): void {
  void offlineStore
    .writeFile(fileOf(key), JSON.stringify({ v: VERSION, k: key, p: path, t: Date.now(), body }))
    .catch(() => {});
}

function write(path: string, view: string, body: string, emp: number): void {
  put(exactKey(emp, path, view), path, body);
  put(familyKey(emp, path, view, kindOf(path)), path, body);
}

/* Fire and forget: a failed write only means this answer will not be there offline. */
export function remember(path: string, view: string, body: string): void {
  if (body.length > MAX_BODY) return;
  const emp = employeeId() ?? 0;
  if (enabled) write(path, view, body, emp);
  else {
    if (queued.length < MAX_QUEUED) queued.push({ path, view, body, emp });
    // try to open the store so what was just read is kept even before sign-in
    void openForReads().then(() => {
      if (enabled) for (const q of queued.splice(0)) write(q.path, q.view, q.body, q.emp);
    });
  }
}

async function read(key: string): Promise<{ p: string; body: string } | null> {
  try {
    const text = await offlineStore.readFile(fileOf(key));
    if (!text) return null;
    const rec = JSON.parse(text) as { v?: number; k?: string; p?: string; body?: string };
    return rec.v === VERSION && rec.k === key && typeof rec.body === "string" ? { p: rec.p ?? "", body: rec.body } : null;
  } catch {
    return null;
  }
}

type Envelope = { success?: boolean; data?: unknown; [k: string]: unknown };

/* The calendar of another month is cut from the newest copy: only the events inside the asked-for dates stay, so a
 * month that was never kept shows empty rather than another month's events. */
function inRange(cachedBody: string, qs: URLSearchParams): string {
  const from = qs.get("from") ?? "";
  const to = qs.get("to") ?? "";
  try {
    const env = JSON.parse(cachedBody) as Envelope;
    if (!Array.isArray(env.data) || !from || !to) return cachedBody;
    const rows = env.data.filter((r) => {
      const date = (r as { date?: unknown }).date;
      return typeof date !== "string" || (date >= from && date <= to);
    });
    return JSON.stringify({ ...env, data: rows });
  } catch {
    return cachedBody;
  }
}

/* Cuts a cached answer to the page and search the request asks for. The server's own filters (a status, a
 * branch) are not repeated here, so a filtered list may show more than the server would have. */
function reshape(cachedBody: string, path: string): string {
  const qs = new URLSearchParams(path.includes("?") ? path.slice(path.indexOf("?") + 1) : "");
  if (/\/reminders\/calendar(\?|$)/.test(path)) return inRange(cachedBody, qs);
  const limit = Number(qs.get("limit") ?? "0");
  let env: Envelope;
  try {
    env = JSON.parse(cachedBody) as Envelope;
  } catch {
    return cachedBody;
  }
  const data = env.data as unknown;
  const holder = !Array.isArray(data) && data && typeof data === "object" && Array.isArray((data as { items?: unknown[] }).items) ? (data as { items: unknown[]; offset?: number; total?: number }) : null;
  const all: unknown[] | null = Array.isArray(data) ? data : holder ? holder.items : null;
  if (!all) return cachedBody;
  // the screens page with offset (or with page, 1-based)
  const offset = qs.has("offset") ? Math.max(0, Number(qs.get("offset")) || 0) : (Math.max(1, Number(qs.get("page") ?? "1") || 1) - 1) * limit;
  const q = (qs.get("q") ?? "").trim().toLowerCase();
  // simple filters, applied when the rows carry the field (a value may be a comma-separated list, as a branch picker sends)
  const active = FILTERS.map((f) => ({ f, want: f.params.map((p) => qs.get(p)).find((v) => v) })).filter((x) => x.want);
  const filtered = all.filter((r) => {
    const row = r as Record<string, unknown>;
    return active.every(({ f, want }) => {
      const have = f.fields.map((k) => row[k]).find((v) => v !== undefined);
      if (have === undefined) return true; // the rows do not carry this field, so it cannot be applied
      if (typeof have !== "string" && typeof have !== "number") return false; // e.g. a packet that is in no locker
      return String(want).split(",").some((w) => w.trim().toLowerCase() === String(have).toLowerCase());
    });
  });
  const rows = q ? filtered.filter((r) => JSON.stringify(r).toLowerCase().includes(q)) : filtered;
  const narrowed = q !== "" || rows.length !== all.length;
  // no paging asked for: the whole list, narrowed by the filters (a loan's pending requests, say). Without this the
  // newest copy of the endpoint was returned whole, so another loan's request looked like this loan's.
  if (!(limit > 0)) {
    if (!narrowed) return cachedBody;
    return JSON.stringify({ ...env, data: holder ? { ...holder, items: rows, total: rows.length } : rows });
  }
  // a paged copy is a window of the server's list that starts at its own offset; a bare array is the whole list
  const windowStart = holder && !narrowed ? Math.max(0, Number(holder.offset) || 0) : 0;
  const from = offset - windowStart;
  const items = from < 0 ? [] : rows.slice(from, from + limit);
  const end = windowStart + rows.length;
  const total = narrowed ? rows.length : typeof holder?.total === "number" ? holder.total : rows.length;
  return JSON.stringify({ ...env, data: { ...(holder ?? {}), items, hasMore: offset + limit < end, limit, offset, total } });
}

export async function recall(path: string, view: string): Promise<string | null> {
  const body = await recallCopy(path, view);
  // A rate published on this PC and not sent yet is the latest rate, even when no rate was ever kept from the server.
  if (/\/gold-rates\/latest(\?|$)/.test(path)) return adjustLatestRate(body);
  if (/\/gold-rates(\?|$)/.test(path)) return adjustRateHistory(path, body);
  // investment plans and investments made on this PC and not sent yet are listed too
  if (/\/investment-plans(\?|$)/.test(path)) return adjustInvestmentPlans(path, body);
  if (/\/users\/\d+\/investments(\?|$)/.test(path)) return adjustInvestments(path, body);
  // personal loans made on this PC and not sent yet are listed as pending ones
  if (/\/personal-loans(\?|$)/.test(path)) return adjustPersonalLoans(path, body);
  // The ledgers (Cash, UPI / Bank Transfer / Cheque, a bank's, an expense category's) list what this PC has entered since the
  // last answer. A category made on this PC has no answer at all, so this runs before the "nothing kept" check below.
  if (LEDGER_PATH.test(path)) return adjustLedger(path, body);
  // The packets of loans made on this PC exist only here until the loan is sent, so they are listed (and opened) even
  // when no packet answer was ever kept; movements waiting to be sent are applied to the rest.
  if (/\/packets\/-?\d+\/movements/.test(path)) return adjustMovements(path, body);
  if (/\/packets(\/by-code\/[^/?]+|\/-?\d+)?(\?|$)/.test(path)) return adjustPackets(path, body);
  // The cash figures and the cash ledger are the server's last answer; what this PC has taken or paid out since
  // (entries still waiting to be sent) is added to them.
  if (body === null) return null;
  if (/\/expenses(\?|$)/.test(path)) return adjustExpenses(path, body);
  if (/\/gold-sales(\?|$)/.test(path)) return adjustGoldSales(path, body);
  if (/\/cash\/summary(\?|$)/.test(path)) return adjustCashSummary(path, body);
  if (/\/cash-movements(\?|$)/.test(path)) return adjustCashMovements(path, body);
  if (/\/banks(\?|$)/.test(path)) return adjustBanks(body);
  // reminders added on this PC that have not been sent yet
  if (/\/reminders\/calendar(\?|$)/.test(path)) return adjustCalendar(path, body);
  if (/\/reminders(\?|$)/.test(path)) return adjustReminders(body);
  // decisions on requests made on this PC and not sent yet
  if (/\/loans\/requests(\?|$)/.test(path)) return adjustRequests(path, body);
  return body;
}

async function recallCopy(path: string, view: string): Promise<string | null> {
  await openForReads();
  const emp = employeeId() ?? 0;
  const exact = await read(exactKey(emp, path, view));
  if (exact) return exact.body;
  const full = await read(familyKey(emp, path, view, "*"));
  if (full) return reshape(full.body, path);
  const big = await read(familyKey(emp, path, view, "big"));
  if (big) return reshape(big.body, path);
  const paged = await read(familyKey(emp, path, view, "paged"));
  if (paged) return reshape(paged.body, path);
  return oneFromList(emp, path, view);
}

/* A single record (a bank's own page) that was never opened online is cut out of the list it belongs to. */
async function oneFromList(emp: number, path: string, view: string): Promise<string | null> {
  const m = /^(\/users\/\d+\/[a-z-]+)\/(\d+)(\?.*)?$/.exec(path);
  if (!m) return null;
  for (const kind of ["*", "big", "paged"] as Kind[]) {
    const hit = await read(familyKey(emp, m[1], view, kind));
    if (!hit) continue;
    try {
      const env = JSON.parse(hit.body) as Envelope;
      const data = env.data as unknown;
      const rows = Array.isArray(data) ? data : Array.isArray((data as { items?: unknown[] } | undefined)?.items) ? (data as { items: unknown[] }).items : [];
      const row = rows.find((r) => (r as { id?: unknown }).id === Number(m[2]));
      if (row) return JSON.stringify({ success: true, data: row });
    } catch {
      /* a copy that cannot be read has nothing to give */
    }
  }
  return null;
}
