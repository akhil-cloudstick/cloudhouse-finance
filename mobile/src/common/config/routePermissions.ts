/* Which permission each top-level page under app/(tabs) needs before it can
 * be opened — the mobile twin of the web's ROUTE_PERMISSIONS.
 *
 * The ONE place that mapping lives: openPage() (Shell.tsx) refuses a jump to
 * a page the user can't view, the tab-layout route guard bounces a deep link
 * or a router.push() that lands on one, and the tab bar / More sheet read the
 * same rows to decide what to draw. A page is allowed when ANY of its
 * permissions is granted; a page listed with none is open to everyone, and a
 * page not listed at all is refused.
 *
 * These only decide what the app lets you open. The backend refuses the
 * page's API calls regardless.
 */
import { useAuth } from "@/common/providers/AuthProvider";

export type PermissionRef =readonly [moduleKey: string, permissionKey: string];

export const ROUTE_PERMISSIONS: Record<string, readonly PermissionRef[]> = {
  dashboard: [],
  customers: [["Customer_Management", "can_view_customer_module"]],
  loans: [["Loan_Management", "can_view_loan_module"]],
  schemes: [["Scheme_Management", "can_view_scheme_module"]],
  auctions: [["Auction_Workflow", "can_view_auction_module"]],
  packets: [
    ["Packet_Management", "can_view_packet_module"],
    ["Locker_Management", "can_view_locker_module"],
  ],
  banks: [["Bank_Pledge_Management", "can_view_bank_pledge_module"]],
  requests: [["Loan_Management", "can_view_loan_module"]],
  // Also covers every /cash/<kind> drill-down ledger (bank, customer, mode,
  // category) — all of them read cash movements.
  cash: [["Cash_Management", "can_view_cash_module"]],
  "ledger-statement": [["Cash_Management", "can_view_cash_module"]],
  "personal-loans": [["Personal_Loan_Management", "can_view_personal_loan_module"]],
  investments: [["Investment_Management", "can_view_investment_module"]],
  reminders: [["Reminder_Management", "can_view_reminder_module"]],
  reports: [["Report_Management", "can_view_report_module"]],
  "loan-risk": [["Loan_Management", "can_view_loan_module"]],
  employees: [["Employee_Management", "can_view_employee_module"]],
  branches: [["Branch_Management", "can_view_branch_module"]],
  roles: [["Role_Management", "can_view_role_and_permission_module"]],
  settings: [["Settings_Management", "can_view_setting_module"]],
  billing: [["Billing", "can_manage_billing"]],
};

type Can = (moduleKey: string, permissionKey: string) => boolean;

/** The top-level route of a path: "/loans/12?x=1" → "loans". */
export function routeOf(path: string): string {
  return path.split("?")[0].replace(/^\/+/, "").replace(/^\(tabs\)\/?/, "").split("/")[0] ?? "";
}

/** Whether `can` may open a top-level route. Unknown routes are refused. */
export function routeAllowed(route: string, can: Can): boolean {
  const perms = ROUTE_PERMISSIONS[route];
  return !!perms && (perms.length === 0 || perms.some(([m, k]) => can(m, k)));
}

/** Whether `can` may open a path ("/loans/12", "/cash/bank?ref=3"). */
export function pathAllowed(path: string, can: Can): boolean {
  return routeAllowed(routeOf(path), can);
}

/** For drawing: a link/button to a page the user can't open is shown as
 * plain text or left out, rather than offered and then refused. */
export function useCanOpen(): (path: string) => boolean {
  const { can } = useAuth();
  return (path: string) => pathAllowed(path, can);
}

// openPage() is a plain function called from anywhere, so it can't use the
// auth hook — the tab layout registers the current checker here instead.
let current: Can | null = null;

export function setRouteChecker(can: Can | null) {
  current = can;
}

/** pathAllowed against the registered checker; refused until one is set. */
export function canOpenPath(path: string): boolean {
  return !!current && pathAllowed(path, current);
}
