import { apiRequestEnveloped as apiRequest } from "./client";
import { API_ORIGIN } from "./config";

// Mirrors backend/internal/branding's Public/Self — see that package's doc
// for why /public/branding/:code is unauthenticated and always answers 200.
export type PublicBranding = {
  name: string;
  legalName: string;
  brandColor: string;
  // Server-root-relative ("/api/v1/public/branding/:code/logo"), or empty —
  // empty means "use the platform mark" (see resolveLogoUrl below).
  logoUrl: string;
  appUrl: string;
};

export type SelfBranding = PublicBranding & {
  addressLine: string;
  kmlRegNo: string;
  modules: string[];
  languages: string[];
};

// Pre-login: called with the business code the connect screen stored (or ""
// before one is known, which shows the platform default).
export function fetchPublicBranding(businessCode: string) {
  const code = businessCode || "default";
  return apiRequest<PublicBranding>(`/public/branding/${encodeURIComponent(code)}`, { skipAuth: true });
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
