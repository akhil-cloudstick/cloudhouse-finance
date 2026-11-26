import { getToken } from "./tokenStorage";
import { ApiError, originFetch, resolveAssetUrl } from "./httpClient";

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

// Branding lives under /api/v1/... not /api/v1/customer/..., so it can't go through httpClient's apiRequest.
async function brandingFetch<T>(path: string, opts: { skipAuth?: boolean } = {}): Promise<T> {
  const headers: Record<string, string> = { "ngrok-skip-browser-warning": "true" };
  if (!opts.skipAuth) {
    const token = await getToken();
    if (token) headers.Authorization = `Bearer ${token}`;
  }
  const res = await originFetch(path, { headers });
  const text = await res.text();
  const data = text ? JSON.parse(text) : undefined;
  if (!res.ok) throw new ApiError(res.status, (data && (data.error || data.message)) || res.statusText, data);
  const envelope = data as { success: boolean; data?: T; error?: string };
  if (envelope && envelope.success === false) throw new ApiError(200, envelope.error || "Request failed", envelope);
  return envelope?.data as T;
}

export function fetchPublicBranding(businessCode: string) {
  const code = businessCode || "default";
  return brandingFetch<PublicBranding>(`/public/branding/${encodeURIComponent(code)}`, { skipAuth: true });
}

export function fetchMyBranding() {
  return brandingFetch<SelfBranding>("/branding");
}

export function resolveLogoUrl(logoUrl: string | null | undefined): string | null {
  return resolveAssetUrl(logoUrl) ?? null;
}
