/* The vocabulary of the app's URLs: which words are pages, and which could be
 * a business.
 *
 * A LEAF module with no imports, deliberately. Both tenantSession.ts (which
 * must know whether a path segment names a business) and appRoutes.ts (which
 * builds and parses links) need this, and each already needs the other, so
 * putting the shared vocabulary in either one would make them circular.
 */

/* Every console route. The router needs this to tell "/ctfi/loans" (business
 * ctfi, page loans) from "/loans" (no business named, page loans), so it has
 * to enumerate them rather than accept any word.
 *
 * Keep in step with ROUTE_PERMISSIONS in app/app/page.tsx: that decides WHO
 * may reach a route, this decides whether a URL segment IS one. A route
 * missing here is unreachable by URL; a route missing there is reachable by
 * anyone. */
export const APP_ROUTES = [
  "dashboard",
  "customers",
  "customer",
  "loans",
  "loan",
  "newloan",
  "schemes",
  "goldrates",
  "requests",
  "loanrisk",
  "personalloans",
  "personalloan",
  "investments",
  "investment",
  "cash",
  "auctions",
  "packets",
  "packet",
  "bankpledge",
  "reports",
  "employees",
  "calendar",
  "branches",
  "banks",
  "party-bank",
  "party-customer",
  "roles-permissions",
  "billing",
  "settings",
] as const;

export type AppRoute = (typeof APP_ROUTES)[number];

export const DEFAULT_ROUTE: AppRoute = "dashboard";

/* Pages that sit under a business but are not console routes:
 * /<slug>/login and /<slug>/reset. */
export const STANDALONE_PAGES = ["login", "reset"] as const;
export type StandalonePage = (typeof STANDALONE_PAGES)[number];

/* Slugs are lowercase alphanumeric plus dashes. Anything else is not treated
 * as a slug at all, which keeps a stray path segment from being mistaken for
 * a business and sent to the backend as a code. */
const SLUG_PATTERN = /^[a-z0-9][a-z0-9-]*$/;

/* First path segments that can never be a business.
 *
 * The cost of the business code coming first in the URL: "/dashboard" is
 * either a business called "dashboard" or the bare install's dashboard, and
 * only a list can decide. Everything here is served by something other than a
 * tenant — the API, uploaded files, Next's asset tree, the export's own
 * top-level pages — or is an app route, which would shadow the real page.
 *
 * This is also why a business may not BE given one of these codes: see
 * isValidBusinessSlug, which refuses them outright rather than letting one be
 * created and break its own links later. */
export const RESERVED_ROOT_SEGMENTS: ReadonlySet<string> = new Set<string>([
  ...APP_ROUTES,
  ...STANDALONE_PAGES,
  "api",
  "uploads",
  "assets",
  "static",
  "_next",
  "favicon.ico",
  "index",
  "app",
  "superadmin",
  "forgot-password",
  "reset-password",
  "digilocker-callback",
  "esign-callback",
]);

/* isValidBusinessSlug is the rule for what may BE a business code, and it now
 * refuses the reserved words above as well as malformed ones. A business
 * coded "api" or "loans" would produce links that can never resolve to it, so
 * rejecting the code is the only point at which that is fixable. */
export function isValidBusinessSlug(value: string): boolean {
  return (
    SLUG_PATTERN.test(value) && value.length <= 60 && !RESERVED_ROOT_SEGMENTS.has(value)
  );
}

/** True when a URL's first path segment names a business rather than a page. */
export function isBusinessSegment(segment: string): boolean {
  return isValidBusinessSlug(segment);
}
