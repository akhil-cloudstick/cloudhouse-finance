"use client";

import { Icon } from "@/common/components/Icon";
import { useAuth } from "@/common/auth-context";
import { BRAND } from "@/common/config/brand";
import { useBranding } from "@/common/BrandingProvider";
import BrandLogo from "@/common/components/BrandLogo";

/* Ported from legacy/app.js's `NAV` array + nav-building/active-link logic
 * in `router()`. Each item now also carries the permission that gates it
 * (module, key — the same underscored keys the backend derives, see
 * common/services/permissionService.ts) so filtering is driven by the
 * actual permissions table instead of hardcoded role-name checks (see the
 * house role-permission standard's §12). `module: null` means always
 * visible — no permission governs it (Dashboard). */
type NavItem = {
  route: string;
  title: string;
  icon: string;
  module: string | null;
  key?: string;
  /* tenantModule gates the item on an OPTIONAL MODULE the vendor grants per
   * business (tenant.KnownModules). That is a different question from the
   * permission above and both must pass: `module`/`key` ask whether this
   * ROLE may use a feature, this asks whether the business has the feature
   * at all. Undefined means every business gets it. */
  tenantModule?: string;
};

export const NAV: [string, NavItem[]][] = [
  ["Overview", [
    { route: "dashboard", title: "Dashboard", icon: "home", module: null },
    { route: "calendar", title: "Reminder Calendar", icon: "cal", module: "Reminder_Management", key: "can_view_reminder" },
    { route: "reports", title: "Reports", icon: "chart", module: "Report_Management", key: "can_view_report" },
  ]],
  ["Lending", [
    { route: "loans", title: "Loans", icon: "list", module: "Loan_Management", key: "can_view_loan" },
    { route: "newloan", title: "New Gold Loan", icon: "plus", module: "Loan_Management", key: "can_create_loan" },
    { route: "schemes", title: "Loan Schemes", icon: "doc", module: "Scheme_Management", key: "can_view_scheme" },
    { route: "goldrates", title: "Gold Rates", icon: "coin", module: "Gold_Rate_Management", key: "can_view_gold_rate" },
    { route: "requests", title: "Extensions & Release", icon: "unlock", module: "Loan_Management", key: "can_view_loan" },
    { route: "loanrisk", title: "Loan Risk", icon: "warning", module: "Loan_Management", key: "can_view_loan" },
    { route: "personalloans", title: "Personal Loans", icon: "note", module: "Personal_Loan_Management", key: "can_view_personal_loan", tenantModule: "personal_loans" },
    { route: "investments", title: "Investments", icon: "coin", module: "Investment_Management", key: "can_view_investment", tenantModule: "investments" },
  ]],
  ["Customers", [
    { route: "customers", title: "Customers & KYC", icon: "user", module: "Customer_Management", key: "can_view_customer" },
  ]],
  ["Gold Custody", [
    { route: "packets", title: "Packets & Lockers", icon: "box", module: "Packet_Management", key: "can_view_packet" },
    { route: "bankpledge", title: "Bank Re-Pledge", icon: "bank", module: "Bank_Pledge_Management", key: "can_view_bank_pledge" },
    { route: "auctions", title: "Auctions", icon: "gavel", module: "Loan_Management", key: "can_view_loan" },
  ]],
  ["Operations", [
    { route: "cash", title: "Cash & Expenses", icon: "coin", module: "Cash_Management", key: "can_view_cash" },
    { route: "employees", title: "Employees & Roles", icon: "user", module: "Employee_Management", key: "can_view_employee" },
  ]],
  ["Administration", [
    { route: "branches", title: "Branch Management", icon: "bank", module: "Branch_Management", key: "can_view_branch", tenantModule: "branches" },
    { route: "roles-permissions", title: "Roles & Permissions", icon: "shield", module: "Role_Management", key: "can_view_role_and_permission" },
    { route: "billing", title: "Billing", icon: "coin", module: "Billing", key: "can_manage_billing" },
    { route: "settings", title: "Settings", icon: "gear", module: "Settings_Management", key: "can_view_setting", tenantModule: "settings" },
  ]],
];

export function Sidebar({ route, open, onNavigateSameRoute }: { route: string; open: boolean; onNavigateSameRoute?: () => void }) {
  const { can } = useAuth();
  const { hasModule, name: businessName, shortName } = useBranding();

  /* The bold headline is the business's SHORT identity ("CTFI"), the small
   * line under it its full name ("Chittilapilly Thommana") — not a split of
   * one string across two sizes (an earlier version did that, which is why
   * a business with no distinct short name still needs one: shortName falls
   * back to the full name server-side, so a business that has not set one
   * just repeats its full name on both lines rather than an awkward
   * word-split). */
  const lockupTop = shortName || businessName || BRAND.shortName;
  const lockupBottom = businessName || BRAND.name;

  return (
    <aside className={`side${open ? " open" : ""}`} id="side">
      <div className="brand" style={{marginRight:-10}}>
        {/* One lockup: the logo, then a text column splitting the name over
          * two lines. Both share a single left edge — an earlier version put
          * the second line on its own full-width row, which left the first
          * aligned to nothing. The halves come from nameTop/nameBottom, not
          * shortName + name, because those two overlap: the short name is a
          * prefix of the full one and the lockup read "CloudHouse" above
          * "CloudHouse Finance". */}
        {/* Size lives in CSS (.side .brand .brand-mark), not in this prop, so
          * the mark and the wordmark beside it can be scaled together at the
          * narrow-sidebar breakpoint. The prop only sets the SSR'd width/height
          * attributes, which CSS then overrides. */}
        <BrandLogo size={48} className="brand-mark" />
        <div className="t">
          <b>{lockupTop}</b>
          {lockupBottom && <span className="brand-full">{lockupBottom}</span>}
        </div>
      </div>
      <nav className="nav" id="navBox">
        {NAV.map(([group, items]) => {
          // A permission-gated item is filtered OUT of the array (never
          // rendered disabled) — §12.3. An empty group renders no heading
          // at all, so a role with nothing in "Gold Custody" doesn't see a
          // bare, empty section (§12.4).
          // Two independent gates, both of which must pass: the role's
          // permission, and — for an optional module — whether the business
          // was granted the feature at all. Filtering (never disabling) an
          // item out means a business without Settings sees no Settings
          // link rather than one that 403s.
          const visible = items.filter(
            (item) =>
              (item.module === null || can(item.module, item.key!)) &&
              (!item.tenantModule || hasModule(item.tenantModule))
          );
          if (visible.length === 0) return null;
          return (
            <div key={group}>
              <div className="grp">{group}</div>
              {visible.map(({ route: r, title: t, icon: ic }) => {
                const isOn =
                  route === r ||
                  (route === "loan" && r === "loans") ||
                  (route === "customer" && r === "customers") ||
                  (route === "personalloan" && r === "personalloans") ||
                  (route === "investment" && r === "investments");
                // Distinct from `isOn` (which also highlights "Loans" while
                // viewing a loan's own detail page, "Customers" while
                // viewing a customer's own detail page, etc.) — clicking
                // "Loans" from a loan's detail page must still navigate to
                // the list; only a click that lands on the EXACT same
                // route already showing needs special handling below.
                const isExactSameRoute = route === r;
                return (
                  <a
                    key={r}
                    href={`#${r}`}
                    className={isOn ? "on" : ""}
                    onClick={(e) => {
                      // Clicking the item for the page already open doesn't
                      // change location.hash (it's already that value), so
                      // the browser never fires `hashchange` — the page
                      // just silently stays exactly as it was, including
                      // whatever filters/sub-view it had drifted into. This
                      // forces that same "start fresh" reload staff expect
                      // from clicking a nav item, even when it's already
                      // the current page.
                      if (isExactSameRoute) {
                        e.preventDefault();
                        onNavigateSameRoute?.();
                      }
                    }}
                  >
                    <Icon name={ic} />
                    {t}
                  </a>
                );
              })}
            </div>
          );
        })}
      </nav>
      <div className="sfoot">
        Trust · Value · Growth
        <br />
        {/* <a href="/login" onClick={handleSignOut}>← Sign out</a> */}
      </div>
    </aside>
  );
}
