import { apiRequestEnveloped as apiRequest } from "@/common/services/httpClient";
import { Scheme, type SchemeInput } from "@/modules/schemes/types/scheme-types";

export function listSchemes(q?: string) {
  return apiRequest<Scheme[]>("/schemes", { params: { q } });
}

export function listActiveSchemes(q?: string) {
  return apiRequest<Scheme[]>("/schemes/active", { params: { q } });
}

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

// Backend refuses (409) while any loan or loan draft still uses it.
export function deleteScheme(id: number) {
  return apiRequest<void>(`/schemes/${id}`, { method: "DELETE" });
}
