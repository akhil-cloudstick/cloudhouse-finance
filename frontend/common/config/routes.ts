// A leaf module with no imports, kept separate so tenantSession.ts and appRoutes.ts don't become circular.
// Keep in step with ROUTE_PERMISSIONS: that decides WHO may reach a route, this decides whether a URL segment IS one.
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
  "ledger",
  "auctions",
  "packets",
  "packet",
  "bankpledge",
  "reports",
  "employees",
  "calendar",
  "branches",
  "banks",
  "ledger-bank",
  "ledger-customer",
  "ledger-branch",
  "ledger-category",
  "cash-ledger",
  "upi-ledger",
  "bank-transfer-ledger",
  "cheque-ledger",
  "roles-permissions",
  "billing",
  "settings",
] as const;

export type AppRoute = (typeof APP_ROUTES)[number];

export const DEFAULT_ROUTE: AppRoute = "dashboard";

// Old route names still accepted; the address bar rewrites to the new one (see useAppRoute).
export const ROUTE_ALIASES: Readonly<Record<string, AppRoute>> = {
  cash: "ledger",
  "party-category": "ledger-category",
};

// Pages that sit under a business but are not console routes.
export const STANDALONE_PAGES = ["login", "reset"] as const;
export type StandalonePage = (typeof STANDALONE_PAGES)[number];

// Keeps a stray path segment from being mistaken for a business and sent to the backend as a code.
const SLUG_PATTERN = /^[a-z0-9][a-z0-9-]*$/;

// First path segments that can never be a business — each is served by something other than a tenant,
// or is an app route that would shadow the real page. isValidBusinessSlug also refuses these as business codes.
export const RESERVED_ROOT_SEGMENTS: ReadonlySet<string> = new Set<string>([
  ...APP_ROUTES,
  ...Object.keys(ROUTE_ALIASES),
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

// A business coded "api" or "loans" would produce links that can never resolve to it.
export function isValidBusinessSlug(value: string): boolean {
  return (
    SLUG_PATTERN.test(value) && value.length <= 60 && !RESERVED_ROOT_SEGMENTS.has(value)
  );
}

export function isBusinessSegment(segment: string): boolean {
  return isValidBusinessSlug(segment);
}
