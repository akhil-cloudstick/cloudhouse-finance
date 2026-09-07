/* Chittilapilly Thommana Financiers & Investments — mock data (frontend-only prototype).
 * Ported from legacy/data.js's `window.DB` IIFE. Same shape, same
 * localStorage keys, same mutator functions — behavior is unchanged,
 * only the module system and typing are different. No backend/API calls
 * are introduced here; this stays a client-side, localStorage-backed
 * fake data store until a later stage wires up the Go backend.
 */

export type Scheme = {
  id: string; name: string; rate: number; duration: string; ltv: number;
  method: string; penal: number; cond: string; active: boolean;
};
export type Loan = {
  id: string; cust: string; scheme: string; opened: string; due: string;
  principal: number; outstanding: number; weight: number; status: string;
  pledge: string; packet: string; locker: string; bank?: string; bankRef?: string;
  pledgeDate?: string; pledgeAmt?: number;
};
export type Ornament = { n: string; purity: string; gross: number; net: number; qty: number; val: number; img?: string };
export type LedgerEntry = { d: string; desc: string; debit: number; credit: number; mode: string; ref: string };
export type Packet = { id: string; loan: string; cust: string; items: number; weight: number; locker: string; status: string; qr: string };
export type Locker = { id: string; branch: string; packets: number; cap: number; status: string };
export type RequestItem = { id: string; type: string; loan: string; cust: string; detail: string; date: string; status: string };
export type Approval = { loan: string; cust: string; amt: number; stage: string; requestedBy: string; date: string };
export type Auction = { loan: string; cust: string; weight: number; outstanding: number; eligible: string; stage: string; notice: string; auctionDate: string; sale: number; venue?: string };
export type Bank = { name: string; branch: string; ifsc: string; pledged: number; amt: number };
export type Employee = { id: string; name: string; role: string; branch: string; loans: number; collections: number; followups: number; pending: number; phone?: string };
export type CalendarEvent = { t: string; c: string };

export type DB = {
  schemes: Scheme[];
  loans: Loan[];
  ornaments: Record<string, Ornament[]>;
  ledger: Record<string, LedgerEntry[]>;
  packets: Packet[];
  lockers: Locker[];
  requests: RequestItem[];
  approvals: Approval[];
  auctions: Auction[];
  banks: Bank[];
  employees: Employee[];
  calendarEvents: Record<number, CalendarEvent[]>;
  saveSchemes: () => void;
  upsertScheme: (id: string | null, vals: Omit<Scheme, "id">) => string;
  addLoan: (loan: Loan, orns: Ornament[]) => boolean;
  saveLockers: () => void;
  addPayment: (loanId: string, entry: LedgerEntry) => boolean;
  addEmployee: (e: Omit<Employee, "id">) => string | null;
  updateLoan: (loanId: string, fields: Partial<Loan>) => boolean;
  updateAuction: (loan: string, fields: Partial<Auction>) => boolean;
  addLocker: (locker: { id: string; branch: string; cap: number }) => { ok: true } | { ok: false; error: string };
  removeLocker: (id: string) => { ok: true } | { ok: false; error: string };
};

function readLS<T>(key: string, fallback: T, hydrate: boolean): T {
  if (!hydrate || typeof window === "undefined") return fallback;
  try {
    const raw = window.localStorage.getItem(key);
    return raw ? (JSON.parse(raw) as T) : fallback;
  } catch {
    return fallback;
  }
}

function writeLS(key: string, value: unknown) {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(key, JSON.stringify(value));
  } catch {
    /* quota exceeded or unavailable — same silent-fail behavior as legacy code */
  }
}

/**
 * Builds the DB object. When `hydrate` is false (used for the very first
 * render, including the static-export prerender pass, which has no
 * `localStorage`), only the hardcoded seed data is used. Call again with
 * `hydrate: true` after mount (client-only) to merge in real localStorage
 * data — this two-pass approach avoids SSR/hydration mismatches.
 */
export function createDB(hydrate: boolean): DB {
  const schemes = readLS<Scheme[]>("agf_schemes", [], hydrate);
  schemes.forEach((s) => { if (s.penal == null) s.penal = 2; });

  function saveSchemes() { writeLS("agf_schemes", schemes); }
  function upsertScheme(id: string | null, vals: Omit<Scheme, "id">): string {
    if (id) {
      const existing = schemes.find((x) => x.id === id);
      if (existing) Object.assign(existing, vals);
      saveSchemes();
      return id;
    }
    const nums = schemes.map((x) => parseInt(x.id.replace("SCH-", ""), 10) || 0);
    const nid = "SCH-" + String(Math.max(0, ...nums) + 1).padStart(2, "0");
    schemes.push(Object.assign({ id: nid }, vals));
    saveSchemes();
    return nid;
  }
  const storedLoans = readLS<Loan[]>("agf_new_loans", [], hydrate);
  const storedOrns = readLS<Record<string, Ornament[]>>("agf_new_ornaments", {}, hydrate);

  const loans: Loan[] = [...storedLoans];

  const ornaments: Record<string, Ornament[]> = { ...storedOrns };

  function addLoan(loan: Loan, orns: Ornament[]): boolean {
    loans.unshift(loan);
    storedLoans.unshift(loan);
    ornaments[loan.id] = orns;
    storedOrns[loan.id] = orns;
    try {
      writeLS("agf_new_loans", storedLoans);
      writeLS("agf_new_ornaments", storedOrns);
      return true;
    } catch { return false; }
  }

  const storedLedger = readLS<Record<string, LedgerEntry[]>>("agf_ledger_extra", {}, hydrate);
  const loanOverrides = readLS<Record<string, Partial<Loan>>>("agf_loan_overrides", {}, hydrate);
  loans.forEach((l) => { if (loanOverrides[l.id]) Object.assign(l, loanOverrides[l.id]); });

  const ledger: Record<string, LedgerEntry[]> = {};
  Object.keys(storedLedger).forEach((id) => {
    ledger[id] = (ledger[id] || []).concat(storedLedger[id]);
  });

  function updateLoan(loanId: string, fields: Partial<Loan>): boolean {
    const l = loans.find((x) => x.id === loanId);
    if (!l) return false;
    Object.assign(l, fields);
    loanOverrides[loanId] = Object.assign(loanOverrides[loanId] || {}, fields);
    try { writeLS("agf_loan_overrides", loanOverrides); return true; } catch { return false; }
  }

  function addPayment(loanId: string, entry: LedgerEntry): boolean {
    (ledger[loanId] = ledger[loanId] || []).push(entry);
    (storedLedger[loanId] = storedLedger[loanId] || []).push(entry);
    const l = loans.find((x) => x.id === loanId);
    if (l && entry.credit) {
      l.outstanding = Math.max(0, (l.outstanding || 0) - entry.credit);
      loanOverrides[loanId] = { outstanding: l.outstanding };
    }
    try {
      writeLS("agf_ledger_extra", storedLedger);
      writeLS("agf_loan_overrides", loanOverrides);
      return true;
    } catch { return false; }
  }

  const packets: Packet[] = [];

  const lockers = readLS<Locker[]>("agf_lockers", [], hydrate);
  function saveLockers() { writeLS("agf_lockers", lockers); }

  /* Ported from legacy/app.js's `saveNewLocker()` / `removeLocker()` — the
   * array push/splice was inlined there; here it's wrapped as proper
   * mutators since React components shouldn't mutate `db.lockers` directly. */
  function addLocker(locker: { id: string; branch: string; cap: number }): { ok: true } | { ok: false; error: string } {
    if (!/^[A-Z0-9-]{3,15}$/.test(locker.id)) {
      return { ok: false, error: "Please enter a locker ID (letters, numbers, dashes — e.g. LKR-B2)." };
    }
    if (lockers.some((l) => l.id === locker.id)) {
      return { ok: false, error: `Locker ${locker.id} already exists.` };
    }
    if (!(locker.cap >= 1)) {
      return { ok: false, error: "Please enter a valid capacity." };
    }
    if (!locker.branch) {
      return { ok: false, error: "Please enter a branch." };
    }
    lockers.push({ id: locker.id, branch: locker.branch, packets: 0, cap: locker.cap, status: "Active" });
    saveLockers();
    return { ok: true };
  }

  function removeLocker(id: string): { ok: true } | { ok: false; error: string } {
    const l = lockers.find((x) => x.id === id);
    if (!l) return { ok: false, error: "Locker not found." };
    const inUse = l.packets > 0 || packets.some((p) => p.locker === id) || loans.some((x) => x.locker === id);
    if (inUse) return { ok: false, error: `${id} has packets assigned — move them out before removing` };
    lockers.splice(lockers.indexOf(l), 1);
    saveLockers();
    return { ok: true };
  }

  const requests: RequestItem[] = [];

  const approvals: Approval[] = [];

  const auctions: Auction[] = [];
  const auctionUpdates = readLS<Record<string, Partial<Auction>>>("agf_auction_updates", {}, hydrate);
  auctions.forEach((a) => { if (auctionUpdates[a.loan]) Object.assign(a, auctionUpdates[a.loan]); });

  function updateAuction(loan: string, fields: Partial<Auction>): boolean {
    const a = auctions.find((x) => x.loan === loan);
    if (!a) return false;
    Object.assign(a, fields);
    auctionUpdates[loan] = Object.assign(auctionUpdates[loan] || {}, fields);
    try { writeLS("agf_auction_updates", auctionUpdates); return true; } catch { return false; }
  }

  const banks: Bank[] = [];

  const storedEmployees = readLS<Employee[]>("agf_employees", [], hydrate);
  const employees: Employee[] = [...storedEmployees];

  function addEmployee(e: Omit<Employee, "id">): string | null {
    const nextNum = Math.max(0, ...employees.map((x) => +String(x.id).replace("EMP-", "") || 0)) + 1;
    const withId: Employee = { ...e, id: "EMP-" + String(nextNum).padStart(2, "0") };
    employees.push(withId);
    storedEmployees.push(withId);
    try { writeLS("agf_employees", storedEmployees); return withId.id; }
    catch { employees.pop(); storedEmployees.pop(); return null; }
  }

  const calendarEvents: Record<number, CalendarEvent[]> = {};

  return {
    schemes, loans, ornaments, ledger, packets, lockers,
    requests, approvals, auctions, banks, employees, calendarEvents,
    saveSchemes, upsertScheme, addLoan, saveLockers, addPayment, addEmployee,
    updateLoan, updateAuction, addLocker, removeLocker,
  };
}
