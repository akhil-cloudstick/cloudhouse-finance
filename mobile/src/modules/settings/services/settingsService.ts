import { apiRequestEnveloped as apiRequest } from "@/common/services/httpClient";
import { ApiKeyView, ApiKeyCategory } from "@/modules/settings/types/api-key-types";

export function listApiKeys() {
  return apiRequest<ApiKeyView[]>("/settings/api-keys");
}

// Paged + searchable (`q`: category / name) — GET /settings/api-keys?limit&offset.
export function listApiKeysPage(params: { q?: string; limit: number; offset: number }) {
  return apiRequest<{ items: ApiKeyView[]; hasMore: boolean; total?: number }>("/settings/api-keys", { params });
}

export function setApiKey(category: ApiKeyCategory, value: string, name?: string) {
  return apiRequest<ApiKeyView>(`/settings/api-keys/${category}`, { method: "PUT", body: { name, value } });
}

export function deleteApiKey(category: ApiKeyCategory) {
  return apiRequest<void>(`/settings/api-keys/${category}`, { method: "DELETE" });
}
