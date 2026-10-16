import { apiFetchEnveloped as apiFetch, apiRawFetch, getAuthToken } from "@/common/services/httpClient";
import { uploadFile } from "@/common/services/uploadService";
import { categoryLedgerPath } from "./expenseCategoryService";
import { branchHeader } from "@/common/services/branchSelection";
import type { BackendCashMovement, CashMovementView, CashMovementInput, CashMovementFilters, SelfTransferInput, BackendExpense, ExpenseView, ExpenseFormInput, CashSummary, BackendGoldSale, GoldSaleView, GoldSaleInput, PartyTotals, PartyDateRange, LedgerRowView, BackendLedgerRow, LedgerMode, EntryInfo, EntryUpdateInput } from "@/modules/cash/types/cash-types";

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
    remarks: m.remarks,
    editable: m.editable,
  };
}

export async function listCashMovements(): Promise<CashMovementView[]> {
  const rec = await apiFetch<BackendCashMovement[]>("/cash-movements");
  return (rec || []).map(movementToView);
}

export const CASH_MOVEMENTS_PAGE_SIZE = 8;

function movementFilterParams(filters?: CashMovementFilters): URLSearchParams {
  const params = new URLSearchParams();
  if (filters?.fromDate) params.set("fromDate", filters.fromDate);
  if (filters?.toDate) params.set("toDate", filters.toDate);
  if (filters?.category) params.set("category", filters.category);
  if (filters?.branchIds?.length) params.set("branchIds", filters.branchIds.join(","));
  if (filters?.customerIds?.length) params.set("customerIds", filters.customerIds.join(","));
  if (filters?.types?.length) params.set("types", filters.types.join(","));
  if (filters?.modes?.length) params.set("modes", filters.modes.join(","));
  return params;
}

export async function listCashMovementsPage(
  page: number,
  limit?: number,
  filters?: CashMovementFilters
): Promise<{ items: CashMovementView[]; hasMore: boolean; total: number; totalDebit: number; totalCredit: number; pageBalance: number; rowBalances?: number[] }> {
  const pageSize = limit ?? (typeof window !== "undefined" && (window.innerWidth < 1600 || window.innerHeight < 950) ? 7 : 8);
  const params = movementFilterParams(filters);
  params.set("limit", String(pageSize));
  params.set("offset", String((page - 1) * pageSize));
  const rec = await apiFetch<{ items: BackendCashMovement[]; hasMore: boolean; total?: number; totalDebit?: number; totalCredit?: number; pageBalance?: number; rowBalances?: number[]; row_balances?: number[] }>(`/cash-movements?${params}`);
  // totalDebit/totalCredit: every movement matching the filters, not the page.
  return { items: (rec?.items || []).map(movementToView), hasMore: !!rec?.hasMore, total: rec?.total ?? 0, totalDebit: rec?.totalDebit ?? 0, totalCredit: rec?.totalCredit ?? 0, pageBalance: rec?.pageBalance ?? 0, rowBalances: rec?.rowBalances ?? rec?.row_balances };
}

/* Downloads a file from an endpoint that returns a raw file body (CSV),
 * not the {success, data} envelope apiFetchEnveloped expects — fetched by
 * hand with the same bearer token, then handed to the browser as a real
 * file save via a throwaway object-URL anchor click. */
async function downloadFile(path: string, fallbackFilename: string): Promise<void> {
  const token = getAuthToken();
  const res = await apiRawFetch(`${path}`, {
    headers: { ...(token ? { Authorization: `Bearer ${token}` } : {}), ...branchHeader() },
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

export async function createSelfTransfer(input: SelfTransferInput): Promise<void> {
  await apiFetch<BackendCashMovement[]>("/cash-movements/self-transfer", {
    method: "POST",
    body: JSON.stringify(input),
  });
}

/* The info popup's data for a cash-in, debit or self-transfer ledger row —
 * `id` is the row's cash movement (CashMovementView.id / LedgerRowView.entryId). */
export async function getMovementEntry(id: number): Promise<EntryInfo> {
  return apiFetch<EntryInfo>(`/cash-movements/${id}/entry`);
}

/* Edits a cash-in, debit or self transfer from the ledger: the whole entry
 * (every payment part, or both legs of a self transfer) is replaced by the
 * edited version. Needs no permission of its own. */
export async function updateMovementEntry(id: number, input: EntryUpdateInput): Promise<void> {
  await apiFetch<{ id: number }>(`/cash-movements/${id}/update`, {
    method: "PATCH",
    body: JSON.stringify(input),
  });
}

/* The Expense Register's Edit form data for a pending or approved expense —
 * `id` is the expense id (ExpenseView.id). */
export async function getExpenseEntry(id: number): Promise<EntryInfo> {
  return apiFetch<EntryInfo>(`/expenses/${id}/entry`);
}

/* Saves an edit made in an entry form: from the Expense Register it goes to
 * PATCH /expenses/:id/update, from a ledger row to PATCH /cash-movements/:id/update. */
export async function saveEntryEdit(info: EntryInfo, input: EntryUpdateInput): Promise<void> {
  await apiFetch<{ id: number }>(info.viaExpense ? `/expenses/${info.movementId}/update` : `/cash-movements/${info.movementId}/update`, {
    method: "PATCH",
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
    editable: e.editable,
  };
}

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
  return uploadFile(file);
}

export async function getCashSummary(branchId?: number, date?: string): Promise<CashSummary> {
  const qs = new URLSearchParams();
  if (branchId) qs.set("branchId", String(branchId));
  if (date) qs.set("date", date);
  const suffix = qs.toString() ? `?${qs.toString()}` : "";
  return apiFetch<CashSummary>(`/cash/summary${suffix}`);
}

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

function partyRangeParams(range?: PartyDateRange): URLSearchParams {
  const params = new URLSearchParams();
  if (range?.fromDate) params.set("fromDate", range.fromDate);
  if (range?.toDate) params.set("toDate", range.toDate);
  if (range?.loanNumber) params.set("loanNumber", range.loanNumber);
  if (range?.loanNumbers?.length) params.set("loanNumbers", range.loanNumbers.join(","));
  if (range?.modes?.length) params.set("modes", range.modes.join(","));
  // Opened from another ledger on a transaction: the server answers with the page holding it (focusPage).
  if (range?.focusAmount != null) {
    params.set("focusAmount", String(range.focusAmount));
    if (range.focusDate) params.set("focusDate", range.focusDate);
  }
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
    memo: r.memo,
    entryId: r.entryId,
    editable: r.editable,
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
): Promise<{ items: LedgerRowView[]; total: number; totalDebit: number; totalCredit: number; focusPage?: number }> {
  const params = partyRangeParams(range);
  params.set("limit", String(pageSize));
  params.set("offset", String((page - 1) * pageSize));
  const rec = await apiFetch<{ items: BackendLedgerRow[]; total: number; totalDebit?: number; totalCredit?: number; focusPage?: number }>(`/cash-movements/transactions/customer/${customerId}?${params}`);
  return { items: (rec?.items || []).map(ledgerRowToView), total: rec?.total ?? 0, totalDebit: rec?.totalDebit ?? 0, totalCredit: rec?.totalCredit ?? 0, focusPage: rec?.focusPage };
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
): Promise<{ items: LedgerRowView[]; total: number; totalDebit: number; totalCredit: number; focusPage?: number }> {
  const params = partyRangeParams(range);
  params.set("limit", String(pageSize));
  params.set("offset", String((page - 1) * pageSize));
  const rec = await apiFetch<{ items: BackendLedgerRow[]; total: number; totalDebit?: number; totalCredit?: number; focusPage?: number }>(`/banks/${bankId}/ledger?${params}`);
  return { items: (rec?.items || []).map(ledgerRowToView), total: rec?.total ?? 0, totalDebit: rec?.totalDebit ?? 0, totalCredit: rec?.totalCredit ?? 0, focusPage: rec?.focusPage };
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
): Promise<{ items: LedgerRowView[]; total: number; totalDebit: number; totalCredit: number; focusPage?: number }> {
  const params = partyRangeParams(range);
  if (range?.branchIds?.length) params.set("branchIds", range.branchIds.join(","));
  params.set("limit", String(pageSize));
  params.set("offset", String((page - 1) * pageSize));
  const rec = await apiFetch<{ items: BackendLedgerRow[]; total: number; totalDebit?: number; totalCredit?: number; focusPage?: number }>(`/cash-movements/cash-ledger?${params}`);
  return { items: (rec?.items || []).map(ledgerRowToView), total: rec?.total ?? 0, totalDebit: rec?.totalDebit ?? 0, totalCredit: rec?.totalCredit ?? 0, focusPage: rec?.focusPage };
}

export const LEDGER_MODES = ["Cash", "UPI", "Bank Transfer", "Cheque"] as const;

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
  range?: PartyDateRange & { branchIds?: number[]; bankId?: number; types?: string[] },
  pageSize: number = PARTY_PAGE_SIZE
): Promise<{ items: LedgerRowView[]; total: number; totalDebit: number; totalCredit: number; focusPage?: number }> {
  const params = partyRangeParams(range);
  params.set("mode", mode);
  if (range?.types?.length) params.set("types", range.types.join(","));
  if (range?.bankId) params.set("bankId", String(range.bankId));
  if (range?.branchIds?.length) params.set("branchIds", range.branchIds.join(","));
  params.set("limit", String(pageSize));
  params.set("offset", String((page - 1) * pageSize));
  const rec = await apiFetch<{ items: BackendLedgerRow[]; total: number; totalDebit?: number; totalCredit?: number; focusPage?: number }>(`/cash-movements/mode-ledger?${params}`);
  return { items: (rec?.items || []).map(ledgerRowToView), total: rec?.total ?? 0, totalDebit: rec?.totalDebit ?? 0, totalCredit: rec?.totalCredit ?? 0, focusPage: rec?.focusPage };
}

/* PDF of every row in a ledger matching the date range (and bank/branch
 * narrowing for a mode ledger), ending in a Total Debit/Total Credit line —
 * the same endpoint as the ledger itself, with ?export=pdf. */
export async function downloadLedger(
  kind: "bank" | "customer" | "category" | "mode",
  ref: number | LedgerMode,
  range?: PartyDateRange & { bankId?: number; branchIds?: number[]; types?: string[] }
): Promise<void> {
  const params = partyRangeParams(range);
  params.set("export", "pdf");
  if (range?.types?.length) params.set("types", range.types.join(","));
  if (range?.bankId) params.set("bankId", String(range.bankId));
  if (range?.branchIds?.length) params.set("branchIds", range.branchIds.join(","));
  let path: string;
  if (kind === "bank") path = `/banks/${ref}/ledger`;
  else if (kind === "customer") path = `/cash-movements/transactions/customer/${ref}`;
  else if (kind === "category") path = categoryLedgerPath(ref);  else { params.set("mode", String(ref)); path = "/cash-movements/mode-ledger"; }
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
