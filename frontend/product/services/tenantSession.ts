/* Per-business sessions and links.
 *
 * The app is sold to many independent businesses from one deployment, so a
 * username is only unique WITHIN a business and the backend needs to know
 * which one a login is for. It learns that from a `businessCode`, and the
 * business reaches its staff through a per-business link, with the code at
 * the front of the path: /<slug>/login, /<slug>/dashboard.
 *
 * Three rules this module exists to enforce:
 *
 * 1. THE SLUG SELECTS, IT NEVER GRANTS. It decides which business to
 *    authenticate against and nothing more. After login the business comes
 *    from the token — never re-read from the URL — so editing the slug in the
 *    address bar cannot change whose data you see. The backend ignores it
 *    entirely once a session exists.
 *
 * 2. SESSIONS ARE KEYED BY SLUG. Every business shares one browser origin, so
 *    a single "cloudhouse_token" key meant two businesses open in two tabs
 *    silently clobbered each other's session — you would be signed in as the
 *    wrong business, or logged out at random. Keys are per-slug instead.
 *
 * 3. A BARE /login MUST NOT DEAD-END. Anyone who bookmarks the plain URL, or
 *    whose link is truncated, needs a way through — otherwise "the link
 *    stopped working" becomes the commonest support call. Bare paths fall back
 *    to the last business used on this browser, and the login form offers a
 *    business-code field when even that is missing.
 *
 * The slug is part of a business's identity and is treated as IMMUTABLE:
 * changing it breaks every saved bookmark.
 */

import { isBusinessSegment, isValidBusinessSlug as isValidSlug } from "@/product/config/routes";

/* Where the last-used business is remembered, so bare /login and /app resolve
 * to something instead of dead-ending. A pointer only — never a source of
 * authority. */
const ACTIVE_BUSINESS_KEY = "cloudhouse_active_business";

/* Storage keys from before the rebrand, kept ONLY so purgeStaleSession() can
 * delete them. These are historical localStorage strings, not brand surface:
 * they are never read for a value and never displayed. Every key this app
 * writes today is prefixed `cloudhouse_`. */
const STALE_KEYS = [
  "ambikagold_token",
  "ambikagold_employee",
  "ambikagold_active_business",
  "ambikagold_superadmin_token",
  "ambikagold_superadmin_user",
] as const;

/* The bucket used when no slug is known — the single-business installation,
 * which is every installation today. Named rather than empty so the storage
 * keys stay readable in devtools. */
const DEFAULT_BUCKET = "default";

/* The slug rules themselves live in common/config/routes.ts, which has no
 * imports: both this module and appRoutes.ts need them, and each of those
 * two already needs the other. Re-exported here so the many callers that
 * reach for it through this module keep working. */
export { isValidBusinessSlug } from "@/product/config/routes";

/* businessSlugFromPath reads the business out of the FIRST path segment:
 * /ctfi/login, /ctfi/dashboard, /ctfi/loan/GL-1001.
 *
 * The business code leads the path so that everything belonging to one
 * customer sits under one prefix that is theirs. The cost is that the first
 * segment is ambiguous — "/loans" could be a business called "loans" — which
 * is settled by routes.ts's reserved list, not by guessing. Returns null for
 * a bare path (/login, /dashboard), which is the single-business install.
 */
export function businessSlugFromPath(pathname?: string): string | null {
  const path = pathname ?? (typeof window === "undefined" ? "" : window.location.pathname);
  const parts = path.split("/").filter(Boolean);
  if (!parts.length) return null;
  const candidate = parts[0].toLowerCase();
  return isBusinessSegment(candidate) ? candidate : null;
}

/* Host labels that never name a business — the platform's own bare/marketing
 * subdomains, which a production deployment may put in front of the same
 * origin. Extend this list rather than assuming every non-apex hostname is a
 * tenant.
 *
 * "demo" is NOT reserved: it is an ordinary tenant code like any other,
 * reachable at demo.cloudhousefinance.com same as any other business's
 * subdomain. */
const RESERVED_HOST_LABELS = new Set(["www", "app", "admin", "api", "superadmin"]);

/* Local-dev suffixes that carry a subdomain without a real DNS entry:
 * "ambika.localhost" resolves to 127.0.0.1 in every modern browser with no
 * hosts-file edit, and lvh.me/nip.io are the equivalent for tools that need
 * a real DNS answer (e.g. some HTTPS/dev-proxy setups). See
 * documents/local_multitenant_testing.md. */
const LOCAL_HOST_SUFFIXES = ["localhost", "lvh.me", "nip.io"];

const IPV4_PATTERN = /^\d{1,3}(\.\d{1,3}){3}$/;

// The desktop app's own origin (Wails); it names no business.
const DESKTOP_HOST = "wails.localhost";

/* businessSlugFromHost reads a subdomain the way production will resolve a
 * tenant on a real domain: https://ambika.cloudhousefinance.com/... names
 * "ambika" without any /login/<slug> path segment at all. Mirrors (on the
 * frontend, before any session exists) the same one-directional trust
 * backend/internal/tenant/host.go already documents for the Host header:
 * this only ever NAMES a candidate business for the login screen to show
 * branding for — it is never treated as authorization, and
 * businessCodeForRequest still sends it as an ordinary business code that
 * auth.Service validates like any other.
 *
 * Returns null for a bare apex domain (no subdomain to read), "localhost"
 * alone, a raw IP, or a reserved label — see the two lists above. */
export function businessSlugFromHost(hostname?: string): string | null {
  const host = (hostname ?? (typeof window === "undefined" ? "" : window.location.hostname)).toLowerCase();
  if (!host || IPV4_PATTERN.test(host) || host === DESKTOP_HOST) return null;
  const labels = host.split(".");
  if (labels.length < 2) return null; // "localhost" alone, or an unqualified host
  const candidate = labels[0];
  if (!isValidSlug(candidate) || RESERVED_HOST_LABELS.has(candidate)) return null;
  const rest = labels.slice(1).join(".");
  if (LOCAL_HOST_SUFFIXES.includes(rest)) return candidate;
  // A bare two-label apex ("cloudhousefinance.com") has no subdomain to
  // read at all — only three-or-more labels put something in front of it.
  return labels.length >= 3 ? candidate : null;
}

/* activeBusinessSlug is the business this browser tab is operating as, in
 * order of authority: the URL PATH if it names one (/login/<slug>), then the
 * URL's HOST if it names one (a production subdomain), then the last one
 * used on this browser.
 *
 * The URL wins deliberately, path before host: a path segment is an explicit,
 * unambiguous choice (and the one manual-override/testing route that keeps
 * working on a single shared hostname), while the host is what production
 * subdomains resolve by when there is no path override. Either way, each tab
 * reads its own slug from its own address bar, so two tabs on two businesses
 * never depend on a shared "current business" value the other could
 * overwrite. */
export function activeBusinessSlug(): string | null {
  const fromPath = businessSlugFromPath();
  if (fromPath) return fromPath;
  const fromHost = businessSlugFromHost();
  if (fromHost) return fromHost;
  if (typeof window === "undefined") return null;
  const remembered = window.localStorage.getItem(ACTIVE_BUSINESS_KEY);
  return remembered && isValidSlug(remembered) ? remembered : null;
}

/* resolveActiveSlug names the active business AND reports which of the two
 * URL signals actually matched: the PATH (an explicit /<slug> segment) or
 * the HOST (a production subdomain).
 *
 * activeBusinessSlug() alone cannot answer that — it collapses path, host and
 * the remembered pointer into one value, so a caller building a link had no
 * way to tell "this came from an explicit /ctfi/... URL, keep showing it" from
 * "this came from the Host header, the address bar never had it". Getting
 * that wrong is exactly how a host-resolved tenant
 * (https://demo.cloudhousefinance.com/) ends up redirected to
 * .../demo/login — a slug the visitor never typed, printed into the URL
 * anyway.
 *
 * Deliberately built only on businessSlugFromPath()/businessSlugFromHost(),
 * not the remembered-business fallback: a caller that wants that third tier
 * too (as the historical `activeBusinessSlug()` callers do) asks for it
 * itself when this returns a null slug, and decides on its own whether that
 * bare-fallback case should still show a slug in the URL. */
export function resolveActiveSlug(): { slug: string | null; fromPath: boolean } {
  const fromPath = businessSlugFromPath();
  if (fromPath) return { slug: fromPath, fromPath: true };
  return { slug: businessSlugFromHost(), fromPath: false };
}

export function rememberActiveBusiness(slug: string | null): void {
  if (typeof window === "undefined") return;
  if (slug && isValidSlug(slug)) {
    window.localStorage.setItem(ACTIVE_BUSINESS_KEY, slug);
  } else {
    window.localStorage.removeItem(ACTIVE_BUSINESS_KEY);
  }
}

function bucket(slug?: string | null): string {
  const s = slug === undefined ? activeBusinessSlug() : slug;
  return s && isValidSlug(s) ? s : DEFAULT_BUCKET;
}

/* The storage keys for one business's session. */
export function sessionKeys(slug?: string | null) {
  const b = bucket(slug);
  return {
    token: `cloudhouse_token::${b}`,
    employee: `cloudhouse_employee::${b}`,
    permissions: `cloudhouse_permissions::${b}`,
  };
}

export function readToken(slug?: string | null): string | null {
  if (typeof window === "undefined") return null;
  return window.localStorage.getItem(sessionKeys(slug).token);
}

export function readEmployeeRaw(slug?: string | null): string | null {
  if (typeof window === "undefined") return null;
  return window.localStorage.getItem(sessionKeys(slug).employee);
}

export function writeSession(slug: string | null, token: string, employeeJson: string): void {
  if (typeof window === "undefined") return;
  const keys = sessionKeys(slug);
  window.localStorage.setItem(keys.token, token);
  window.localStorage.setItem(keys.employee, employeeJson);
  rememberActiveBusiness(slug);
}

export function clearSession(slug?: string | null): void {
  if (typeof window === "undefined") return;
  const keys = sessionKeys(slug);
  window.localStorage.removeItem(keys.token);
  window.localStorage.removeItem(keys.employee);
  window.sessionStorage.removeItem(keys.permissions);
}

/* clearSessionsForToken removes every bucket holding THIS EXACT token, and
 * returns how many it cleared.
 *
 * Sign-out clears the bucket that activeBusinessSlug() resolves to at the
 * moment of the click. That answer is derived from the current URL (path,
 * then host, then the remembered pointer), and it is not guaranteed to be
 * the answer that was current when writeSession chose a bucket — a login
 * that named a business explicitly and a later bare-path URL resolve
 * differently. When they disagree the token SURVIVES the sign-out, the login
 * page reads it back as a live session, and its "already signed in" effect
 * bounces the user straight to the dashboard: signing out appears to work
 * for an instant and then undoes itself.
 *
 * Matching on the token VALUE rather than widening the slug guess is what
 * keeps this safe for the multi-tenant case. Two businesses signed in in two
 * tabs hold two different tokens, so clearing by value can only ever remove
 * the session actually being signed out of — never the other tab's, which is
 * the whole reason sessions are keyed per business in the first place.
 */
export function clearSessionsForToken(token: string | null): number {
  if (typeof window === "undefined" || !token) return 0;
  const prefix = "cloudhouse_token::";
  // Collected before mutating: removeItem reindexes localStorage, so removing
  // inside a key(i) walk skips entries.
  const buckets: string[] = [];
  for (let i = 0; i < window.localStorage.length; i++) {
    const key = window.localStorage.key(i);
    if (!key || !key.startsWith(prefix)) continue;
    if (window.localStorage.getItem(key) === token) buckets.push(key.slice(prefix.length));
  }
  buckets.forEach((b) => clearSession(b));
  return buckets.length;
}

/* readPermissions/writePermissions mirror the permission map per business.
 * sessionStorage, so it dies with the tab (the map is a cache, never an
 * authority — see the role-permission standard). */
export function readPermissionsRaw(slug?: string | null): string | null {
  if (typeof window === "undefined") return null;
  return window.sessionStorage.getItem(sessionKeys(slug).permissions);
}

export function writePermissionsRaw(slug: string | null, json: string): void {
  if (typeof window === "undefined") return;
  window.sessionStorage.setItem(sessionKeys(slug).permissions, json);
}

/* purgeStaleSession deletes the storage keys this app wrote under its previous
 * name. It replaces a migrateLegacySession() that carried a pre-multi-tenancy
 * token into the keyed layout: the rebrand renamed the keyed layout too, so
 * there is no longer any value worth carrying over — every session predating
 * it is unreadable and its holder signs in again once. What is left to do is
 * housekeeping, so that a token from the old deployment does not sit in
 * localStorage indefinitely after it has stopped being usable.
 *
 * Unconditional and idempotent: removeItem on an absent key is a no-op. */
export function purgeStaleSession(): void {
  if (typeof window === "undefined") return;
  for (const key of STALE_KEYS) window.localStorage.removeItem(key);
}

/* The link builders moved to common/services/appRoutes.ts, which owns the
 * whole URL shape — routes as well as the two standalone pages. Re-exported
 * here because this is where every caller already imports them from, and a
 * link built against the old shape would resolve to a page that no longer
 * exists. */
export { appPath, loginPath, resetPath } from "@/product/services/appRoutes";

/* The business code sent to the backend with a login, password-reset request
 * or OTP verification.
 *
 * Empty when unknown, which is correct rather than a fallback: with a single
 * business the backend resolves it on its own, and with several it answers
 * "please use your organisation's sign-in link, or enter your business code"
 * — a prompt, not a guess. Guessing here would mean authenticating someone
 * against a business they never named. */
export function businessCodeForRequest(slug?: string | null): string {
  const s = slug === undefined ? activeBusinessSlug() : slug;
  return s && isValidSlug(s) ? s : "";
}
