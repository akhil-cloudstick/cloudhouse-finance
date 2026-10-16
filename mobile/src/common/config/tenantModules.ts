/* Optional per-business modules — the ones a super admin switches on or off
 * for each business (backend tenant.KnownModules). Which of them a business
 * has comes from the backend at runtime (ThemeProvider's hasModule, fed by
 * GET /branding); this file only says which part of the app each one covers.
 *
 * The ONE place that mapping lives: the More sheet, the header, the route
 * guard in app/(tabs)/_layout.tsx and the Reports tiles all read it, so
 * gating a new module is one line here instead of a check per screen.
 * Mirrors the web's ROUTE_PERMISSIONS/Sidebar `tenantModule` fields.
 *
 * These only decide what is DRAWN. The backend refuses the API calls for a
 * module that is off (platform.RequireTenantModule) regardless.
 */
export const TENANT_MODULES = {
  settings: "settings",
  branches: "branches",
  demoReset: "demo_reset",
  whatsapp: "whatsapp",
  personalLoans: "personal_loans",
  investments: "investments",
  multipleInterest: "multiple_interest",
} as const;

export type TenantModule = (typeof TENANT_MODULES)[keyof typeof TENANT_MODULES];

/** Top-level route under app/(tabs) → the module that must be enabled for it. */
export const ROUTE_TENANT_MODULE: Record<string, TenantModule> = {
  settings: TENANT_MODULES.settings,
  branches: TENANT_MODULES.branches,
  "personal-loans": TENANT_MODULES.personalLoans,
  investments: TENANT_MODULES.investments,
};

/** Whether a top-level route is available to this business. Routes with no
 * module behind them are always available (permissions still apply). */
export function routeEnabled(route: string, hasModule: (key: string) => boolean): boolean {
  const mod = ROUTE_TENANT_MODULE[route];
  return !mod || hasModule(mod);
}
