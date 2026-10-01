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
import { API_BASE, apiFetchEnveloped } from "@/product/services/httpClient";

export type PublicBranding = {
  name: string;
  legalName: string;
  /** Compact identity for tight spots (sidebar headline, tab title, login
   * subtext). Never empty — falls back to name server-side. */
  shortName: string;
  /** Sidebar subline under the headline. Unlike shortName this one CAN be
   * empty — no server-side fallback — which the lockup reads as "use the
   * business name, unless that would just repeat the headline". */
  lockupTagline: string;
  brandColor: string;
  /** Empty means "not set" — see frontend/common/config/theme.ts. */
  secondaryColor: string;
  accentColor: string;
  sidebarColor: string;
  fontFamily: string;
  fontScale: string;
  logoScale: string;
  logoDisplay: string;
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
  /** Set per business by the vendor: work on the one default branch only. */
  singleBranch?: boolean;
};

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
    const res = await fetch(`${API_BASE}/public/branding/${encodeURIComponent(code)}`, { cache: "no-store" });
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
