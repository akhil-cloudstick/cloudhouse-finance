/* The platform's base domain each business is given a subdomain of, e.g.
 * "ambika" -> https://ambika.cloudhousesupport.site. Every business gets its
 * own subdomain of one shared deployment now (see
 * backend/internal/tenant/host.go's SubdomainLabel and
 * frontend/product/services/tenantSession.ts's businessSlugFromHost, which
 * resolve the same domain from the other direction), so the tenant's own
 * live URL is a subdomain of this, never a slugged path on a fixed origin. */
const BASE_DOMAIN = "cloudhousesupport.site";

/** The staff sign-in link for a business, given its `code`: that business's
 * own subdomain of BASE_DOMAIN. Login (or any other page — there is no path
 * segment to add) resolves entirely from the Host header on that subdomain,
 * per backend/internal/tenant/host.go's SubdomainLabel, so no /login suffix
 * or slug is needed here. */
export function tenantLoginLink(code: string): string {
  return `https://${code}.${BASE_DOMAIN}`;
}
