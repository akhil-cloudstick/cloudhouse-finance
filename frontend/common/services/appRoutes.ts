/* The app's URL shape, in one place: every link the console builds, and the
 * parser that reads one back.
 *
 * The shape is business-first:
 *
 *   /<slug>/login            the business's sign-in page
 *   /<slug>/dashboard        a console page
 *   /<slug>/loan/GL-1001     a console page with an argument
 *   /<slug>/reset            the operator's reset tool
 *
 * Two things about it are worth stating plainly, because both were true of
 * the previous shape too and neither is changed by moving the code to the
 * front:
 *
 * 1. THE SLUG ONLY SELECTS. It names which business to authenticate against,
 *    and after login the business comes from the token — never re-read from
 *    the URL. Editing the address bar cannot change whose data you see. See
 *    tenantSession.ts's header, which these links serve.
 *
 * 2. THE FIRST SEGMENT IS AMBIGUOUS, and is resolved by the reserved list in
 *    common/config/routes.ts rather than by guesswork.
 *
 * Routes are real paths, not "#dashboard" fragments. A fragment never reaches
 * the server, so every page shared the one URL: it could not be logged, and
 * the browser treated a route change as an in-page jump.
 */

import {
  APP_ROUTES,
  DEFAULT_ROUTE,
  STANDALONE_PAGES,
  isBusinessSegment,
  type StandalonePage,
} from "@/common/config/routes";
import { activeBusinessSlug, isValidBusinessSlug } from "@/common/services/tenantSession";

export type ParsedPath = {
  /** The business named by the URL, or null on a bare path. */
  slug: string | null;
  /** The console route, defaulting to the dashboard. */
  route: string;
  /** The route's argument — a customer, loan or packet id. */
  arg?: string;
  /** Set for /<slug>/login and /<slug>/reset, which are not console routes. */
  page?: StandalonePage;
};

/* parsePath splits a pathname into business, page, route and argument.
 *
 * Total, and never throws: it runs on whatever a user typed or a stale
 * bookmark holds, and the honest answer to "/ctfi/nonsense" is the dashboard,
 * not an error page. */
export function parsePath(pathname?: string): ParsedPath {
  const path = pathname ?? (typeof window === "undefined" ? "" : window.location.pathname);
  const parts = path
    .split("/")
    .filter(Boolean)
    .map((p) => {
      try {
        return decodeURIComponent(p);
      } catch {
        return p; // a malformed %-escape is still a usable literal segment
      }
    });

  let slug: string | null = null;
  if (parts.length && isBusinessSegment(parts[0].toLowerCase())) {
    slug = parts[0].toLowerCase();
    parts.shift();
  }

  const first = parts[0];
  if (first && (STANDALONE_PAGES as readonly string[]).includes(first)) {
    return { slug, route: DEFAULT_ROUTE, page: first as StandalonePage };
  }

  return {
    slug,
    route: first && (APP_ROUTES as readonly string[]).includes(first) ? first : DEFAULT_ROUTE,
    arg: parts[1],
  };
}

/* prefix is the leading "/<slug>" for a business, or "" when none is known.
 *
 * Resolved from the current URL by default, so every link a page renders
 * stays inside the business that page is already showing. A link that dropped
 * the prefix would silently move the user to the bare install. */
function prefix(slug?: string | null): string {
  const s = slug === undefined ? activeBusinessSlug() : slug;
  return s && isValidBusinessSlug(s) ? `/${s}` : "";
}

/**
 * routeHref builds the href for a console route.
 *
 * Takes either the parts (`routeHref("loan", id)`) or one "route/arg" string
 * (`routeHref(\`loan/${id}\`)`) — the call sites this replaced were written
 * both ways, and normalising eighty of them into one form would have been a
 * larger change than the one being made.
 *
 * The argument is URL-encoded: ids are business data (a packet code, a loan
 * number) and a slash or a space in one would otherwise silently alter the
 * path it is pasted into.
 */
export function routeHref(route: string, arg?: string | number, slug?: string | null): string {
  let r = route;
  let a = arg;
  if (a === undefined && r.includes("/")) {
    const cut = r.indexOf("/");
    a = r.slice(cut + 1);
    r = r.slice(0, cut);
  }
  const tail = a === undefined || a === "" ? "" : `/${encodeURIComponent(String(a))}`;
  return `${prefix(slug)}/${r}${tail}`;
}

/* The event navigate() raises so the router re-reads the URL.
 *
 * history.pushState deliberately does NOT fire popstate — that event belongs
 * to the back button — so a hand-rolled router has to announce its own moves.
 * Without this the address bar would change and the screen would not. */
export const ROUTE_CHANGE_EVENT = "cloudhouse:routechange";

/**
 * navigate moves to a console route without a full page load.
 *
 * Navigating to the route already on screen still raises the event, so a page
 * can treat it as "reload me" — the same behaviour the old hash router had to
 * special-case, because assigning the hash it already had fired nothing.
 */
export function navigate(route: string, arg?: string | number, slug?: string | null): void {
  if (typeof window === "undefined") return;
  window.history.pushState(null, "", routeHref(route, arg, slug));
  window.dispatchEvent(new Event(ROUTE_CHANGE_EVENT));
}

/** The console's landing page for a business. */
export function appPath(slug?: string | null, route: string = DEFAULT_ROUTE): string {
  return routeHref(route, undefined, slug);
}

/** The business's sign-in page: /<slug>/login, or bare /login. */
export function loginPath(slug?: string | null): string {
  return `${prefix(slug)}/login`;
}

/** The operator's reset tool for one business: /<slug>/reset. */
export function resetPath(slug?: string | null): string {
  return `${prefix(slug)}/reset`;
}
