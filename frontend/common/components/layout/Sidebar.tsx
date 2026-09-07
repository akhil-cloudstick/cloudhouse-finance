"use client";

import { useRouter } from "next/navigation";
import { Icon } from "@/common/components/Icon";
import { useAuth } from "@/common/auth-context";
import { loginPath } from "@/common/services/tenantSession";

/* Ported from legacy/app.js's `NAV` array + nav-building/active-link logic
 * in `router()`. Each item now also carries the permission that gates it
 * (module, key — the same underscored keys the backend derives, see
 * common/services/permissionService.ts) so filtering is driven by the
 * actual permissions table instead of hardcoded role-name checks (see the
 * house role-permission standard's §12). `module: null` means always
 * visible — no permission governs it (Dashboard). */
type NavItem = { route: string; title: string; icon: string; module: string | null; key?: string };

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
    { route: "personalloans", title: "Personal Loans", icon: "note", module: "Personal_Loan_Management", key: "can_view_personal_loan" },
    { route: "investments", title: "Investments", icon: "coin", module: "Investment_Management", key: "can_view_investment" },
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
    { route: "branches", title: "Branch Management", icon: "bank", module: "Branch_Management", key: "can_view_branch" },
    { route: "roles-permissions", title: "Roles & Permissions", icon: "shield", module: "Role_Management", key: "can_view_role_and_permission" },
    { route: "billing", title: "Billing", icon: "coin", module: "Billing", key: "can_manage_billing" },
    { route: "settings", title: "Settings", icon: "gear", module: "Settings_Management", key: "can_view_setting" },
  ]],
];

export function Sidebar({ route, open }: { route: string; open: boolean }) {
  const { logout, can } = useAuth();
  const router = useRouter();

  function handleSignOut(e: React.MouseEvent) {
    e.preventDefault();
    // Resolve the link before logout: it clears the remembered business, and
    // a signed-out user should land back on their own organisation.s sign-in
    // page rather than a bare form asking for a business code.
    const back = loginPath();
    logout();
    router.replace(back);
  }

  return (
    <aside className={`side${open ? " open" : ""}`} id="side">
      <div className="brand">
        <img src="/ambika-gold.jpeg" alt="Ambika Gold Finance" />
        <div className="t">
          <b>AMBIKA</b>
          <span>Gold Finance</span>
        </div>
      </div>
      <nav className="nav" id="navBox">
        {NAV.map(([group, items]) => {
          // A permission-gated item is filtered OUT of the array (never
          // rendered disabled) — §12.3. An empty group renders no heading
          // at all, so a role with nothing in "Gold Custody" doesn't see a
          // bare, empty section (§12.4).
          const visible = items.filter((item) => item.module === null || can(item.module, item.key!));
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
                return (
                  <a key={r} href={`#${r}`} className={isOn ? "on" : ""}>
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
        <a href={loginPath()} onClick={handleSignOut}>← Sign out</a>
      </div>
    </aside>
  );
}
