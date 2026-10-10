/* Per-business branding — backend/internal/branding.
 *
 * Two reads, deliberately different in how they authenticate:
 *
 *   fetchPublicBranding(code)  no session at all. The sign-in page needs a
 *                              business's logo and colour BEFORE anyone has
 *                              logged in, so this cannot go through
 *                              httpClient's apiFetch (which attaches the
 *                              staff JWT and bounces to /login on a 401).
 *   fetchMyBranding()          the signed-in app's own business, taken from
 *                              the token — there is no id to pass.
 */
import { apiRawFetch, apiFetchEnveloped } from "@/common/services/httpClient";
import type { PublicBranding, MyBranding, ConnectCode } from "@/modules/branding/types/branding-types";

/* A bare fetch rather than apiFetch: see the module comment. A failure here
 * is never fatal — the caller falls back to the platform brand, because a
 * sign-in page that will not render because a logo lookup failed is a far
 * worse outcome than one showing the default mark. */
export async function fetchPublicBranding(code: string | null): Promise<PublicBranding | null> {
  if (!code) return null;
  try {
    // no-store: this is refetched on every BrandingProvider load specifically
    // so an edit in the superadmin console shows up on the next reload — a
    // browser (or an intermediate dev-server proxy) treating this GET as
    // cacheable would silently serve a stale business's old colours/logo/name
    // after a real change, which is exactly what this exists to prevent.
    const res = await apiRawFetch(`/public/branding/${encodeURIComponent(code)}`, { cache: "no-store" });
    if (!res.ok) return null;
    const body = (await res.json()) as { success?: boolean; data?: PublicBranding };
    return body?.data ?? null;
  } catch {
    return null;
  }
}

export function fetchMyBranding(): Promise<MyBranding> {
  // no-store — same reasoning as fetchPublicBranding above: this must never
  // serve a cached response after a superadmin edit.
  return apiFetchEnveloped<MyBranding>("/branding", { cache: "no-store" });
}

export function createConnectCode(): Promise<ConnectCode> {
  return apiFetchEnveloped<ConnectCode>("/branding/connect-code", { method: "POST", cache: "no-store" });
}
