/* Per-business sessions and links.
 *
 * The app is sold to many independent businesses from one deployment, so a
 * username is only unique WITHIN a business and the backend needs to know
 * which one a login is for. It learns that from a `businessCode`, and the
 * business reaches its staff through a per-business link: /login/<slug>,
 * /app/<slug>.
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
 *    a single "ambikagold_token" key meant two businesses open in two tabs
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

/* Where the last-used business is remembered, so bare /login and /app resolve
 * to something instead of dead-ending. A pointer only — never a source of
 * authority. */
const ACTIVE_BUSINESS_KEY = "ambikagold_active_business";

/* The pre-multi-tenancy keys. Read once by migrateLegacySession() so an
 * existing signed-in user is not logged out by the deploy that introduces
 * per-business keys, then removed. */
const LEGACY_TOKEN_KEY = "ambikagold_token";
const LEGACY_EMPLOYEE_KEY = "ambikagold_employee";

/* The bucket used when no slug is known — the single-business installation,
 * which is every installation today. Named rather than empty so the storage
 * keys stay readable in devtools. */
const DEFAULT_BUCKET = "default";

/* Slugs are lowercase alphanumeric plus dashes. Anything else is not treated
 * as a slug at all, which keeps a stray path segment ("/login/callback") from
 * being mistaken for a business and sent to the backend as a code. */
const SLUG_PATTERN = /^[a-z0-9][a-z0-9-]*$/;

/* The path prefixes that carry a business slug. */
const SLUGGED_PREFIXES = ["login", "app"] as const;

export function isValidBusinessSlug(value: string): boolean {
  return SLUG_PATTERN.test(value) && value.length <= 60;
}

/* businessSlugFromPath pulls the slug out of /login/<slug> or /app/<slug>.
 * Returns null for bare /login, /app, and any path whose segment is not a
 * well-formed slug. */
export function businessSlugFromPath(pathname?: string): string | null {
  const path = pathname ?? (typeof window === "undefined" ? "" : window.location.pathname);
  const parts = path.split("/").filter(Boolean);
  if (parts.length < 2) return null;
  if (!SLUGGED_PREFIXES.includes(parts[0] as (typeof SLUGGED_PREFIXES)[number])) return null;
  const candidate = parts[1].toLowerCase();
  return isValidBusinessSlug(candidate) ? candidate : null;
}

/* activeBusinessSlug is the business this browser tab is operating as: the
 * one in the URL if there is one, otherwise the last one used here.
 *
 * The URL wins deliberately. It is what makes two tabs on two businesses work
 * — each tab reads its own slug from its own address bar, so neither depends
 * on a shared "current business" value that the other could overwrite. */
export function activeBusinessSlug(): string | null {
  const fromPath = businessSlugFromPath();
  if (fromPath) return fromPath;
  if (typeof window === "undefined") return null;
  const remembered = window.localStorage.getItem(ACTIVE_BUSINESS_KEY);
  return remembered && isValidBusinessSlug(remembered) ? remembered : null;
}

export function rememberActiveBusiness(slug: string | null): void {
  if (typeof window === "undefined") return;
  if (slug && isValidBusinessSlug(slug)) {
    window.localStorage.setItem(ACTIVE_BUSINESS_KEY, slug);
  } else {
    window.localStorage.removeItem(ACTIVE_BUSINESS_KEY);
  }
}

function bucket(slug?: string | null): string {
  const s = slug === undefined ? activeBusinessSlug() : slug;
  return s && isValidBusinessSlug(s) ? s : DEFAULT_BUCKET;
}

/* The storage keys for one business's session. */
export function sessionKeys(slug?: string | null) {
  const b = bucket(slug);
  return {
    token: `ambikagold_token::${b}`,
    employee: `ambikagold_employee::${b}`,
    permissions: `ambikagold_permissions::${b}`,
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

/* migrateLegacySession moves a pre-multi-tenancy session into the keyed
 * layout, so introducing per-business keys does not log everybody out on
 * deploy day. Runs once; the old keys are removed whether or not they held
 * anything, so it cannot run twice on the same data. */
export function migrateLegacySession(): void {
  if (typeof window === "undefined") return;
  const legacyToken = window.localStorage.getItem(LEGACY_TOKEN_KEY);
  if (legacyToken) {
    const keys = sessionKeys(null); // the default bucket: no slug existed then
    if (!window.localStorage.getItem(keys.token)) {
      window.localStorage.setItem(keys.token, legacyToken);
      const legacyEmployee = window.localStorage.getItem(LEGACY_EMPLOYEE_KEY);
      if (legacyEmployee) window.localStorage.setItem(keys.employee, legacyEmployee);
    }
  }
  window.localStorage.removeItem(LEGACY_TOKEN_KEY);
  window.localStorage.removeItem(LEGACY_EMPLOYEE_KEY);
}

/* Link builders. Used everywhere instead of hardcoded "/login" and "/app" so
 * a signed-in user is never bounced to a URL that has forgotten which
 * business they belong to. */
export function loginPath(slug?: string | null): string {
  const s = slug === undefined ? activeBusinessSlug() : slug;
  return s && isValidBusinessSlug(s) ? `/login/${s}` : "/login";
}

export function appPath(slug?: string | null, hash = "#dashboard"): string {
  const s = slug === undefined ? activeBusinessSlug() : slug;
  return s && isValidBusinessSlug(s) ? `/app/${s}${hash}` : `/app${hash}`;
}

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
  return s && isValidBusinessSlug(s) ? s : "";
}
