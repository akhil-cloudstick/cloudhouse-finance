import { apiFetch } from "@/lib/api";

/* Shape returned by the Go backend (backend/internal/ornamenttype/model.go). */
export type BackendOrnamentType = {
  id: number;
  name: string;
  createdAt: string;
  updatedAt: string;
};

/* Server-side search (by name) — backs the ornament-type SearchableSelect
 * in NewLoan.tsx. */
export async function searchOrnamentTypes(q: string): Promise<BackendOrnamentType[]> {
  const rec = await apiFetch<BackendOrnamentType[]>(`/ornament-types?q=${encodeURIComponent(q)}`);
  return rec || [];
}

/* Page-shaped wrapper for SearchableSelect's fetchFn contract. The
 * ornament-type list is unpaginated on the backend (it's typically small),
 * so this always returns everything on page 0 and reports no further
 * pages — SearchableSelect's infinite scroll simply never fires here. */
export async function searchOrnamentTypesPage(q: string, page: number): Promise<{ items: BackendOrnamentType[]; hasMore: boolean }> {
  if (page > 0) return { items: [], hasMore: false };
  return { items: await searchOrnamentTypes(q), hasMore: false };
}

/* Creates a new ornament type, or — if one with the same name (case
 * insensitive) already exists — returns the existing row instead (the
 * backend's find-or-create behaviour). */
export async function createOrnamentType(name: string): Promise<BackendOrnamentType> {
  return apiFetch<BackendOrnamentType>("/ornament-types", {
    method: "POST",
    body: JSON.stringify({ name }),
  });
}
