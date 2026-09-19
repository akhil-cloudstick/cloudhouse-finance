/* The one thing superadminService.ts needs from the tenant app's
 * common/services/httpClient.ts — API_BASE — without pulling in the rest of
 * that module, which attaches the STAFF JWT and the branch-switcher header
 * that mean nothing to a superadmin session (see superadminService.ts's own
 * header comment on why it never reuses that wrapper). Kept as its own tiny
 * file rather than a copy of httpClient.ts so there is exactly one thing to
 * keep in step with the tenant app: this constant's default. */
export const API_BASE = process.env.NEXT_PUBLIC_API_BASE || "/api/v1";
