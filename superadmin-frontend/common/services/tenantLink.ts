/* Builds the sign-in link this console shows an operator for a given
 * business, e.g. to copy and send to that business's own admin.
 *
 * This console is now its OWN app on its own origin (see the repo root's
 * documents/multitenancy_plan.md, "extract superadmin into its own
 * app/portal") — the sign-in link it shows must point at the TENANT app's
 * origin, never `window.location.origin`, which here would be this
 * console's own origin instead. NEXT_PUBLIC_TENANT_APP_ORIGIN is the one
 * thing that has to be configured per deployment; there is deliberately no
 * way to derive it, because the two apps are meant to be independently
 * deployable (different hosts, different subdomains — see the plan). */
const TENANT_APP_ORIGIN = process.env.NEXT_PUBLIC_TENANT_APP_ORIGIN || "http://localhost:3000";

/** The staff sign-in link for a business, given its `code`. Mirrors
 * frontend/common/services/tenantSession.ts's loginPath — kept as a small
 * local re-implementation rather than a cross-app import, since the two
 * apps intentionally do not share a build. */
export function tenantLoginLink(code: string): string {
  return `${TENANT_APP_ORIGIN}/login/${code}`;
}
