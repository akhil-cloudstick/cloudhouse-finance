import * as FileSystem from "expo-file-system/legacy";
import * as Sharing from "expo-sharing";
import { API_BASE_URL, apiUrl, ApiError } from "@/common/services/httpClient";
import { getToken } from "@/common/services/tokenStorage";
import type { LedgerKind } from "@/modules/cash/types/cash-types";

// Mobile counterpart of the web ledgers' Download button (cashService.ts's
// downloadLedger): the same ledger endpoints with ?export=pdf, which the
// backend (cash/handler.go's respondLedger) renders as a PDF of every row
// matching the date filter. Downloaded into the cache dir, then handed to the
// native share sheet — same pattern as schemeStatement.ts.
function ledgerPath(kind: LedgerKind, ref: string, params: URLSearchParams): string {
  switch (kind) {
    case "bank":
      return `/banks/${ref}/ledger`;
    case "customer":
      return `/cash-movements/transactions/customer/${ref}`;
    case "category":
      return `/expense-categories/${ref}/ledger`;
    case "mode":
      params.set("mode", ref);
      return "/cash-movements/mode-ledger";
  }
}

export async function shareLedgerPdf(kind: LedgerKind, ref: string, range: { fromDate?: string; toDate?: string }, title: string, extra?: { bankId?: number; branchIds?: string; modes?: string; types?: string; loanNumbers?: string }) {
  const params = new URLSearchParams({ export: "pdf" });
  if (extra?.bankId) params.set("bankId", String(extra.bankId));
  if (extra?.branchIds) params.set("branchIds", extra.branchIds);
  if (extra?.modes) params.set("modes", extra.modes);
  if (extra?.types) params.set("types", extra.types);
  if (extra?.loanNumbers) params.set("loanNumbers", extra.loanNumbers);
  if (range.fromDate) params.set("fromDate", range.fromDate);
  if (range.toDate) params.set("toDate", range.toDate);
  const path = ledgerPath(kind, ref, params);
  await shareFile(path, params, `${kind}-ledger`, title);
}

/** The Ledger page's (Cash tab's Movements) and Reports' Ledger /
 * Statement Download — web's exportCashMovements: GET /cash-movements/export
 * with the same filters, as a PDF or (format=xlsx) an Excel sheet. */
export async function shareMovementsPdf(
  filters: {
    fromDate?: string;
    toDate?: string;
    q?: string;
    branchIds?: number[];
    customerIds?: number[];
    types?: string[];
    modes?: string[];
  },
  format: "pdf" | "xlsx" = "pdf"
) {
  const params = new URLSearchParams();
  if (format === "xlsx") params.set("format", "xlsx");
  if (filters.fromDate) params.set("fromDate", filters.fromDate);
  if (filters.toDate) params.set("toDate", filters.toDate);
  if (filters.q) params.set("q", filters.q);
  if (filters.branchIds?.length) params.set("branchIds", filters.branchIds.join(","));
  if (filters.customerIds?.length) params.set("customerIds", filters.customerIds.join(","));
  if (filters.types?.length) params.set("types", filters.types.join(","));
  if (filters.modes?.length) params.set("modes", filters.modes.join(","));
  await shareFile("/cash-movements/export", params, "cash-movements", "Ledger", format === "xlsx" ? XLSX : PDF);
}

type FileKind = { ext: string; mimeType: string; UTI: string };
const PDF: FileKind = { ext: "pdf", mimeType: "application/pdf", UTI: "com.adobe.pdf" };
const XLSX: FileKind = { ext: "xlsx", mimeType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", UTI: "org.openxmlformats.spreadsheetml.sheet" };

async function shareFile(path: string, params: URLSearchParams, fileStem: string, title: string, kind: FileKind = PDF) {
  const token = await getToken();
  const targetUri = `${FileSystem.cacheDirectory}${fileStem}-${Date.now()}.${kind.ext}`;
  const result = await FileSystem.downloadAsync(apiUrl(`${path}?${params.toString()}`), targetUri, {
    headers: token ? { Authorization: `Bearer ${token}` } : {},
  });
  if (result.status < 200 || result.status >= 300) {
    throw new ApiError(result.status, "", undefined);
  }
  if (await Sharing.isAvailableAsync()) {
    await Sharing.shareAsync(result.uri, { mimeType: kind.mimeType, dialogTitle: title, UTI: kind.UTI });
  } else {
    throw new Error(`Saved to ${result.uri} — sharing isn't available on this device.`);
  }
}

/** Branch ledger Download — web's exportPartyStatementByBranch:
 * GET /cash-movements/transactions/branch/:id/export with the date range. */
export async function shareBranchLedgerPdf(branchId: number, range: { fromDate?: string; toDate?: string }) {
  const params = new URLSearchParams();
  if (range.fromDate) params.set("fromDate", range.fromDate);
  if (range.toDate) params.set("toDate", range.toDate);
  await shareFile(`/cash-movements/transactions/branch/${branchId}/export`, params, "branch-ledger", "Branch ledger");
}

/** Loan Payment Ledger Download — web's downloadLoanStatement: GET /loans/:id/statement (the PDF). */
export async function shareLoanStatementPdf(loanId: number, loanNumber: string) {
  await shareFile(`/loans/${loanId}/statement`, new URLSearchParams(), `statement-${loanNumber}`, "Loan statement");
}

/** Expense Register Download — web's exportExpenses: GET /expenses/export (every expense row, as a PDF). */
export async function shareExpensesPdf() {
  await shareFile("/expenses/export", new URLSearchParams(), "expense-register", "Expense register");
}
