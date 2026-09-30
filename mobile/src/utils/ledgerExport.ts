import * as FileSystem from "expo-file-system/legacy";
import * as Sharing from "expo-sharing";
import { API_BASE_URL } from "../api/config";
import { getToken } from "../auth/tokenStorage";
import { ApiError } from "../api/client";
import type { LedgerKind } from "../api/cash";

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

export async function shareLedgerPdf(kind: LedgerKind, ref: string, range: { fromDate?: string; toDate?: string }, title: string) {
  const params = new URLSearchParams({ export: "pdf" });
  if (range.fromDate) params.set("fromDate", range.fromDate);
  if (range.toDate) params.set("toDate", range.toDate);
  const path = ledgerPath(kind, ref, params);
  await sharePdf(path, params, `${kind}-ledger`, title);
}

/** The Ledger page's (Cash tab's Movements) Download — web's
 * exportCashMovements: GET /cash-movements/export with the same filters. */
export async function shareMovementsPdf(filters: {
  fromDate?: string;
  toDate?: string;
  q?: string;
  branchIds?: number[];
  customerIds?: number[];
  types?: string[];
}) {
  const params = new URLSearchParams();
  if (filters.fromDate) params.set("fromDate", filters.fromDate);
  if (filters.toDate) params.set("toDate", filters.toDate);
  if (filters.q) params.set("q", filters.q);
  if (filters.branchIds?.length) params.set("branchIds", filters.branchIds.join(","));
  if (filters.customerIds?.length) params.set("customerIds", filters.customerIds.join(","));
  if (filters.types?.length) params.set("types", filters.types.join(","));
  await sharePdf("/cash-movements/export", params, "cash-movements", "Ledger");
}

async function sharePdf(path: string, params: URLSearchParams, fileStem: string, title: string) {
  const token = await getToken();
  const targetUri = `${FileSystem.cacheDirectory}${fileStem}-${Date.now()}.pdf`;
  const result = await FileSystem.downloadAsync(`${API_BASE_URL}${path}?${params.toString()}`, targetUri, {
    headers: token ? { Authorization: `Bearer ${token}` } : {},
  });
  if (result.status < 200 || result.status >= 300) {
    throw new ApiError(result.status, "", undefined);
  }
  if (await Sharing.isAvailableAsync()) {
    await Sharing.shareAsync(result.uri, { mimeType: "application/pdf", dialogTitle: title, UTI: "com.adobe.pdf" });
  } else {
    throw new Error(`Saved to ${result.uri} — sharing isn't available on this device.`);
  }
}
