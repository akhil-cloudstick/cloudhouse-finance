import { apiRequestEnveloped as apiRequest, API_ORIGIN } from "./httpClient";
import type { PublicBranding, SelfBranding } from "@/common/types/branding-types";

// Pre-login: called with the business code the connect screen stored (or ""
// before one is known, which shows the platform default).
export function fetchPublicBranding(businessCode: string) {
  const code = businessCode || "default";
  return apiRequest<PublicBranding>(`/public/branding/${encodeURIComponent(code)}`, { skipAuth: true });
}

// Pre-login: swaps the short connect code from the web dashboard's QR (or
// typed by hand) for the business it was issued for. A 404 means the code is
// wrong or has expired.
export function redeemConnectCode(connectCode: string) {
  return apiRequest<{ businessCode: string }>(`/public/connect/${encodeURIComponent(connectCode)}`, { skipAuth: true });
}

// Post-login: the business comes from the token, so there is no code param.
export function fetchMyBranding() {
  return apiRequest<SelfBranding>("/branding");
}

// logoUrl is server-root-relative, like uploaded-file paths — join against
// API_ORIGIN (not API_BASE_URL, which already carries "/api/v1" and would
// double it), same convention as image URLs elsewhere in this app.
export function resolveLogoUrl(logoUrl: string | null | undefined): string | null {
  if (!logoUrl) return null;
  return `${API_ORIGIN}${logoUrl}`;
}
