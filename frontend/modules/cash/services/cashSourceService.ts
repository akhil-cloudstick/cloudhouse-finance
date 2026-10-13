import { apiFetchEnveloped as apiFetch } from "@/common/services/httpClient";
import type { BackendLoanCashSource } from "@/modules/cash/types/cash-types";
import type { BackendCashSource, LoanBalance } from "@/modules/cash/types/cash-source-types";

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

/* GET /cash-sources/:id — the category with its current loan balance. The id is
 * a category id (cash sources, expense categories and self-transfer categories
 * are one table), so a loan picked on any form resolves here. */
export async function getLoanBalance(id: number): Promise<LoanBalance | null> {
  const res = await apiFetch<{ isLoan: boolean; balance: LoanBalance }>(`/cash-sources/${id}`);
  return res.isLoan ? res.balance : null;
}

/* PATCH /cash-sources/:id/loan — changes a loan's lender bank, loan number and principal. The loan's name
 * and every cash amount are untouched; the backend refuses a principal below what is already drawn. */
export async function updateLoanDetails(id: number, input: { bankId: number; loanNumber: string; principalAmount: number }): Promise<void> {
  await apiFetch<unknown>(`/cash-sources/${id}/loan`, { method: "PATCH", body: JSON.stringify(input) });
}
