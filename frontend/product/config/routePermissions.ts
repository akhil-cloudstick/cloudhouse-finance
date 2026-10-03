/* Every route the router can reach, mapped to the permission that gates it.
 * module: null means always reachable (Dashboard).
 *
 * The ONE place that mapping lives, read three ways:
 *   - AppShell's View renders NoAccess for a route the role can't view, which
 *     stops a typed/bookmarked URL — including detail routes (a customer/loan/
 *     packet id), which need the same permission as their list page (§11);
 *   - navigate() (services/appRoutes.ts) and AppShell's link interceptor
 *     refuse a jump to such a route with a toast, so a link, button or KPI
 *     card never lands the user on that NoAccess page;
 *   - pages use useCanOpenRoute() to not offer the link at all.
 *
 * Keep in step with APP_ROUTES in routes.ts: that decides whether a URL
 * segment IS a route, this decides WHO may reach it. A route missing here is
 * reachable by anyone.
 *
 * A leaf module (no imports), like routes.ts, so services/appRoutes.ts can
 * read it without a cycle.
 */
export type RouteGate = { module: string | null; key?: string; tenantModule?: string };

export const ROUTE_PERMISSIONS: Record<string, RouteGate> = {
  dashboard: { module: null },
  customers: { module: "Customer_Management", key: "can_view_customer_module" },
  customer: { module: "Customer_Management", key: "can_view_customer_module" },
  loans: { module: "Loan_Management", key: "can_view_loan_module" },
  loan: { module: "Loan_Management", key: "can_view_loan_module" },
  newloan: { module: "Loan_Management", key: "can_create_loan" },
  schemes: { module: "Scheme_Management", key: "can_view_scheme_module" },
  goldrates: { module: "Gold_Rate_Management", key: "can_view_gold_rate_module" },
  requests: { module: "Loan_Management", key: "can_view_loan_module" },
  loanrisk: { module: "Loan_Management", key: "can_view_loan_module" },
  personalloans: { module: "Personal_Loan_Management", key: "can_view_personal_loan_module", tenantModule: "personal_loans" },
  personalloan: { module: "Personal_Loan_Management", key: "can_view_personal_loan_module" },
  investments: { module: "Investment_Management", key: "can_view_investment_module", tenantModule: "investments" },
  investment: { module: "Investment_Management", key: "can_view_investment_module" },
  ledger: { module: "Cash_Management", key: "can_view_cash_module" },
  auctions: { module: "Auction_Workflow", key: "can_view_auction_module" },
  packets: { module: "Packet_Management", key: "can_view_packet_module" },
  packet: { module: "Packet_Management", key: "can_view_packet_module" },
  bankpledge: { module: "Bank_Pledge_Management", key: "can_view_bank_pledge_module" },
  reports: { module: "Report_Management", key: "can_view_report_module" },
  employees: { module: "Employee_Management", key: "can_view_employee_module" },
  calendar: { module: "Reminder_Management", key: "can_view_reminder_module" },
  branches: { module: "Branch_Management", key: "can_view_branch_module", tenantModule: "branches" },
  banks: { module: "Bank_Management", key: "can_view_bank_module" },
  // Drill-down-only routes off the Cash & Expenses page — reuse can_view_cash_module
  // (viewing a party's ledger is a drill-down of data the user can already
  // see there, not a new resource) rather than a new permission.
  "ledger-bank": { module: "Cash_Management", key: "can_view_cash_module" },
  "ledger-customer": { module: "Cash_Management", key: "can_view_cash_module" },
  "ledger-category": { module: "Cash_Management", key: "can_view_cash_module" },
  "cash-ledger": { module: "Cash_Management", key: "can_view_cash_module" },
  "upi-ledger": { module: "Cash_Management", key: "can_view_cash_module" },
  "bank-transfer-ledger": { module: "Cash_Management", key: "can_view_cash_module" },
  "cheque-ledger": { module: "Cash_Management", key: "can_view_cash_module" },
  "roles-permissions": { module: "Role_Management", key: "can_view_role_and_permission_module" },
  billing: { module: "Billing", key: "can_manage_billing" },
  settings: { module: "Settings_Management", key: "can_view_setting_module", tenantModule: "settings" },
};

type Can = (moduleKey: string, permissionKey: string) => boolean;
type HasModule = (key: string) => boolean;

/** "loan/12" → "loan"; a route name passes through. */
export function baseRoute(route: string): string {
  const cut = route.indexOf("/");
  return cut >= 0 ? route.slice(0, cut) : route;
}

/** Whether the role holds the route's permission. Unknown routes are allowed. */
export function routePermitted(route: string, can: Can): boolean {
  const gate = ROUTE_PERMISSIONS[baseRoute(route)];
  return !gate || gate.module === null || can(gate.module, gate.key!);
}

/** routePermitted plus the business's optional-module entitlement. */
export function routeAllowed(route: string, can: Can, hasModule: HasModule): boolean {
  const gate = ROUTE_PERMISSIONS[baseRoute(route)];
  return routePermitted(route, can) && (!gate?.tenantModule || hasModule(gate.tenantModule));
}

// navigate() is a plain function, so it can't use the auth/branding hooks —
// AppShell registers a checker (which also shows the refusal toast) here.
let guard: ((route: string) => boolean) | null = null;

export function setNavigationGuard(fn: ((route: string) => boolean) | null) {
  guard = fn;
}

/** True when a jump to `route` may go ahead; allowed until a guard is set. */
export function navigationAllowed(route: string): boolean {
  return !guard || guard(route);
}
