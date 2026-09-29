import { getToken } from "../auth/tokenStorage";
import { ApiError } from "./client";
import { ORIGIN_BASE_URL, resolveAssetUrl } from "./config";

// Mirrors backend/internal/branding's Public/Self — see that package's doc
// for why /public/branding/:code is unauthenticated and always answers 200.
export type PublicBranding = {
  name: string;
  legalName: string;
  brandColor: string;
  // Server-root-relative, or empty — empty means "use the platform mark".
  logoUrl: string;
  appUrl: string;
};

export type SelfBranding = PublicBranding & {
  addressLine: string;
  kmlRegNo: string;
  modules: string[];
  languages: string[];
};

// Branding lives under /api/v1/... (not /api/v1/customer/...), unlike every
// other endpoint this app calls — so it can't go through client.ts's
// apiRequest, which is hardwired to API_BASE_URL's /customer prefix. Same
// {success,data} envelope as the rest of the API (see httpx.Success), just
// resolved against ORIGIN_BASE_URL directly instead.
async function brandingFetch<T>(path: string, opts: { skipAuth?: boolean } = {}): Promise<T> {
  const url = `${ORIGIN_BASE_URL}/api/v1${path}`;
  const headers: Record<string, string> = { "ngrok-skip-browser-warning": "true" };
  if (!opts.skipAuth) {
    const token = await getToken();
    if (token) headers.Authorization = `Bearer ${token}`;
  }
  const res = await fetch(url, { headers });
  const text = await res.text();
  const data = text ? JSON.parse(text) : undefined;
  if (!res.ok) throw new ApiError(res.status, (data && (data.error || data.message)) || res.statusText, data);
  const envelope = data as { success: boolean; data?: T; error?: string };
  if (envelope && envelope.success === false) throw new ApiError(200, envelope.error || "Request failed", envelope);
  return envelope?.data as T;
}

// Pre-login: called with whatever lender code the login screen currently
// holds (may be "" on a single-tenant deployment, which the backend resolves
// itself).
export function fetchPublicBranding(businessCode: string) {
  const code = businessCode || "default";
  return brandingFetch<PublicBranding>(`/public/branding/${encodeURIComponent(code)}`, { skipAuth: true });
}

// Post-login: the business comes from the token, so there is no code param.
export function fetchMyBranding() {
  return brandingFetch<SelfBranding>("/branding");
}

export function resolveLogoUrl(logoUrl: string | null | undefined): string | null {
  return resolveAssetUrl(logoUrl) ?? null;
}
