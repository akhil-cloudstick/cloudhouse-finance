/* The link a business's staff sign in at, derived from WHERE THIS CONSOLE IS
 * RUNNING — never from a hard-coded domain, and never from the business's
 * saved appUrl (which records wherever it happened to be deployed once, and
 * goes stale the moment the domain changes or the app is run locally).
 *
 * The product app resolves a business from either shape (see
 * common/services/tenantSession.ts's businessSlugFromHost and
 * businessSlugFromPath), so the link follows the console's own address:
 *
 *   superadmin.cloudhousefinance.site  -> https://<code>.cloudhousefinance.site
 *   superadmin.localhost:3001          -> http://<code>.localhost:3001
 *   localhost:3001 / an IP / any host  -> http://localhost:3001/<code>
 *
 * NEXT_PUBLIC_TENANT_APP_ORIGIN, when set, overrides all of this with an
 * explicit origin and the path shape (<origin>/<code>). */

const TENANT_APP_ORIGIN = (process.env.NEXT_PUBLIC_TENANT_APP_ORIGIN || "").replace(/\/+$/, "");

/** The staff sign-in link for a business, given its `code`. */
export function tenantLoginLink(code: string): string {
  if (TENANT_APP_ORIGIN) return `${TENANT_APP_ORIGIN}/${code}`;
  if (typeof window === "undefined") return `/${code}`;

  const { protocol, hostname, port, origin } = window.location;
  const labels = hostname.toLowerCase().split(".");
  // Only a "superadmin.<domain>" host means businesses live on subdomains of
  // that same domain; every other host serves them as a path segment.
  if (labels.length >= 2 && labels[0] === "superadmin") {
    const domain = labels.slice(1).join(".");
    return `${protocol}//${code}.${domain}${port ? `:${port}` : ""}`;
  }
  return `${origin}/${code}`;
}
