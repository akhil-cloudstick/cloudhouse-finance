// Keep in step with APP_ROUTES in routes.ts: that decides whether a URL segment IS a route, this decides WHO may reach it.
// multiBranchOnly: on a single-branch plan, treated like an optional module that's off.
export type RouteGate = { module: string | null; key?: string; tenantModule?: string; multiBranchOnly?: boolean };

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
  personalloan: { module: "Personal_Loan_Management", key: "can_view_personal_loan_module", tenantModule: "personal_loans" },
  investments: { module: "Investment_Management", key: "can_view_investment_module", tenantModule: "investments" },
  investment: { module: "Investment_Management", key: "can_view_investment_module", tenantModule: "investments" },
  ledger: { module: "Cash_Management", key: "can_view_cash_module" },
  auctions: { module: "Auction_Workflow", key: "can_view_auction_module" },
  packets: { module: "Packet_Management", key: "can_view_packet_module" },
  packet: { module: "Packet_Management", key: "can_view_packet_module" },
  bankpledge: { module: "Bank_Pledge_Management", key: "can_view_bank_pledge_module" },
  reports: { module: "Report_Management", key: "can_view_report_module" },
  employees: { module: "Employee_Management", key: "can_view_employee_module" },
  calendar: { module: "Reminder_Management", key: "can_view_reminder_module" },
  branches: { module: "Branch_Management", key: "can_view_branch_module", tenantModule: "branches", multiBranchOnly: true },
  banks: { module: "Bank_Management", key: "can_view_bank_module" },
  // Drill-downs off the Cash & Expenses page reuse can_view_cash_module rather than a new permission.
  "ledger-bank": { module: "Cash_Management", key: "can_view_cash_module" },
  // Opened from Branch Management's Ledger link — gated like that link.
  "ledger-branch": { module: "Branch_Management", key: "can_view_branch_ledger", tenantModule: "branches", multiBranchOnly: true },
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

export function baseRoute(route: string): string {
  const cut = route.indexOf("/");
  return cut >= 0 ? route.slice(0, cut) : route;
}

export function routePermitted(route: string, can: Can): boolean {
  const gate = ROUTE_PERMISSIONS[baseRoute(route)];
  return !gate || gate.module === null || can(gate.module, gate.key!);
}

export function routeEntitled(route: string, hasModule: HasModule, singleBranch = false): boolean {
  const gate = ROUTE_PERMISSIONS[baseRoute(route)];
  if (!gate) return true;
  if (gate.tenantModule && !hasModule(gate.tenantModule)) return false;
  return !(singleBranch && gate.multiBranchOnly);
}

export function routeAllowed(route: string, can: Can, hasModule: HasModule, singleBranch = false): boolean {
  return routePermitted(route, can) && routeEntitled(route, hasModule, singleBranch);
}

// navigate() is a plain function, so it can't use the auth/branding hooks —
// AppShell registers a checker (which also shows the refusal toast) here.
let guard: ((route: string) => boolean) | null = null;

export function setNavigationGuard(fn: ((route: string) => boolean) | null) {
  guard = fn;
}

export function navigationAllowed(route: string): boolean {
  return !guard || guard(route);
}
