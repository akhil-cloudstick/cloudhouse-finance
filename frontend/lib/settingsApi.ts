import { apiFetch } from "@/lib/api";

/* Shape returned by the Go backend (backend/internal/settings/model.go). */
export type ApiKeyCategory =
  | "notification"
  | "sms"
  | "whatsapp"
  | "kyc_verification"
  | "aadhaar_verification"
  | "pan_verification";

export type ApiKeyView = {
  category: ApiKeyCategory;
  name: string;
  value: string;
  isSet: boolean;
  updatedAt?: string;
};

/* Display labels for the fixed set of integrations — kept in sync with
 * backend/internal/settings/model.go's AllCategories. */
export const CATEGORY_LABELS: Record<ApiKeyCategory, string> = {
  notification: "Notifications",
  sms: "SMS",
  whatsapp: "WhatsApp",
  kyc_verification: "KYC Verification",
  aadhaar_verification: "Aadhaar Verification",
  pan_verification: "PAN Verification",
};

export async function listApiKeys(): Promise<ApiKeyView[]> {
  const rec = await apiFetch<ApiKeyView[]>("/settings/api-keys");
  return rec || [];
}

export async function setApiKey(category: ApiKeyCategory, name: string, value: string): Promise<ApiKeyView> {
  return apiFetch<ApiKeyView>(`/settings/api-keys/${category}`, {
    method: "PUT",
    body: JSON.stringify({ name, value }),
  });
}

export async function deleteApiKey(category: ApiKeyCategory): Promise<void> {
  await apiFetch<void>(`/settings/api-keys/${category}`, { method: "DELETE" });
}
