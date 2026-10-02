import { apiFetchEnveloped as apiFetch } from "@/product/services/httpClient";
import type { BackendLoanCashSource } from "./cashService";

/* Shape returned by the Go backend (backend/internal/cash/model.go's
 * CashSource) — a small find-or-create lookup list backing AddCashModal.tsx's
 * "Source of Cash" picker, same pattern as bank.Bank. */
export type BackendCashSource = {
  id: number;
  name: string;
  createdAt: string;
  // A loan source's details, captured on its first Add Cash entry (see
  // isLoanSource) — principalAmount present means they're on file.
  bankId?: number;
  bank?: { id: number; name: string };
  loanNumber?: string;
  principalAmount?: number;
};

/* A source whose name starts with "Loan" (any case) is one bank loan —
 * mirrors backend/internal/cash/service.go's IsLoanSource. */
export function isLoanSource(name: string): boolean {
  return name.trim().toLowerCase().startsWith("loan");
}

export const CASH_SOURCES_PAGE_SIZE = 5;

/* Page-shaped fetch for SearchableSelect's fetchFn contract — real
 * server-side pagination (GET /cash-sources?q=&limit=&offset=), unlike
 * bankService.ts's searchBanksPage which the bank list's small size lets
 * skip paging entirely. */
export async function searchCashSourcesPage(q: string, page: number): Promise<{ items: BackendCashSource[]; hasMore: boolean }> {
  const params = new URLSearchParams({ limit: String(CASH_SOURCES_PAGE_SIZE), offset: String(page * CASH_SOURCES_PAGE_SIZE) });
  if (q) params.set("q", q);
  const res = await apiFetch<{ items: BackendCashSource[] | null; hasMore: boolean }>(`/cash-sources?${params}`);
  return { items: res.items || [], hasMore: !!res.hasMore };
}

/* Distinct loan numbers already recorded as a "Loan" cash source, newest
 * details per loan — AddCashModal.tsx's Loan Number picker, so one loan can
 * be drawn against across several Add Cash entries. */
export async function searchLoanSourcesPage(q: string, page: number, bankId?: number): Promise<{ items: BackendLoanCashSource[]; hasMore: boolean }> {
  const params = new URLSearchParams({ limit: String(CASH_SOURCES_PAGE_SIZE), offset: String(page * CASH_SOURCES_PAGE_SIZE) });
  if (bankId) params.set("bankId", String(bankId));
  if (q) params.set("q", q);
  const res = await apiFetch<{ items: BackendLoanCashSource[] | null; hasMore: boolean }>(`/cash-movements/loan-sources?${params}`);
  return { items: res.items || [], hasMore: !!res.hasMore };
}

/* Creates a new cash source, or — if one with the same name (case
 * insensitive) already exists — returns the existing row instead (the
 * backend's find-or-create behaviour). */
export async function createCashSource(name: string): Promise<BackendCashSource> {
  return apiFetch<BackendCashSource>("/cash-sources", {
    method: "POST",
    body: JSON.stringify({ name }),
  });
}
