import { apiRequestEnveloped as apiRequest } from "@/common/services/httpClient";
import { Scheme, type SchemeInput } from "@/modules/schemes/types/scheme-types";

export function listSchemes(q?: string) {
  return apiRequest<Scheme[]>("/schemes", { params: { q } });
}

// Active schemes only (GET /schemes/active), filtered server-side — for
// pickers that may only offer schemes a new loan can use. `q` matches
// name/code.
export function listActiveSchemes(q?: string) {
  return apiRequest<Scheme[]>("/schemes/active", { params: { q } });
}

// Page-scoped variant: passing `limit` flips the backend (scheme/handler.go's
// List) into the {items, hasMore} envelope — used by the paginated mobile
// Schemes list (10/page, one API call per page).
export function listSchemesPage(params: { q?: string; method?: string[]; limit: number; offset: number }) {
  return apiRequest<{ items: Scheme[]; hasMore: boolean; total?: number }>("/schemes", {
    params: { ...params, method: params.method?.length ? params.method.join(",") : undefined },
  });
}

export function getScheme(id: number) {
  return apiRequest<Scheme>(`/schemes/${id}`);
}

export function createScheme(input: SchemeInput) {
  return apiRequest<Scheme>("/schemes", { method: "POST", body: input });
}

export function updateScheme(id: number, input: SchemeInput) {
  return apiRequest<Scheme>(`/schemes/${id}`, { method: "PUT", body: input });
}

export function toggleSchemeActive(id: number) {
  return apiRequest<Scheme>(`/schemes/${id}/toggle-active`, { method: "POST" });
}

export function calculateSchemeEligibility(id: number, goldWeight: number, goldRate: number) {
  return apiRequest<{ eligibleAmount: number }>(`/schemes/${id}/calculate`, {
    method: "POST",
    body: { goldWeight, goldRate },
  });
}

// Permanently deletes a scheme (DELETE /schemes/:id) — the backend refuses (409) while any loan or loan
// draft still uses it, and its message is shown to the user.
export function deleteScheme(id: number) {
  return apiRequest<void>(`/schemes/${id}`, { method: "DELETE" });
}
