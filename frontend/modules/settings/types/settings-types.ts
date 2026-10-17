

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

/* The business's own profile (backend/common/controllers/business_profile.go),
 * edited in the Settings modal's Business Profile tab. `policy` is read-only
 * (set by the platform); lender age, PAN and Aadhaar only apply under GML. */
export type BusinessProfile = {
  name: string;
  legalName: string;
  shortName: string;
  lockupTagline: string;
  policy: string;
  kmlRegNo: string;
  contactPhone: string;
  addressLine: string;
  lenderAge: string;
  lenderPan: string;
  lenderAadhaar: string;
};
export type BusinessProfileInput = Pick<
  BusinessProfile,
  "name" | "legalName" | "shortName" | "lockupTagline" | "kmlRegNo" | "contactPhone" | "addressLine" | "lenderAge" | "lenderPan" | "lenderAadhaar"
>;
