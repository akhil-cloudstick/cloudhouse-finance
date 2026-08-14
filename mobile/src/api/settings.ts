import { apiRequest } from "./client";
import { ApiKeyView, ApiKeyCategory } from "../types/apiKey";

export function listApiKeys() {
  return apiRequest<ApiKeyView[]>("/settings/api-keys");
}

export function setApiKey(category: ApiKeyCategory, value: string, name?: string) {
  return apiRequest<ApiKeyView>(`/settings/api-keys/${category}`, { method: "PUT", body: { name, value } });
}

export function deleteApiKey(category: ApiKeyCategory) {
  return apiRequest<void>(`/settings/api-keys/${category}`, { method: "DELETE" });
}
