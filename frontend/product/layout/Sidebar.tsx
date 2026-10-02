"use client";

import { Icon } from "@/product/components/Icon";
import { useAuth } from "@/product/providers/auth-context";
import { useBranding } from "@/product/providers/BrandingProvider";
import BrandLogo from "@/product/components/BrandLogo";
import { routeHref } from "@/product/services/appRoutes";
import { resolveLockup } from "@/product/utils/brandLockup";

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
    { route: "ledger", title: "Ledger", icon: "coin", module: "Cash_Management", key: "can_view_cash" },
    { route: "employees", title: "Employees & Roles", icon: "user", module: "Employee_Management", key: "can_view_employee" },
  ]],
  ["Administration", [
    { route: "branches", title: "Branch Management", icon: "bank", module: "Branch_Management", key: "can_view_branch", tenantModule: "branches" },
    { route: "banks", title: "Bank Management", icon: "bank", module: "Bank_Management", key: "can_view_bank" },
    { route: "roles-permissions", title: "Roles & Permissions", icon: "shield", module: "Role_Management", key: "can_view_role_and_permission" },
    { route: "billing", title: "Billing", icon: "coin", module: "Billing", key: "can_manage_billing" },
    { route: "settings", title: "Settings", icon: "gear", module: "Settings_Management", key: "can_view_setting", tenantModule: "settings" },
  ]],
];

export function Sidebar({ route, open, onNavigateSameRoute }: { route: string; open: boolean; onNavigateSameRoute?: () => void }) {
  const { can } = useAuth();
  const { hasModule, name: businessName, shortName, lockupTagline } = useBranding();

  /* Which two lines to show, and at what size, is resolveLockup's call — see
   * common/utils/brandLockup.ts for why it is a shared pure function rather
   * than a couple of lines here. This used to hardcode "headline = short code,
   * subline = full name", which only ever read correctly for one business.
   *
   * No platform fallback anywhere in that path. On the one load where neither
   * the cache nor the fetch has produced a name yet, the lockup renders empty
   * rather than the vendor's: a business is never shown a brand that is not
   * its own, and an empty line for a moment is the honest version of "not
   * known yet". */
  const lockup = resolveLockup({ name: businessName, shortName, lockupTagline });

  return (
    <aside className={`side${open ? " open" : ""}`} id="side">
      <div className="brand">
        {/* One lockup: the logo, then a text column of up to two lines. Both
          * share a single left edge — an earlier version put the second line
          * on its own full-width row, which left the first aligned to
          * nothing. The overlap this once guarded against (the headline being
          * a prefix of the subline: "CloudHouse" above "CloudHouse Finance")
          * is now resolveLockup's job — it drops a subline that would only
          * restate the headline. */}
        {/* Size lives in CSS (.side .brand .brand-mark), not in this prop, so
          * the mark and the wordmark beside it can be scaled together at the
          * narrow-sidebar breakpoint. The prop only sets the SSR'd width/height
          * attributes, which CSS then overrides. */}
        <BrandLogo size={48} className="brand-mark" />
        {/* The fit tokens carry only a size STEP; the pixels behind them live
          * in app.css so the narrow-rail breakpoint can scale every step at
          * once instead of being patched per step. */}
        <div className="t">
          <b data-fit={lockup.topFit}>{lockup.top}</b>
          {lockup.bottom && <span className="brand-full" data-fit={lockup.bottomFit}>{lockup.bottom}</span>}
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
                    href={routeHref(r)}
                    className={isOn ? "on" : ""}
                    onClick={(e) => {
                      // Clicking the item for the page already open leaves
                      // the URL unchanged, so the router has nothing to
                      // react to — the page just silently stays exactly as
                      // it was, including
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
