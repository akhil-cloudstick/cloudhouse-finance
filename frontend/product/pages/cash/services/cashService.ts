import { apiFetchEnveloped as apiFetch, apiUploadEnveloped as apiUpload, API_BASE, getAuthToken } from "@/product/services/httpClient";

/* Shapes returned by the Go backend (backend/internal/cash/model.go). */
export type BackendCashMovement = {
  id: number;
  type: "in" | "out";
  source?: string;
  purpose?: string;
  // Mode of cash — "Cash" | "UPI" | "Bank Transfer" — required for type=in
  // via AddCashModal.tsx; blank for cash-out and every other movement that
  // doesn't record one (loan repayments, bank-pledge cash-in, …).
  mode?: string;
  bank?: string;
  // The linked bank's own record (backend preloads it) — its name is what the
  // ledger's Ref No column shows for bank-backed rows.
  bankRef?: { id: number; name: string };
  expenseId?: number | null;
  receiptImage?: string; // bill attached to this entry (/uploads/... URL)
  amount: number;
  status?: string;
  branchId?: number | null;
  branch?: { id: number; name: string };
  occurredOn: string;
  createdAt: string;
  // Party Transactions ledger fields — see backend/internal/cash/model.go's
  // CashMovement. transactionGroupId groups several rows from one split
  // payment (see SplitPaymentInput.tsx); bankId/partyCustomerId are the
  // real, queryable identities behind the free-text bank/customer this
  // movement is tied to (nullable — not every movement has either).
  transactionGroupId?: string;
  bankId?: number | null;
  // toBankId is the destination account for a bank-to-bank transfer — see
  // backend/internal/cash/model.go's CashMovement.ToBankID.
  toBankId?: number | null;
  // The other bank of a self transfer (see backend CashMovement.CounterBankID).
  counterBankId?: number | null;
  counterBankRef?: { id: number; name: string };
  partyCustomerId?: number | null;
  // loanSource is only present when source is "Loan" — see
  // backend/internal/cash/model.go's LoanCashSource.
  loanSource?: BackendLoanCashSource;
};

// Mirrors backend/internal/cash/model.go's LoanCashSource — the Loan
// Details block AddCashModal.tsx captures when Source of Cash is "Loan".
export type BackendLoanCashSource = {
  id: number;
  cashMovementId: number;
  bankId: number;
  bank?: { id: number; name: string };
  loanNumber: string;
  principalAmount: number;
  interestRate?: number | null;
  durationMonths?: number | null;
};

export type LoanSourceInput = {
  bankId: number;
  loanNumber: string;
  principalAmount: number;
  interestRate?: number;
  durationMonths?: number;
};

export type CashMovementView = {
  id: number;
  d: string;
  type: "in" | "out";
  source?: string;
  purpose?: string;
  mode?: string;
  bank?: string;
  bankName?: string;
  expenseId?: number | null;
  receiptImage?: string;
  amount: number;
  status?: string;
  branchId?: number | null;
  branchName?: string;
  transactionGroupId?: string;
  bankId?: number | null;
  toBankId?: number | null;
  counterBankId?: number | null;
  counterBankName?: string;
  partyCustomerId?: number | null;
  loanSource?: BackendLoanCashSource;
};

function movementToView(m: BackendCashMovement): CashMovementView {
  return {
    id: m.id,
    d: m.occurredOn.slice(0, 10),
    type: m.type,
    source: m.source,
    purpose: m.purpose,
    mode: m.mode,
    bank: m.bank,
    bankName: m.bankRef?.name || m.bank || undefined,
    expenseId: m.expenseId,
    receiptImage: m.receiptImage,
    amount: m.amount,
    status: m.status,
    branchId: m.branchId,
    branchName: m.branch?.name,
    transactionGroupId: m.transactionGroupId,
    bankId: m.bankId,
    toBankId: m.toBankId,
    counterBankId: m.counterBankId,
    counterBankName: m.counterBankRef?.name,
    partyCustomerId: m.partyCustomerId,
    loanSource: m.loanSource,
  };
}

export type CashMovementInput = {
  type: "in" | "out";
  source?: string;
  purpose?: string;
  mode?: string;
  bank?: string;
  bankId?: number;
  toBankId?: number;
  amount: number;
  branchId?: number;
  occurredOn?: string; // "YYYY-MM-DD"
  loanSource?: LoanSourceInput;
  receiptImage?: string; // bill — /uploads/... URL, from uploadReceipt()
};

export async function listCashMovements(): Promise<CashMovementView[]> {
  const rec = await apiFetch<BackendCashMovement[]>("/cash-movements");
  return (rec || []).map(movementToView);
}

export const CASH_MOVEMENTS_PAGE_SIZE = 8;

// Mirrors backend/internal/cash/repository.go's Category* constants —
// "" (CategoryAll) applies no filter. Kept as a plain string union rather
// than an enum so a stray unrecognized value just falls through to "no
// filter" server-side instead of a client-side type error.
export type CashMovementCategory = "" | "loan" | "auction" | "collection" | "expenses" | "personal loan" | "investment";

export type CashMovementFilters = {
  fromDate?: string;
  toDate?: string;
  category?: CashMovementCategory;
  // branchIds/customerIds/types are the Ledger filter panel's multi-select
  // Branch/Customer/Type sections — separate from the single `category`
  // above (kept for existing single-select callers, e.g. Cash.tsx's legacy
  // state) since a Type section can now have several buckets checked at
  // once.
  branchIds?: string[];
  customerIds?: string[];
  types?: CashMovementCategory[];
};

function movementFilterParams(filters?: CashMovementFilters): URLSearchParams {
  const params = new URLSearchParams();
  if (filters?.fromDate) params.set("fromDate", filters.fromDate);
  if (filters?.toDate) params.set("toDate", filters.toDate);
  if (filters?.category) params.set("category", filters.category);
  if (filters?.branchIds?.length) params.set("branchIds", filters.branchIds.join(","));
  if (filters?.customerIds?.length) params.set("customerIds", filters.customerIds.join(","));
  if (filters?.types?.length) params.set("types", filters.types.join(","));
  return params;
}

export async function listCashMovementsPage(
  page: number,
  limit?: number,
  filters?: CashMovementFilters
): Promise<{ items: CashMovementView[]; hasMore: boolean; total: number; totalDebit: number; totalCredit: number }> {
  const pageSize = limit ?? (typeof window !== "undefined" && (window.innerWidth < 1600 || window.innerHeight < 950) ? 7 : 8);
  const params = movementFilterParams(filters);
  params.set("limit", String(pageSize));
  params.set("offset", String((page - 1) * pageSize));
  const rec = await apiFetch<{ items: BackendCashMovement[]; hasMore: boolean; total?: number; totalDebit?: number; totalCredit?: number }>(`/cash-movements?${params}`);
  // totalDebit/totalCredit: every movement matching the filters, not the page.
  return { items: (rec?.items || []).map(movementToView), hasMore: !!rec?.hasMore, total: rec?.total ?? 0, totalDebit: rec?.totalDebit ?? 0, totalCredit: rec?.totalCredit ?? 0 };
}

/* Downloads a file from an endpoint that returns a raw file body (CSV),
 * not the {success, data} envelope apiFetchEnveloped expects — fetched by
 * hand with the same bearer token, then handed to the browser as a real
 * file save via a throwaway object-URL anchor click. */
async function downloadFile(path: string, fallbackFilename: string): Promise<void> {
  const token = getAuthToken();
  const res = await fetch(`${API_BASE}${path}`, {
    headers: token ? { Authorization: `Bearer ${token}` } : {},
  });
  // A JSON body (even with 200) means no file was produced — saving it would
  // just be a broken PDF.
  if (!res.ok || (res.headers.get("Content-Type") || "").includes("application/json")) {
    throw new Error("Could not download the file. Please try again.");
  }
  const blob = await res.blob();
  const disposition = res.headers.get("Content-Disposition") || "";
  const match = /filename="([^"]+)"/.exec(disposition);
  const filename = match?.[1] || fallbackFilename;
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  // Revoked on the next tick, not synchronously — revoking in the same tick
  // as the click can make Chrome report the download as "Failed".
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

/* Downloads every cash movement matching the given filters as a PDF (the
 * default) or, with format: "xlsx", a spreadsheet — respects
 * fromDate/toDate/category/branchIds/customerIds/types exactly like the
 * table above, but is NEVER capped to a page size: the export always
 * covers the full filtered set, not just whatever's currently paginated
 * into the browser. */
export async function exportCashMovements(filters?: CashMovementFilters & { format?: "pdf" | "xlsx" }): Promise<void> {
  const params = movementFilterParams(filters);
  const format = filters?.format || "pdf";
  if (format === "xlsx") params.set("format", "xlsx");
  const qs = params.toString() ? `?${params.toString()}` : "";
  await downloadFile(`/cash-movements/export${qs}`, `cash-movements.${format}`);
}

/* Downloads every expense-register row (branch-scoped server-side, same as
 * the table) as a PDF. */
export async function exportExpenses(): Promise<void> {
  await downloadFile("/expenses/export", "expense-register.pdf");
}

export async function createCashMovement(input: CashMovementInput): Promise<CashMovementView> {
  const rec = await apiFetch<BackendCashMovement>("/cash-movements", {
    method: "POST",
    body: JSON.stringify(input),
  });
  return movementToView(rec);
}

/* Bank-to-bank self transfer — the backend writes a debit row on the from
 * bank and a credit row on the to bank (see POST /cash-movements/self-transfer).
 * When `category` is a loan source the backend forces the to bank to the
 * loan's own bank, so toBankId is not needed then. */
export type SelfTransferInput = {
  category: string;
  amount: number;
  fromBankId: number;
  fromBank: string;
  toBankId?: number;
  toBank?: string;
  // How the money moved — shown on both rows. "Bank Transfer" when omitted.
  mode?: string;
  receiptImage?: string; // bill — /uploads/... URL
  branchId?: number;
  occurredOn: string;
};

export async function createSelfTransfer(input: SelfTransferInput): Promise<void> {
  await apiFetch<BackendCashMovement[]>("/cash-movements/self-transfer", {
    method: "POST",
    body: JSON.stringify(input),
  });
}

export async function setCashMovementLoanStatus(id: number, status: "Open" | "Closed"): Promise<CashMovementView> {
  const rec = await apiFetch<BackendCashMovement>(`/cash-movements/${id}/status`, {
    method: "PATCH",
    body: JSON.stringify({ status }),
  });
  return movementToView(rec);
}

/* Expense register. */
export type BackendExpense = {
  id: number;
  occurredOn: string;
  category: string;
  amount: number;
  mode: string;
  payee: string;
  // fromBankId/toBankId record an internal transfer between two of the
  // branch's own bank accounts when Mode is UPI/Bank — see
  // backend/internal/cash/model.go's Expense.FromBankID.
  fromBankId?: number | null;
  toBankId?: number | null;
  branchId: number;
  branch?: { id: number; name: string };
  status: "Pending" | "Approved" | "Rejected";
  // The approval-chain stage a Pending expense waits at (e.g. "R4"); empty
  // on rows from before the chain was configurable.
  approvalStage?: string;
  remarks?: string;
  approvedBy?: string;
  approvedAt?: string;
  receiptImage?: string;
  createdAt: string;
};

export type ExpenseView = {
  id: number;
  d: string;
  cat: string;
  amt: number;
  mode: string;
  payee: string;
  fromBankId?: number | null;
  toBankId?: number | null;
  branch: string;
  branchId: number;
  status: "Pending" | "Approved" | "Rejected";
  approvalStage?: string;
  remarks?: string;
  img?: string;
};

function expenseToView(e: BackendExpense): ExpenseView {
  return {
    id: e.id,
    d: e.occurredOn.slice(0, 10),
    cat: e.category,
    amt: e.amount,
    mode: e.mode,
    payee: e.payee,
    fromBankId: e.fromBankId,
    toBankId: e.toBankId,
    branch: e.branch?.name || "",
    branchId: e.branchId,
    status: e.status,
    approvalStage: e.approvalStage,
    remarks: e.remarks,
    img: e.receiptImage,
  };
}

export type ExpenseFormInput = {
  category: string;
  amount: number;
  mode: string;
  payee?: string; // legacy — the form no longer asks for a description
  fromBankId?: number;
  toBankId?: number;
  branchId: number;
  occurredOn?: string; // "YYYY-MM-DD"
  remarks?: string;
  receiptImage?: string; // /uploads/... URL, from uploadReceipt()
};

export async function listExpenses(): Promise<ExpenseView[]> {
  const rec = await apiFetch<BackendExpense[]>("/expenses");
  return (rec || []).map(expenseToView);
}

export const EXPENSES_PAGE_SIZE = 8;

export async function listExpensesPage(page: number, limit?: number): Promise<{ items: ExpenseView[]; hasMore: boolean; total: number; totalAmount: number }> {
  const pageSize = limit ?? (typeof window !== "undefined" && (window.innerWidth < 1600 || window.innerHeight < 950) ? 7 : 8);
  const params = new URLSearchParams({
    limit: String(pageSize),
    offset: String((page - 1) * pageSize),
  });
  const rec = await apiFetch<{ items: BackendExpense[]; hasMore: boolean; total?: number; totalAmount?: number }>(`/expenses?${params}`);
  return { items: (rec?.items || []).map(expenseToView), hasMore: !!rec?.hasMore, total: rec?.total ?? 0, totalAmount: rec?.totalAmount ?? 0 };
}

export async function createExpense(input: ExpenseFormInput): Promise<ExpenseView> {
  const rec = await apiFetch<BackendExpense>("/expenses", {
    method: "POST",
    body: JSON.stringify(input),
  });
  return expenseToView(rec);
}

/* Approve/reject a Pending expense (only raised while the business has the
 * expense approval flow switched on) — permission-checked server-side ("can
 * approve expense"). The approver is taken from the JWT, so no approvedBy is
 * sent. Approving is what posts the expense's cash movement. */
export async function approveExpense(id: number): Promise<ExpenseView> {
  const rec = await apiFetch<BackendExpense>(`/expenses/${id}/approve`, {
    method: "PATCH",
    body: JSON.stringify({}),
  });
  return expenseToView(rec);
}

export async function rejectExpense(id: number, remarks: string): Promise<ExpenseView> {
  const rec = await apiFetch<BackendExpense>(`/expenses/${id}/reject`, {
    method: "PATCH",
    body: JSON.stringify({ remarks }),
  });
  return expenseToView(rec);
}

/* Uploads a receipt/bill image via the shared upload endpoint and returns
 * the resulting URL, ready to pass as ExpenseFormInput.receiptImage. */
export async function uploadReceipt(file: File): Promise<string> {
  const formData = new FormData();
  formData.append("file", file);
  const res = await apiUpload<{ url: string }>("/uploads", formData);
  return res.url;
}

/* Expected Cash in Hand summary — Opening + Collections - Disbursements - Cash Expenses.
 * Opening is carried forward: the previous day's closing Balance in Hand
 * (see cash.SummaryService.openingFor). */
/* Mirrors cash.CashInBreakdown / cash.CashOutBreakdown — the per-source split
 * of the day's `collections` / `disbursements` totals (see
 * cash.MovementRepository.SumBreakdownByDate). */
export type CashInBreakdown = {
  repayments: number;
  pledges: number;
  auctions: number;
  goldSales: number;
  topUps: number;
};

export type CashOutBreakdown = {
  loanDisbursements: number;
  bankReleases: number;
  auctionRefunds: number;
  goldPurchases: number;
  withdrawals: number;
};

export type CashSummary = {
  openingCash: number;
  openingCashSet: boolean;
  collections: number;
  disbursements: number;
  cashExpenses: number;
  expensesToday: number;
  expectedCash: number;
  // Live balances: physical cash in hand (Cash mode) and the combined balance
  // of every bank (UPI / Bank Transfer / Cheque) — no per-bank split.
  cashInHand: number;
  bankBalance: number;
  collectionsBreakdown: CashInBreakdown;
  disbursementsBreakdown: CashOutBreakdown;
};

export async function getCashSummary(branchId?: number, date?: string): Promise<CashSummary> {
  const qs = new URLSearchParams();
  if (branchId) qs.set("branchId", String(branchId));
  if (date) qs.set("date", date);
  const suffix = qs.toString() ? `?${qs.toString()}` : "";
  return apiFetch<CashSummary>(`/cash/summary${suffix}`);
}

/* Gold Sale — the business selling gold it owns (bought stock, NOT a
 * customer's pledged loan collateral — that's the Auction module instead).
 * Mirrors backend/internal/cash/model.go's GoldSale. Every sale also books a
 * matching cash-in movement (source "GoldSale"), so it's reflected in Cash-
 * in-Hand/Expected Cash automatically — no separate step needed here. */
export type BackendGoldSale = {
  id: number;
  ornamentType: string;
  soldAmount: number;
  costAmount: number;
  profit: number;
  soldOn: string;
  branchId: number;
  branch?: { id: number; name: string };
  mode?: string;
  bankId?: number | null;
  bankRef?: { id: number; name: string } | null;
  cashMovementId?: number | null;
  costCashMovementId?: number | null;
  remarks?: string;
  createdAt: string;
};

export type GoldSaleView = {
  id: number;
  d: string;
  ornamentType: string;
  soldAmount: number;
  costAmount: number;
  profit: number;
  branch: string;
  branchId: number;
  mode: string;
  bankId?: number;
  bankName?: string;
  remarks?: string;
};

function goldSaleToView(g: BackendGoldSale): GoldSaleView {
  return {
    id: g.id,
    d: g.soldOn.slice(0, 10),
    ornamentType: g.ornamentType,
    soldAmount: g.soldAmount,
    costAmount: g.costAmount,
    profit: g.profit,
    branch: g.branch?.name || "",
    branchId: g.branchId,
    mode: g.mode || "Cash",
    bankId: g.bankId ?? undefined,
    bankName: g.bankRef?.name,
    remarks: g.remarks,
  };
}

export type GoldSaleInput = {
  ornamentType: string;
  soldAmount: number;
  costAmount: number;
  branchId: number;
  // Mode is how the sale proceeds were received — "Cash" | "UPI" | "Bank
  // Transfer" (see backend GoldSale.Mode's doc comment). Omit for Cash.
  mode?: string;
  // bankId is required when mode is UPI or Bank Transfer.
  bankId?: number;
  soldOn?: string; // "YYYY-MM-DD"
  remarks?: string;
  receiptImage?: string; // bill — /uploads/... URL
};

export const GOLD_SALES_PAGE_SIZE = 8;

export async function listGoldSalesPage(
  page: number,
  limit?: number,
  filters?: { fromDate?: string; toDate?: string }
): Promise<{ items: GoldSaleView[]; hasMore: boolean; total: number; totalSold: number; totalCost: number; totalProfit: number }> {
  const pageSize = limit ?? GOLD_SALES_PAGE_SIZE;
  const params = new URLSearchParams({
    limit: String(pageSize),
    offset: String((page - 1) * pageSize),
  });
  if (filters?.fromDate) params.set("fromDate", filters.fromDate);
  if (filters?.toDate) params.set("toDate", filters.toDate);
  const rec = await apiFetch<{ items: BackendGoldSale[]; hasMore: boolean; total?: number; totalSold?: number; totalCost?: number; totalProfit?: number }>(`/gold-sales?${params}`);
  return {
    items: (rec?.items || []).map(goldSaleToView), hasMore: !!rec?.hasMore, total: rec?.total ?? 0,
    totalSold: rec?.totalSold ?? 0, totalCost: rec?.totalCost ?? 0, totalProfit: rec?.totalProfit ?? 0,
  };
}

export async function createGoldSale(input: GoldSaleInput): Promise<GoldSaleView> {
  const rec = await apiFetch<BackendGoldSale>("/gold-sales", {
    method: "POST",
    body: JSON.stringify(input),
  });
  return goldSaleToView(rec);
}

/* Party Transactions ledger — one bank or customer's full cash-movement
 * history, drilled into from a Cash & Expenses row's bank/customer or from
 * CustomerDetail.tsx's own "Transactions" tab. Page size defaults to 12
 * (the Party Transactions page's own convention, distinct from the app's
 * usual 10) per backend/internal/cash/handler.go's partyPageSize. */
export const PARTY_PAGE_SIZE = 12;

export type PartyTotals = {
  totalIn: number;
  totalOut: number;
  net: number;
  inCount: number;
  outCount: number;
};

// loanNumbers is the customer drilldown's Loan filter, now multi-select —
// loanNumber (singular) is kept for any caller still passing exactly one.
export type PartyDateRange = { fromDate?: string; toDate?: string; loanNumber?: string; loanNumbers?: string[] };

function partyRangeParams(range?: PartyDateRange): URLSearchParams {
  const params = new URLSearchParams();
  if (range?.fromDate) params.set("fromDate", range.fromDate);
  if (range?.toDate) params.set("toDate", range.toDate);
  if (range?.loanNumber) params.set("loanNumber", range.loanNumber);
  if (range?.loanNumbers?.length) params.set("loanNumbers", range.loanNumbers.join(","));
  return params;
}

export async function listCashMovementsByBank(
  bankId: number,
  page: number,
  range?: PartyDateRange,
  pageSize: number = PARTY_PAGE_SIZE
): Promise<{ items: CashMovementView[]; total: number; totals: PartyTotals }> {
  const params = partyRangeParams(range);
  params.set("limit", String(pageSize));
  params.set("offset", String((page - 1) * pageSize));
  const rec = await apiFetch<{ items: BackendCashMovement[]; total: number; totals: PartyTotals }>(`/cash-movements/transactions/bank/${bankId}?${params}`);
  return { items: (rec?.items || []).map(movementToView), total: rec?.total ?? 0, totals: rec?.totals ?? { totalIn: 0, totalOut: 0, net: 0, inCount: 0, outCount: 0 } };
}

/* Combined ledger row shape returned by the customer/bank drill-down
 * endpoints (backend/internal/cash/ledger.go's LedgerRow) — a UNION of
 * CashMovement/LoanPayment/PersonalLoanPayment/GoldSale rows, not just plain
 * cash movements, so it's a distinct type from CashMovementView. Field names
 * mirror backend/internal/loan/service.go's LoanLedgerRow (the single-loan
 * ledger) so both can share one rendering component. */
export type LedgerRowView = {
  id: number;
  d: string;
  description: string;
  type: string;
  method: string;
  reference: string;
  debitOrCredit: "debit" | "credit";
  amount: number;
  runningBalance: number;
  bankId?: number | null;
  bankName?: string;
  customerId?: number;
  customerName?: string;
  receiptImage?: string; // bill attached to the entry behind this row
};

export type BackendLedgerRow = {
  id: number;
  date: string;
  description: string;
  type: string;
  method: string;
  reference: string;
  debitOrCredit: "debit" | "credit";
  amount: number;
  runningBalance: number;
  bankId?: number | null;
  bankName?: string;
  customerId?: number;
  customerName?: string;
  receiptImage?: string;
};

export function ledgerRowToView(r: BackendLedgerRow): LedgerRowView {
  return {
    id: r.id,
    d: r.date.slice(0, 10),
    description: r.description,
    type: r.type,
    method: r.method,
    reference: r.reference,
    debitOrCredit: r.debitOrCredit,
    amount: r.amount,
    runningBalance: r.runningBalance,
    bankId: r.bankId,
    bankName: r.bankName,
    customerId: r.customerId,
    customerName: r.customerName,
    receiptImage: r.receiptImage,
  };
}

/* Customer drill-down now returns the combined ledger (loans, personal
 * loans, gold sales, plain cash movements — see ledger.go's dedup rule),
 * not just CashMovement rows — hence LedgerRowView, not CashMovementView.
 * No `totals` in this envelope (the combined ledger's debit/credit split
 * per row makes a single "totalIn/totalOut" pair the wrong summary shape;
 * callers derive totals by summing debitOrCredit themselves). */
export async function listCashMovementsByCustomer(
  customerId: number,
  page: number,
  range?: PartyDateRange,
  pageSize: number = PARTY_PAGE_SIZE
): Promise<{ items: LedgerRowView[]; total: number; totalDebit: number; totalCredit: number }> {
  const params = partyRangeParams(range);
  params.set("limit", String(pageSize));
  params.set("offset", String((page - 1) * pageSize));
  const rec = await apiFetch<{ items: BackendLedgerRow[]; total: number; totalDebit?: number; totalCredit?: number }>(`/cash-movements/transactions/customer/${customerId}?${params}`);
  return { items: (rec?.items || []).map(ledgerRowToView), total: rec?.total ?? 0, totalDebit: rec?.totalDebit ?? 0, totalCredit: rec?.totalCredit ?? 0 };
}

/* Bank drill-down's combined ledger — same shape/rationale as the customer
 * one above, but its own endpoint (backend/internal/bank has no ledger
 * query of its own; this lives under /banks/:id/ledger, handled by
 * cash.MovementHandler per the ledger.go dedup-rule comment). */
export async function getBankLedger(
  bankId: number,
  page: number,
  range?: PartyDateRange,
  pageSize: number = PARTY_PAGE_SIZE
): Promise<{ items: LedgerRowView[]; total: number; totalDebit: number; totalCredit: number }> {
  const params = partyRangeParams(range);
  params.set("limit", String(pageSize));
  params.set("offset", String((page - 1) * pageSize));
  const rec = await apiFetch<{ items: BackendLedgerRow[]; total: number; totalDebit?: number; totalCredit?: number }>(`/banks/${bankId}/ledger?${params}`);
  return { items: (rec?.items || []).map(ledgerRowToView), total: rec?.total ?? 0, totalDebit: rec?.totalDebit ?? 0, totalCredit: rec?.totalCredit ?? 0 };
}

/* Cash Ledger — the Cash-mode-only sub-ledger drill-down off the Cash
 * entity (backend/internal/cash/ledger.go's ListCashModeLedger): every
 * transaction across loans/personal loans/gold sales/plain cash movements
 * whose mode was pure Cash, as opposed to the bank/customer/loan ledgers
 * which show every mode. Branch-scoped server-side the same way the plain
 * cash-movements list is — a Branch Manager's own branch is locked in
 * automatically; branchIds additionally narrows an Administrator/
 * Management view when they've picked specific branches from the switcher. */
export async function getCashLedger(
  page: number,
  range?: PartyDateRange & { branchIds?: number[] },
  pageSize: number = PARTY_PAGE_SIZE
): Promise<{ items: LedgerRowView[]; total: number; totalDebit: number; totalCredit: number }> {
  const params = partyRangeParams(range);
  if (range?.branchIds?.length) params.set("branchIds", range.branchIds.join(","));
  params.set("limit", String(pageSize));
  params.set("offset", String((page - 1) * pageSize));
  const rec = await apiFetch<{ items: BackendLedgerRow[]; total: number; totalDebit?: number; totalCredit?: number }>(`/cash-movements/cash-ledger?${params}`);
  return { items: (rec?.items || []).map(ledgerRowToView), total: rec?.total ?? 0, totalDebit: rec?.totalDebit ?? 0, totalCredit: rec?.totalCredit ?? 0 };
}

export const LEDGER_MODES = ["Cash", "UPI", "Bank Transfer", "Cheque"] as const;
export type LedgerMode = (typeof LEDGER_MODES)[number];

/* Maps a payment mode to its own ledger's hash route (ModeLedgerPage.tsx) —
 * shared by every ledger table's Mode column (Cash.tsx, PartyLedger.tsx) so
 * clicking a mode drills into that mode's transactions across every source. */
export const MODE_LEDGER_ROUTE: Record<string, string> = {
  Cash: "cash-ledger",
  UPI: "upi-ledger",
  "Bank Transfer": "bank-transfer-ledger",
  Cheque: "cheque-ledger",
};

/* Generic per-payment-mode ledger drill-down (backend/internal/cash/
 * ledger.go's ListModeLedger) — every transaction across loans/personal
 * loans/gold sales/plain cash movements whose mode matches, optionally
 * narrowed to one bank (meaningless for "Cash", which never has a bank of
 * record). getCashLedger above is kept as its own function (rather than
 * every existing caller switching to this with mode="Cash") since it's the
 * one mode callers reach for by name most often; this backs the newer
 * UPI/Bank Transfer/Cheque ledgers (and could replace getCashLedger too). */
export async function getModeLedger(
  mode: LedgerMode,
  page: number,
  range?: PartyDateRange & { branchIds?: number[]; bankId?: number },
  pageSize: number = PARTY_PAGE_SIZE
): Promise<{ items: LedgerRowView[]; total: number; totalDebit: number; totalCredit: number }> {
  const params = partyRangeParams(range);
  params.set("mode", mode);
  if (range?.bankId) params.set("bankId", String(range.bankId));
  if (range?.branchIds?.length) params.set("branchIds", range.branchIds.join(","));
  params.set("limit", String(pageSize));
  params.set("offset", String((page - 1) * pageSize));
  const rec = await apiFetch<{ items: BackendLedgerRow[]; total: number; totalDebit?: number; totalCredit?: number }>(`/cash-movements/mode-ledger?${params}`);
  return { items: (rec?.items || []).map(ledgerRowToView), total: rec?.total ?? 0, totalDebit: rec?.totalDebit ?? 0, totalCredit: rec?.totalCredit ?? 0 };
}

/* PDF of every row in a ledger matching the date range (and bank/branch
 * narrowing for a mode ledger), ending in a Total Debit/Total Credit line —
 * the same endpoint as the ledger itself, with ?export=pdf. */
export async function downloadLedger(
  kind: "bank" | "customer" | "category" | "mode",
  ref: number | LedgerMode,
  range?: PartyDateRange & { bankId?: number; branchIds?: number[] }
): Promise<void> {
  const params = partyRangeParams(range);
  params.set("export", "pdf");
  if (range?.bankId) params.set("bankId", String(range.bankId));
  if (range?.branchIds?.length) params.set("branchIds", range.branchIds.join(","));
  let path: string;
  if (kind === "bank") path = `/banks/${ref}/ledger`;
  else if (kind === "customer") path = `/cash-movements/transactions/customer/${ref}`;
  else if (kind === "category") path = `/expense-categories/${ref}/ledger`;  else { params.set("mode", String(ref)); path = "/cash-movements/mode-ledger"; }
  await downloadFile(`${path}?${params}`, "ledger.pdf");
}

export async function exportPartyStatementByBank(bankId: number, range?: PartyDateRange): Promise<void> {
  const params = partyRangeParams(range);
  const qs = params.toString() ? `?${params.toString()}` : "";
  await downloadFile(`/cash-movements/transactions/bank/${bankId}/export${qs}`, "party-transactions.pdf");
}

export async function exportPartyStatementByCustomer(customerId: number, range?: PartyDateRange): Promise<void> {
  const params = partyRangeParams(range);
  const qs = params.toString() ? `?${params.toString()}` : "";
  await downloadFile(`/cash-movements/transactions/customer/${customerId}/export${qs}`, "party-transactions.pdf");
}

export async function listCashMovementsByBranch(
  branchId: number,
  page: number,
  range?: PartyDateRange,
  pageSize: number = PARTY_PAGE_SIZE
): Promise<{ items: CashMovementView[]; total: number; totals: PartyTotals }> {
  const params = partyRangeParams(range);
  params.set("limit", String(pageSize));
  params.set("offset", String((page - 1) * pageSize));
  const rec = await apiFetch<{ items: BackendCashMovement[]; total: number; totals: PartyTotals }>(`/cash-movements/transactions/branch/${branchId}?${params}`);
  return { items: (rec?.items || []).map(movementToView), total: rec?.total ?? 0, totals: rec?.totals ?? { totalIn: 0, totalOut: 0, net: 0, inCount: 0, outCount: 0 } };
}

export async function exportPartyStatementByBranch(branchId: number, range?: PartyDateRange): Promise<void> {
  const params = partyRangeParams(range);
  const qs = params.toString() ? `?${params.toString()}` : "";
  await downloadFile(`/cash-movements/transactions/branch/${branchId}/export${qs}`, "branch-ledger.pdf");
}
