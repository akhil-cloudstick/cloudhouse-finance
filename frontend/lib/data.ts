/* Ambika Gold Finance — mock data (frontend-only prototype).
 * Ported from legacy/data.js's `window.DB` IIFE. Same shape, same
 * localStorage keys, same mutator functions — behavior is unchanged,
 * only the module system and typing are different. No backend/API calls
 * are introduced here; this stays a client-side, localStorage-backed
 * fake data store until a later stage wires up the Go backend.
 */

export type Rates = { date: string; k24: number; k22: number; k18: number; setBy: string };
export type RateHistoryEntry = { date: string; k24: number; k22: number; k18: number; by: string };
export type Scheme = {
  id: string; name: string; rate: number; duration: string; ltv: number;
  method: string; penal: number; cond: string; active: boolean;
};
export type Customer = {
  id: string; name: string; phone: string; dob: string; addr: string;
  pan: string; aadhaar: string; kyc: string; photo: string; branch: string;
  loans: string[]; since: string;
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
export type Expense = { d: string; cat: string; amt: number; mode: string; payee: string; branch: string; status: string; img?: string };
export type CashMovement = {
  id?: string; d: string; type: string; source?: string; purpose?: string;
  bank?: string; amount: number; status?: string;
};
export type RequestItem = { id: string; type: string; loan: string; cust: string; detail: string; date: string; status: string };
export type Approval = { loan: string; cust: string; amt: number; stage: string; requestedBy: string; date: string };
export type Auction = { loan: string; cust: string; weight: number; outstanding: number; eligible: string; stage: string; notice: string; auctionDate: string; sale: number; venue?: string };
export type Bank = { name: string; branch: string; ifsc: string; pledged: number; amt: number };
export type Employee = { id: string; name: string; role: string; branch: string; loans: number; collections: number; followups: number; pending: number; phone?: string };
export type CalendarEvent = { t: string; c: string };

export type DB = {
  rates: Rates;
  rateHistory: RateHistoryEntry[];
  schemes: Scheme[];
  customers: Customer[];
  loans: Loan[];
  ornaments: Record<string, Ornament[]>;
  ledger: Record<string, LedgerEntry[]>;
  packets: Packet[];
  lockers: Locker[];
  expenses: Expense[];
  cashMovements: CashMovement[];
  requests: RequestItem[];
  approvals: Approval[];
  auctions: Auction[];
  banks: Bank[];
  employees: Employee[];
  calendarEvents: Record<number, CalendarEvent[]>;
  saveRates: (r: Rates) => void;
  addCustomer: (c: Customer) => void;
  saveSchemes: () => void;
  upsertScheme: (id: string | null, vals: Omit<Scheme, "id">) => string;
  addLoan: (loan: Loan, orns: Ornament[]) => boolean;
  saveLockers: () => void;
  addPayment: (loanId: string, entry: LedgerEntry) => boolean;
  saveCashMovements: () => void;
  addCashMovement: (m: CashMovement) => boolean;
  setCashLoanStatus: (id: string, status: string) => boolean;
  addExpense: (e: Expense) => boolean;
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
  const rates = readLS<Rates>("agf_rates", {
    date: "2026-07-30",
    k24: 7285, k22: 6690, k18: 5480,
    setBy: "Rajesh Menon",
  }, hydrate);

  const rateHistory = readLS<RateHistoryEntry[]>("agf_rate_history", [
    { date: "2026-07-30", k24: 7285, k22: 6690, k18: 5480, by: "Rajesh Menon" },
    { date: "2026-07-29", k24: 7260, k22: 6668, k18: 5462, by: "Rajesh Menon" },
    { date: "2026-07-28", k24: 7292, k22: 6697, k18: 5486, by: "Anitha K" },
    { date: "2026-07-27", k24: 7248, k22: 6656, k18: 5452, by: "Rajesh Menon" },
    { date: "2026-07-26", k24: 7231, k22: 6641, k18: 5440, by: "Anitha K" },
    { date: "2026-07-25", k24: 7214, k22: 6625, k18: 5427, by: "Rajesh Menon" },
    { date: "2026-07-24", k24: 7196, k22: 6608, k18: 5413, by: "Rajesh Menon" },
  ], hydrate);

  const schemes = readLS<Scheme[]>("agf_schemes", [], hydrate);
  schemes.forEach((s) => { if (s.penal == null) s.penal = 2; });

  const storedCustomers = readLS<Customer[]>("agf_new_customers", [], hydrate);
  const customers: Customer[] = [
    ...storedCustomers,
    { id: "CUST-1001", name: "Suresh Kumar", phone: "98470 12345", dob: "1978-04-11", addr: "Koratty, Thrissur", pan: "V", aadhaar: "V", kyc: "Verified", photo: "SK", branch: "Koratty", loans: ["GL-2041", "GL-1968"], since: "2024-02-18" },
    { id: "CUST-1002", name: "Lakshmi Menon", phone: "94960 22331", dob: "1985-09-02", addr: "Chalakudy, Thrissur", pan: "V", aadhaar: "V", kyc: "Verified", photo: "LM", branch: "Koratty", loans: ["GL-2044"], since: "2024-06-30" },
    { id: "CUST-1003", name: "Abdul Rasheed", phone: "99610 77812", dob: "1971-01-23", addr: "Angamaly, Ernakulam", pan: "V", aadhaar: "P", kyc: "Pending", photo: "AR", branch: "Angamaly", loans: ["GL-2046"], since: "2025-01-12" },
    { id: "CUST-1004", name: "Meera Krishnan", phone: "90728 44120", dob: "1990-12-05", addr: "Mala, Thrissur", pan: "V", aadhaar: "V", kyc: "Verified", photo: "MK", branch: "Koratty", loans: ["GL-2038", "GL-2049"], since: "2023-11-02" },
    { id: "CUST-1005", name: "Thomas George", phone: "85900 31576", dob: "1968-07-19", addr: "Kodakara, Thrissur", pan: "F", aadhaar: "V", kyc: "Failed", photo: "TG", branch: "Kodakara", loans: ["GL-2029"], since: "2025-03-08" },
    { id: "CUST-1006", name: "Priya Nair", phone: "96334 90218", dob: "1993-05-27", addr: "Koratty, Thrissur", pan: "V", aadhaar: "V", kyc: "Verified", photo: "PN", branch: "Koratty", loans: ["GL-2051"], since: "2025-07-21" },
    { id: "CUST-1007", name: "Rahim Sait", phone: "80869 11402", dob: "1975-10-30", addr: "Perumbavoor, EKM", pan: "P", aadhaar: "P", kyc: "Pending", photo: "RS", branch: "Angamaly", loans: [], since: "2026-07-28" },
    { id: "CUST-1008", name: "Ananya Pillai", phone: "97455 63308", dob: "1988-03-14", addr: "Chalakudy, Thrissur", pan: "V", aadhaar: "V", kyc: "Verified", photo: "AP", branch: "Kodakara", loans: ["GL-2035"], since: "2024-09-15" },
  ];

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
  function addCustomer(c: Customer) {
    customers.unshift(c);
    const stored = readLS<Customer[]>("agf_new_customers", [], true);
    stored.unshift(c);
    writeLS("agf_new_customers", stored);
  }

  const storedLoans = readLS<Loan[]>("agf_new_loans", [], hydrate);
  const storedOrns = readLS<Record<string, Ornament[]>>("agf_new_ornaments", {}, hydrate);

  const loans: Loan[] = [
    ...storedLoans,
    { id: "GL-2051", cust: "CUST-1006", scheme: "SCH-03", opened: "2026-07-28", due: "2026-10-28", principal: 118000, outstanding: 118472, weight: 24.6, status: "Active", pledge: "Not Pledged", packet: "PKT-2051", locker: "LKR-A2" },
    { id: "GL-2049", cust: "CUST-1004", scheme: "SCH-02", opened: "2026-07-22", due: "2027-01-22", principal: 236000, outstanding: 237430, weight: 44.1, status: "Active", pledge: "Not Pledged", packet: "PKT-2049", locker: "LKR-A1" },
    { id: "GL-2046", cust: "CUST-1003", scheme: "SCH-01", opened: "2026-07-14", due: "2027-07-14", principal: 87500, outstanding: 88010, weight: 17.4, status: "Pending Approval", pledge: "Not Pledged", packet: "—", locker: "—" },
    { id: "GL-2044", cust: "CUST-1002", scheme: "SCH-01", opened: "2026-06-19", due: "2027-06-19", principal: 152000, outstanding: 153980, weight: 30.3, status: "Active", pledge: "Bank Pledged", packet: "PKT-2044", locker: "Bank: SIB Koratty", bank: "South Indian Bank", bankRef: "SIB/RPL/8821" },
    { id: "GL-2041", cust: "CUST-1001", scheme: "SCH-02", opened: "2026-05-30", due: "2026-11-30", principal: 195000, outstanding: 199120, weight: 36.2, status: "Due Soon", pledge: "Not Pledged", packet: "PKT-2041", locker: "LKR-B1" },
    { id: "GL-2038", cust: "CUST-1004", scheme: "SCH-03", opened: "2026-04-25", due: "2026-07-25", principal: 64000, outstanding: 66890, weight: 12.9, status: "Overdue", pledge: "Not Pledged", packet: "PKT-2038", locker: "LKR-A2" },
    { id: "GL-2035", cust: "CUST-1008", scheme: "SCH-01", opened: "2026-03-12", due: "2027-03-12", principal: 143000, outstanding: 141200, weight: 28.7, status: "Active", pledge: "Bank Pledged", packet: "PKT-2035", locker: "Bank: Federal Bank", bank: "Federal Bank", bankRef: "FED/RPL/4410" },
    { id: "GL-2029", cust: "CUST-1005", scheme: "SCH-02", opened: "2025-12-04", due: "2026-06-04", principal: 98000, outstanding: 109350, weight: 19.8, status: "Auction Eligible", pledge: "Not Pledged", packet: "PKT-2029", locker: "LKR-C1" },
    { id: "GL-1968", cust: "CUST-1001", scheme: "SCH-01", opened: "2025-06-10", due: "2026-06-10", principal: 75000, outstanding: 0, weight: 15.1, status: "Closed", pledge: "Released", packet: "Released", locker: "—" },
  ];

  const ornaments: Record<string, Ornament[]> = {
    "GL-2051": [{ n: "Gold Chain", purity: "22K", gross: 12.4, net: 12.1, qty: 1, val: 80949 }, { n: "Bangle Pair", purity: "22K", gross: 12.6, net: 12.5, qty: 2, val: 83625 }],
    "GL-2049": [{ n: "Necklace", purity: "22K", gross: 28.3, net: 27.8, qty: 1, val: 185982 }, { n: "Ring", purity: "22K", gross: 8.4, net: 8.2, qty: 2, val: 54858 }, { n: "Earring Set", purity: "18K", gross: 8.5, net: 8.1, qty: 1, val: 44388 }],
    "GL-2046": [{ n: "Bangle", purity: "22K", gross: 17.8, net: 17.4, qty: 2, val: 116406 }],
    "GL-2044": [{ n: "Chain", purity: "22K", gross: 19.1, net: 18.7, qty: 1, val: 125103 }, { n: "Pendant", purity: "22K", gross: 12.0, net: 11.6, qty: 1, val: 77604 }],
    "GL-2041": [{ n: "Necklace", purity: "22K", gross: 24.8, net: 24.2, qty: 1, val: 161898 }, { n: "Ring", purity: "22K", gross: 6.4, net: 6.2, qty: 3, val: 41478 }],
    "GL-2038": [{ n: "Bracelet", purity: "22K", gross: 13.4, net: 12.9, qty: 1, val: 86301 }],
    "GL-2035": [{ n: "Chain", purity: "22K", gross: 16.5, net: 16.1, qty: 1, val: 107709 }, { n: "Stud Pair", purity: "22K", gross: 7.2, net: 7.0, qty: 1, val: 46830 }, { n: "Ring", purity: "18K", gross: 6.0, net: 5.6, qty: 2, val: 30688 }],
    "GL-2029": [{ n: "Chain", purity: "22K", gross: 20.6, net: 19.8, qty: 1, val: 132462 }],
    "GL-1968": [{ n: "Bangle", purity: "22K", gross: 15.6, net: 15.1, qty: 2, val: 101019 }],
    ...storedOrns,
  };

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

  const ledger: Record<string, LedgerEntry[]> = {
    "GL-2041": [
      { d: "2026-05-30", desc: "Loan disbursed", debit: 195000, credit: 0, mode: "Cash", ref: "DSB-2041" },
      { d: "2026-06-30", desc: "Interest payment", debit: 0, credit: 2356, mode: "UPI", ref: "PAY-8812" },
      { d: "2026-07-30", desc: "Interest accrued (July)", debit: 2356, credit: 0, mode: "—", ref: "INT-0726" },
    ],
    "GL-2038": [
      { d: "2026-04-25", desc: "Loan disbursed", debit: 64000, credit: 0, mode: "Cash", ref: "DSB-2038" },
      { d: "2026-05-25", desc: "Interest payment", debit: 0, credit: 853, mode: "Cash", ref: "PAY-8571" },
      { d: "2026-07-25", desc: "Penal interest applied", debit: 1280, credit: 0, mode: "—", ref: "PNL-0311" },
    ],
  };
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

  const packets: Packet[] = [
    { id: "PKT-2051", loan: "GL-2051", cust: "Priya Nair", items: 2, weight: 24.6, locker: "LKR-A2", status: "Locker Stored", qr: "AGF-PKT-2051" },
    { id: "PKT-2049", loan: "GL-2049", cust: "Meera Krishnan", items: 4, weight: 44.1, locker: "LKR-A1", status: "Locker Stored", qr: "AGF-PKT-2049" },
    { id: "PKT-2044", loan: "GL-2044", cust: "Lakshmi Menon", items: 2, weight: 30.3, locker: "SIB Koratty", status: "Bank Pledged", qr: "AGF-PKT-2044" },
    { id: "PKT-2041", loan: "GL-2041", cust: "Suresh Kumar", items: 4, weight: 36.2, locker: "LKR-B1", status: "Locker Stored", qr: "AGF-PKT-2041" },
    { id: "PKT-2038", loan: "GL-2038", cust: "Meera Krishnan", items: 1, weight: 12.9, locker: "LKR-A2", status: "Locker Stored", qr: "AGF-PKT-2038" },
    { id: "PKT-2035", loan: "GL-2035", cust: "Ananya Pillai", items: 4, weight: 28.7, locker: "Federal Bank", status: "Bank Pledged", qr: "AGF-PKT-2035" },
    { id: "PKT-2029", loan: "GL-2029", cust: "Thomas George", items: 1, weight: 19.8, locker: "LKR-C1", status: "Ready for Release", qr: "AGF-PKT-2029" },
  ];

  const lockers = readLS<Locker[]>("agf_lockers", [
    { id: "LKR-A1", branch: "Koratty", packets: 1, cap: 40, status: "Active" },
    { id: "LKR-A2", branch: "Koratty", packets: 2, cap: 40, status: "Active" },
    { id: "LKR-B1", branch: "Angamaly", packets: 1, cap: 30, status: "Active" },
    { id: "LKR-C1", branch: "Kodakara", packets: 1, cap: 30, status: "Active" },
  ], hydrate);
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

  const storedExpenses = readLS<Expense[]>("agf_expenses", [], hydrate);
  const expenses: Expense[] = [
    ...storedExpenses,
    { d: "2026-07-30", cat: "Rent & Utilities", amt: 18500, mode: "Bank", payee: "KSEB / Landlord", branch: "Koratty", status: "Approved" },
    { d: "2026-07-29", cat: "Salaries", amt: 96000, mode: "Bank", payee: "Staff payroll", branch: "All", status: "Approved" },
    { d: "2026-07-29", cat: "Transportation", amt: 1450, mode: "Cash", payee: "Gold movement — SIB", branch: "Koratty", status: "Approved" },
    { d: "2026-07-28", cat: "Marketing", amt: 7500, mode: "UPI", payee: "Local ads", branch: "Koratty", status: "Pending" },
    { d: "2026-07-27", cat: "Bank Charges", amt: 820, mode: "Bank", payee: "SIB", branch: "Angamaly", status: "Approved" },
    { d: "2026-07-26", cat: "Maintenance", amt: 3200, mode: "Cash", payee: "AC service", branch: "Kodakara", status: "Approved" },
  ];

  function addExpense(e: Expense): boolean {
    expenses.unshift(e);
    storedExpenses.unshift(e);
    try {
      writeLS("agf_expenses", storedExpenses);
      return true;
    } catch {
      if (e.img) {
        delete e.img;
        try { writeLS("agf_expenses", storedExpenses); return true; } catch { /* fallthrough */ }
      }
      expenses.shift();
      storedExpenses.shift();
      return false;
    }
  }

  const cashMovements = readLS<CashMovement[]>("agf_cash_movements", [], hydrate);
  function saveCashMovements() { writeLS("agf_cash_movements", cashMovements); }
  function addCashMovement(m: CashMovement): boolean {
    m.id = "CSH-" + Date.now().toString(36).toUpperCase();
    cashMovements.unshift(m);
    try { saveCashMovements(); return true; } catch { return false; }
  }
  function setCashLoanStatus(id: string, status: string): boolean {
    const m = cashMovements.find((x) => x.id === id);
    if (!m) return false;
    m.status = status;
    try { saveCashMovements(); return true; } catch { return false; }
  }

  const requests: RequestItem[] = [
    { id: "REQ-311", type: "Extension", loan: "GL-2041", cust: "Suresh Kumar", detail: "Extend by 3 months", date: "2026-07-29", status: "Pending" },
    { id: "REQ-310", type: "Release", loan: "GL-2029", cust: "Thomas George", detail: "Full settlement & gold release", date: "2026-07-28", status: "Pending" },
    { id: "REQ-309", type: "Extension", loan: "GL-2038", cust: "Meera Krishnan", detail: "Extend by 1 month", date: "2026-07-27", status: "Pending" },
    { id: "REQ-305", type: "Release", loan: "GL-1968", cust: "Suresh Kumar", detail: "Closure — released 12/06", date: "2026-06-10", status: "Completed" },
  ];

  const approvals: Approval[] = [
    { loan: "GL-2046", cust: "Abdul Rasheed", amt: 87500, stage: "Branch Manager", requestedBy: "Deepak (Operator)", date: "2026-07-30" },
  ];

  const auctions: Auction[] = [
    { loan: "GL-2029", cust: "Thomas George", weight: 19.8, outstanding: 109350, eligible: "2026-07-04", stage: "Notice Issued", notice: "2026-07-18", auctionDate: "—", sale: 0 },
  ];
  const auctionUpdates = readLS<Record<string, Partial<Auction>>>("agf_auction_updates", {}, hydrate);
  auctions.forEach((a) => { if (auctionUpdates[a.loan]) Object.assign(a, auctionUpdates[a.loan]); });

  function updateAuction(loan: string, fields: Partial<Auction>): boolean {
    const a = auctions.find((x) => x.loan === loan);
    if (!a) return false;
    Object.assign(a, fields);
    auctionUpdates[loan] = Object.assign(auctionUpdates[loan] || {}, fields);
    try { writeLS("agf_auction_updates", auctionUpdates); return true; } catch { return false; }
  }

  const banks: Bank[] = [
    { name: "South Indian Bank", branch: "Koratty", ifsc: "SIBL0000221", pledged: 1, amt: 130000 },
    { name: "Federal Bank", branch: "Chalakudy", ifsc: "FDRL0001443", pledged: 1, amt: 98000 },
  ];

  const storedEmployees = readLS<Employee[]>("agf_employees", [], hydrate);
  const employees: Employee[] = [
    { id: "EMP-01", name: "Rajesh Menon", role: "Administrator", branch: "Koratty", loans: 64, collections: 842000, followups: 38, pending: 2 },
    { id: "EMP-02", name: "Anitha K", role: "Branch Manager", branch: "Koratty", loans: 51, collections: 611500, followups: 52, pending: 4 },
    { id: "EMP-03", name: "Deepak S", role: "Loan Operator", branch: "Angamaly", loans: 47, collections: 388200, followups: 61, pending: 6 },
    { id: "EMP-04", name: "Sindhu R", role: "Cashier", branch: "Koratty", loans: 0, collections: 912400, followups: 12, pending: 1 },
    { id: "EMP-05", name: "Vipin T", role: "Collection Staff", branch: "Kodakara", loans: 0, collections: 214800, followups: 89, pending: 9 },
    ...storedEmployees,
  ];

  function addEmployee(e: Omit<Employee, "id">): string | null {
    const nextNum = Math.max(...employees.map((x) => +String(x.id).replace("EMP-", "") || 0)) + 1;
    const withId: Employee = { ...e, id: "EMP-" + String(nextNum).padStart(2, "0") };
    employees.push(withId);
    storedEmployees.push(withId);
    try { writeLS("agf_employees", storedEmployees); return withId.id; }
    catch { employees.pop(); storedEmployees.pop(); return null; }
  }

  const calendarEvents: Record<number, CalendarEvent[]> = {
    2: [{ t: "GL-2044 interest due", c: "due" }],
    4: [{ t: "GL-2029 auction review", c: "over" }],
    7: [{ t: "Follow-up: T George", c: "fup" }],
    12: [{ t: "GL-2035 interest due", c: "due" }],
    15: [{ t: "PTP: Suresh Kumar", c: "fup" }],
    22: [{ t: "GL-2049 interest due", c: "due" }],
    25: [{ t: "GL-2038 OVERDUE", c: "over" }, { t: "Follow-up: M Krishnan", c: "fup" }],
    28: [{ t: "GL-2051 interest due", c: "due" }],
    30: [{ t: "GL-2041 interest rcvd", c: "pay" }],
  };

  function saveRates(r: Rates) {
    writeLS("agf_rates", r);
    rateHistory.unshift({ date: r.date, k24: r.k24, k22: r.k22, k18: r.k18, by: r.setBy });
    writeLS("agf_rate_history", rateHistory.slice(0, 30));
  }

  return {
    rates, rateHistory, schemes, customers, loans, ornaments, ledger, packets, lockers,
    expenses, cashMovements, requests, approvals, auctions, banks, employees, calendarEvents,
    saveRates, addCustomer, saveSchemes, upsertScheme, addLoan, saveLockers, addPayment,
    saveCashMovements, addCashMovement, setCashLoanStatus, addExpense, addEmployee,
    updateLoan, updateAuction, addLocker, removeLocker,
  };
}
