import { useAuth } from "@/common/providers/AuthProvider";
import { useTheme } from "@/common/theme/ThemeProvider";
import { routeEnabled } from "@/common/config/tenantModules";
import { routeAllowed } from "@/common/config/routePermissions";

// ---------------------------------------------------------------------------
// More (prototype #more-modal) + the modules the prototype doesn't list.
// ---------------------------------------------------------------------------
// A route row's permission is its page's ROUTE_PERMISSIONS entry; `perms` is only
// for rows that open a sheet instead of a page.
export type MoreRow = { key: string; route?: string; title: string; sub: string; icon: string; perms?: [string, string][]; action?: "gold" };
// Order: the loan-side modules first, then custody, staff and the ledger (as asked), then the
// rest in the web sidebar's order (frontend/common/components/layout/Sidebar.tsx).
const MORE_ROWS: MoreRow[] = [
  { key: "personal-loans", route: "personal-loans", title: "Personal Loans", sub: "Non-gold loans & collections", icon: "card" },
  { key: "investments", route: "investments", title: "Investments", sub: "Deposits, plans & payouts", icon: "coin" },
  { key: "loan-risk", route: "loan-risk", title: "Loan Risk", sub: "Risk assessment across active loans", icon: "chart" },
  { key: "gold-rates", route: "gold-rates", title: "Gold Rates", sub: "Today's rate & rate history", icon: "coin" },
  { key: "requests", route: "requests", title: "Extension & Release", sub: "Loan extensions & gold release", icon: "edit" },
  { key: "packets", route: "packets", title: "Packets & Lockers", sub: "Ornament custody tracking", icon: "doc" },
  { key: "banks", route: "banks", title: "Bank Pledges", sub: "Loans pledged to a bank", icon: "card" },
  { key: "auctions", route: "auctions", title: "Auctions", sub: "Active cases & auction history", icon: "gavel" },
  { key: "employees", route: "employees", title: "Employees", sub: "Staff accounts & roles", icon: "user" },
  { key: "cash", route: "cash", title: "Ledger", sub: "Movements, expenses & gold sales", icon: "coin" },
  { key: "reminders", route: "reminders", title: "Reminders", sub: "Follow-ups & promise-to-pay", icon: "calendar" },
  { key: "reports", route: "reports", title: "Reports", sub: "Branch reports & summaries", icon: "note" },
  { key: "branches", route: "branches", title: "Branches", sub: "Branch details & lockers", icon: "home" },
  { key: "bank-management", route: "bank-management", title: "Bank Management", sub: "Banks & net balance", icon: "coin" },
  { key: "roles", route: "roles", title: "Roles & Permissions", sub: "What each role can do", icon: "shield" },
  { key: "support", route: "support", title: "Support", sub: "Contact our support team", icon: "headset" },
  // Billing & Plan (read-only plan card).
  { key: "billing", route: "billing", title: "Billing & Plan", sub: "Your plan and its status", icon: "card" },
];
/** The More rows this user may open; the tab bar hides More when it's empty. */
export function useMoreRows(): MoreRow[] {
  const { can } = useAuth();
  const { hasModule } = useTheme();
  return MORE_ROWS.filter(
    (r) =>
      (r.route ? routeAllowed(r.route, can) : (r.perms ?? []).some(([m, k]) => can(m, k))) &&
      (!r.route || routeEnabled(r.route, hasModule))
  );
}
