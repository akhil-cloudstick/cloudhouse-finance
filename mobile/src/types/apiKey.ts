// Mirrors backend/internal/settings's API key view — raw values are never
// serialized (encrypted at rest), only whether a category is configured.
export const API_KEY_CATEGORIES = [
  "notification",
  "sms",
  "whatsapp",
  "kyc_verification",
  "aadhaar_verification",
  "pan_verification",
] as const;

export type ApiKeyCategory = (typeof API_KEY_CATEGORIES)[number];

export type ApiKeyView = {
  category: ApiKeyCategory;
  name?: string;
  configured?: boolean;
  createdAt?: string;
  updatedAt?: string;
};
