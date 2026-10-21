// Per-business sessions and links: one deployment serves many businesses, so a username is only unique WITHIN a business, selected via businessCode / the /<slug>/... path prefix.
// Three rules: (1) the slug only SELECTS which business to authenticate against — after login the business comes from the token, never re-read from the URL; (2) sessions are KEYED BY SLUG since one shared origin would let two tabs on two businesses clobber each other's "cloudhouse_token"; (3) a bare /login must not dead-end — it falls back to the last business used on this browser.
// The slug is immutable identity: changing it breaks every saved bookmark.

import { isBusinessSegment, isValidBusinessSlug as isValidSlug } from "@/common/config/routes";

// Last-used business, so bare /login and /app resolve to something instead of dead-ending. A pointer only, never a source of authority.
const ACTIVE_BUSINESS_KEY = "cloudhouse_active_business";

// Storage keys from before the rebrand, kept only so purgeStaleSession() can delete them.
const STALE_KEYS = [
  "ambikagold_token",
  "ambikagold_employee",
  "ambikagold_active_business",
  "ambikagold_superadmin_token",
  "ambikagold_superadmin_user",
] as const;

// Bucket for when no slug is known (the single-business install). Named rather than empty so storage keys stay readable in devtools.
const DEFAULT_BUCKET = "default";

// Slug rules live in routes.ts (no imports, needed by both this module and appRoutes.ts); re-exported so existing callers keep working.
export { isValidBusinessSlug } from "@/common/config/routes";

// Reads the business from the first path segment (/ctfi/login, ...). Ambiguity ("/loans" could be a business) is settled by routes.ts's reserved list. Null for a bare path.
export function businessSlugFromPath(pathname?: string): string | null {
  const path = pathname ?? (typeof window === "undefined" ? "" : window.location.pathname);
  const parts = path.split("/").filter(Boolean);
  if (!parts.length) return null;
  const candidate = parts[0].toLowerCase();
  return isBusinessSegment(candidate) ? candidate : null;
}

// Host labels that never name a business (platform's own bare/marketing subdomains). "demo" is NOT reserved — it's an ordinary tenant code.
const RESERVED_HOST_LABELS = new Set(["www", "app", "admin", "api", "superadmin"]);

// Local-dev suffixes carrying a subdomain without a real DNS entry (see documents/local_multitenant_testing.md).
const LOCAL_HOST_SUFFIXES = ["localhost", "lvh.me", "nip.io"];

const IPV4_PATTERN = /^\d{1,3}(\.\d{1,3}){3}$/;

// The desktop app's own origin (Wails); it names no business.
const DESKTOP_HOST = "wails.localhost";

// Shared rule for businessSlugFromHost() and the desktop fallback: null for a bare apex domain, "localhost" alone, a raw IP, or a reserved label.
function subdomainLabel(host: string): string | null {
  if (!host || IPV4_PATTERN.test(host)) return null;
  const labels = host.split(".");
  if (labels.length < 2) return null; // "localhost" alone, or an unqualified host
  const candidate = labels[0];
  if (!isValidSlug(candidate) || RESERVED_HOST_LABELS.has(candidate)) return null;
  const rest = labels.slice(1).join(".");
  if (LOCAL_HOST_SUFFIXES.includes(rest)) return candidate;
  // A bare two-label apex ("cloudhousefinance.com") has no subdomain; only 3+ labels do.
  return labels.length >= 3 ? candidate : null;
}

// Wails always serves the desktop app from wails.localhost regardless of tenant, so there's no Host to read a slug from — use NEXT_PUBLIC_API_BASE's own hostname instead. Null (no-op) when it's unset or relative.
function desktopSlugFromApiBase(): string | null {
  const apiBase = process.env.NEXT_PUBLIC_API_BASE;
  if (!apiBase) return null;
  try {
    return subdomainLabel(new URL(apiBase).hostname.toLowerCase());
  } catch {
    return null; // relative path ("/api/v1") — no host to read
  }
}

// Reads a subdomain the way production resolves a tenant (https://ambika.cloudhousefinance.com/...). Only ever NAMES a candidate business for branding — never authorization; businessCodeForRequest still sends it as an ordinary code auth.Service validates. Falls back to desktopSlugFromApiBase() on the desktop app's own host.
export function businessSlugFromHost(hostname?: string): string | null {
  const host = (hostname ?? (typeof window === "undefined" ? "" : window.location.hostname)).toLowerCase();
  if (host === DESKTOP_HOST) return desktopSlugFromApiBase();
  return subdomainLabel(host);
}

// Order of authority: URL path, then URL host, then the last business used on this browser. Path wins over host (an explicit choice beats a subdomain default); each tab reads its own slug from its own address bar.
export function activeBusinessSlug(): string | null {
  const fromPath = businessSlugFromPath();
  if (fromPath) return fromPath;
  const fromHost = businessSlugFromHost();
  if (fromHost) return fromHost;
  if (typeof window === "undefined") return null;
  const remembered = window.localStorage.getItem(ACTIVE_BUSINESS_KEY);
  return remembered && isValidSlug(remembered) ? remembered : null;
}

// Names the active business AND reports which URL signal matched (path vs. host) — activeBusinessSlug() alone collapses that, which is how a host-resolved tenant could wrongly get a slug printed into a redirect URL it never typed.
// Deliberately excludes the remembered-business fallback; callers that want that tier ask for it themselves when this returns null.
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

// The storage keys for one business's session.
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

// Removes every bucket holding THIS EXACT token and returns how many. Sign-out's own activeBusinessSlug() at click-time isn't guaranteed to match the bucket writeSession chose, so clearing by slug alone could leave the token alive (an "already signed in" bounce-back). Matching on token VALUE instead is also what keeps two tabs on two businesses from clearing each other's session.
export function clearSessionsForToken(token: string | null): number {
  if (typeof window === "undefined" || !token) return 0;
  const prefix = "cloudhouse_token::";
  // Collected before mutating: removeItem reindexes localStorage, so removing mid-walk would skip entries.
  const buckets: string[] = [];
  for (let i = 0; i < window.localStorage.length; i++) {
    const key = window.localStorage.key(i);
    if (!key || !key.startsWith(prefix)) continue;
    if (window.localStorage.getItem(key) === token) buckets.push(key.slice(prefix.length));
  }
  buckets.forEach((b) => clearSession(b));
  return buckets.length;
}

// Mirrors the permission map per business in sessionStorage (dies with the tab — it's a cache, never an authority).
export function readPermissionsRaw(slug?: string | null): string | null {
  if (typeof window === "undefined") return null;
  return window.sessionStorage.getItem(sessionKeys(slug).permissions);
}

export function writePermissionsRaw(slug: string | null, json: string): void {
  if (typeof window === "undefined") return;
  window.sessionStorage.setItem(sessionKeys(slug).permissions, json);
}

// Deletes storage keys from the app's previous name (pre-rebrand); no value left to migrate, just housekeeping. Unconditional and idempotent.
export function purgeStaleSession(): void {
  if (typeof window === "undefined") return;
  for (const key of STALE_KEYS) window.localStorage.removeItem(key);
}

// Link builders moved to appRoutes.ts; re-exported since every caller already imports them from here.
export { appPath, loginPath, resetPath } from "@/common/services/appRoutes";

// Business code sent with login/reset/OTP requests. Empty when unknown is correct, not a fallback: guessing would authenticate someone against a business they never named.
export function businessCodeForRequest(slug?: string | null): string {
  const s = slug === undefined ? activeBusinessSlug() : slug;
  return s && isValidSlug(s) ? s : "";
}
