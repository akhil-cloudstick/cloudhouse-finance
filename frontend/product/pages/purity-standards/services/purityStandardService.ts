import { apiFetchEnveloped as apiFetch } from "@/product/services/httpClient";

/* Shape returned by the Go backend (backend/internal/puritystandard/model.go).
 * Suggestion-only reference data — see that package's doc comment — nothing
 * FKs into it; PurityPicker.tsx uses it purely to power the karat/fineness%
 * typeahead. */
export type BackendPurityStandard = {
  id: number;
  karat: number | null;
  finenessPercent: number | null;
  label: string;
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
};

export async function searchPurityStandards(q: string): Promise<BackendPurityStandard[]> {
  const rec = await apiFetch<BackendPurityStandard[]>(`/purity-standards?q=${encodeURIComponent(q)}`);
  return rec || [];
}

/* Page-shaped wrapper for SearchableSelect's fetchFn contract — the
 * purity-standard list is small reference data (24K down to 10K plus any
 * staff-created custom entries), same unpaginated pattern as
 * modules/ornament-types/services/ornamentTypeService.ts and
 * modules/banks/services/bankService.ts. */
export async function searchPurityStandardsPage(q: string, page: number): Promise<{ items: BackendPurityStandard[]; hasMore: boolean }> {
  if (page > 0) return { items: [], hasMore: false };
  return { items: await searchPurityStandards(q), hasMore: false };
}

/* Creates a new purity standard from a single karat value (or — if one
 * already exists for that karat — returns the existing row, the backend's
 * find-or-create behaviour). */
export async function createPurityStandardByKarat(karat: number): Promise<BackendPurityStandard> {
  return apiFetch<BackendPurityStandard>("/purity-standards", {
    method: "POST",
    body: JSON.stringify({ karat }),
  });
}

/* Same, from a fineness% value instead. */
export async function createPurityStandardByFineness(finenessPercent: number): Promise<BackendPurityStandard> {
  return apiFetch<BackendPurityStandard>("/purity-standards", {
    method: "POST",
    body: JSON.stringify({ finenessPercent }),
  });
}
