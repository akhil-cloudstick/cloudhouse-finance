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
import { API_BASE, apiFetchEnveloped } from "@/common/services/httpClient";

export type PublicBranding = {
  name: string;
  legalName: string;
  brandColor: string;
  /** Empty when the business has no logo — render the platform mark. */
  logoUrl: string;
  appUrl: string;
};

export type MyBranding = PublicBranding & {
  addressLine: string;
  kmlRegNo: string;
  /** Optional modules this business has been granted (tenant.KnownModules). */
  modules: string[];
  /** Languages this business may issue customer documents in; always has "en". */
  languages: string[];
};

/* A bare fetch rather than apiFetch: see the module comment. A failure here
 * is never fatal — the caller falls back to the platform brand, because a
 * sign-in page that will not render because a logo lookup failed is a far
 * worse outcome than one showing the default mark. */
export async function fetchPublicBranding(code: string | null): Promise<PublicBranding | null> {
  if (!code) return null;
  try {
    const res = await fetch(`${API_BASE}/public/branding/${encodeURIComponent(code)}`);
    if (!res.ok) return null;
    const body = (await res.json()) as { success?: boolean; data?: PublicBranding };
    return body?.data ?? null;
  } catch {
    return null;
  }
}

export function fetchMyBranding(): Promise<MyBranding> {
  return apiFetchEnveloped<MyBranding>("/branding");
}
