"use client";

import { Icon } from "@/common/components/Icon";
import { useAuth } from "@/common/providers/AuthProvider";
import { useBranding } from "@/common/providers/BrandingProvider";
import BrandLogo from "@/common/components/BrandLogo";
import BrandHeader from "@/common/components/layout/BrandHeader";
import { routeHref } from "@/common/services/appRoutes";
import { routeAllowed } from "@/common/config/routePermissions";
import { resolveLockup } from "@/common/utils/brandLockup";

/* Ported from legacy/app.js's `NAV` array + nav-building/active-link logic
 * in `router()`. Each item is filtered by routeAllowed() against its route's
 * ROUTE_PERMISSIONS entry — the same gate AppShell's View and the navigation
 * guard use — so the menu and the page can never disagree (see the house
 * role-permission standard's §12–§13). */
type NavItem = {
  route: string;
  title: string;
  icon: string;
};

// Each item is gated by its route's entry in common/config/routePermissions.ts (ROUTE_PERMISSIONS).
const NAV: [string, NavItem[]][] = [
  ["Overview", [
    { route: "dashboard", title: "Dashboard", icon: "home" },
    { route: "calendar", title: "Reminder Calendar", icon: "cal" },
    { route: "reports", title: "Reports", icon: "chart" },
  ]],
  ["Lending", [
    { route: "loans", title: "Loans", icon: "list" },
    { route: "newloan", title: "New Gold Loan", icon: "plus" },
    { route: "schemes", title: "Loan Schemes", icon: "doc" },
    { route: "goldrates", title: "Gold Rates", icon: "coin" },
    { route: "requests", title: "Extensions & Release", icon: "unlock" },
    { route: "loanrisk", title: "Loan Risk", icon: "warning" },
    { route: "personalloans", title: "Personal Loans", icon: "note" },
    { route: "investments", title: "Investments", icon: "coin" },
  ]],
  ["Customers", [
    { route: "customers", title: "Customers & KYC", icon: "user" },
  ]],
  ["Gold Custody", [
    { route: "packets", title: "Packets & Lockers", icon: "box" },
    { route: "bankpledge", title: "Bank Re-Pledge", icon: "bank" },
    { route: "auctions", title: "Auctions", icon: "gavel" },
  ]],
  ["Operations", [
    { route: "ledger", title: "Ledger", icon: "coin" },
    { route: "employees", title: "Employees & Roles", icon: "user" },
  ]],
  ["Administration", [
    { route: "branches", title: "Branch Management", icon: "bank" },
    { route: "banks", title: "Bank Management", icon: "bank" },
    { route: "roles-permissions", title: "Roles & Permissions", icon: "shield" },
    { route: "billing", title: "Billing", icon: "coin" },
    { route: "settings", title: "Settings", icon: "gear" },
  ]],
];

type SidebarProps = { route: string; open: boolean; onNavigateSameRoute?: () => void };

export function Sidebar({ route, open, onNavigateSameRoute }: SidebarProps) {
  const { can } = useAuth();
  const {
    hasModule,
    name: businessName,
    legalName,
    shortName,
    shortNameSet,
    lockupTagline,
    headerLayout,
    logoUrl,
    logoDisplay,
    singleBranch,
  } = useBranding();

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
      {/* A business whose header the vendor arranged (superadmin console,
        * Branding step) gets exactly that; every other business keeps the
        * classic lockup below, unchanged. The arranged title is the short name
        * only when one was actually set — no fallback to the business name,
        * since a logo-led header usually already carries it. */}
      {headerLayout ? (
        <BrandHeader
          layout={headerLayout}
          logoUrl={logoUrl}
          logoDisplay={logoDisplay}
          title={shortNameSet ? shortName : ""}
          subtitle={lockupTagline}
          logoAlt={legalName || businessName}
          className="side-bh"
        />
      ) : (
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
      )}
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
          const visible = items.filter((item) => routeAllowed(item.route, can, hasModule, singleBranch));
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
