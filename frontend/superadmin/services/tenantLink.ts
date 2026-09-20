/* Builds the sign-in link this console shows an operator for a given
 * business, e.g. to copy and send to that business's own admin.
 *
 * The eventual plan is for this console to be its OWN app on its own origin
 * (see the repo root's documents/multitenancy_plan.md, "extract superadmin
 * into its own app/portal") — at that point the tenant app's origin could no
 * longer be read from window.location.origin (that would be THIS console's
 * origin instead), and NEXT_PUBLIC_TENANT_APP_ORIGIN would need to be set
 * per deployment. But that extraction "is tracked separately and not done
 * here" (documents/local_multitenant_testing.md) — TODAY this console is
 * still mounted inside the same Next app as the tenant app, same origin,
 * same Docker deployment (see documents/local_multitenant_testing.md: each
 * business still gets its own whole deployment, not its own subdomain of a
 * shared one). So window.location.origin IS the tenant app's origin right
 * now, and is a far safer default than a hardcoded localhost — a build that
 * forgets to set NEXT_PUBLIC_TENANT_APP_ORIGIN silently handed out
 * http://localhost:3000 links that only worked on whoever built it. */
function tenantAppOrigin(): string {
  const configured = process.env.NEXT_PUBLIC_TENANT_APP_ORIGIN;
  if (configured) return configured;
  if (typeof window !== "undefined") return window.location.origin;
  return "http://localhost:3000";
}

/** The staff sign-in link for a business, given its `code`. Mirrors
 * frontend/common/services/tenantSession.ts's loginPath — kept as a small
 * local re-implementation rather than a cross-app import, since the two
 * apps intentionally do not share a build. The code leads the path
 * (/<code>/login), matching loginPath, next.config.ts's rewrites and
 * backend/internal/webstatic's sluggedPage — /login/<code> matches none of
 * those and falls through to the generic shell. */
export function tenantLoginLink(code: string): string {
  return `${tenantAppOrigin()}/${code}/login`;
}
