

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
