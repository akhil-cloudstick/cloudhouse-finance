"use client";

import { useRouter } from "next/navigation";
import { Icon } from "@/lib/icons";
import { useAuth } from "@/lib/auth-context";

/* Ported from legacy/app.js's `NAV` array + nav-building/active-link logic
 * in `router()`. */
export const NAV: [string, [string, string, string][]][] = [
  ["Overview", [
    ["dashboard", "Dashboard", "home"],
    ["calendar", "Reminder Calendar", "cal"],
    ["reports", "Reports", "chart"],
  ]],
  ["Lending", [
    ["loans", "Loans", "list"],
    ["newloan", "New Gold Loan", "plus"],
    ["schemes", "Loan Schemes", "doc"],
    ["goldrates", "Gold Rates", "coin"],
    ["requests", "Extensions & Release", "unlock"],
  ]],
  ["Customers", [
    ["customers", "Customers & KYC", "user"],
  ]],
  ["Gold Custody", [
    ["packets", "Packets & Lockers", "box"],
    ["bankpledge", "Bank Re-Pledge", "bank"],
    ["auctions", "Auctions", "gavel"],
  ]],
  ["Operations", [
    ["cash", "Cash & Expenses", "coin"],
    ["employees", "Employees & Roles", "user"],
  ]],
  ["Administration", [
    ["branches", "Branch Management", "bank"],
    ["settings", "Settings", "gear"],
  ]],
];

export function Sidebar({ route, open }: { route: string; open: boolean }) {
  const { logout, isAdmin, role } = useAuth();
  const router = useRouter();
  // Cashier is outside the loan creation/approval flow — the backend
  // already 403s a Cashier's POST /loans, hide the nav entry entirely
  // rather than let them click into a form that can only ever fail.
  const canCreateLoans = role !== "Cashier";

  function handleSignOut(e: React.MouseEvent) {
    e.preventDefault();
    logout();
    router.replace("/login");
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
        {NAV.map(([group, items]) => (
          <div key={group}>
            <div className="grp">{group}</div>
            {items
              // Branch Management is Administrator-only — the backend
              // already 403s a non-admin's write attempts, hide the nav
              // entry entirely rather than let them click into a page that
              // can only ever fail for them.
              .filter(([r]) => r !== "branches" || isAdmin)
              .filter(([r]) => r !== "newloan" || canCreateLoans)
              .map(([r, t, ic]) => {
              const isOn =
                route === r ||
                (route === "loan" && r === "loans") ||
                (route === "customer" && r === "customers");
              return (
                <a key={r} href={`#${r}`} className={isOn ? "on" : ""}>
                  <Icon name={ic} />
                  {t}
                </a>
              );
            })}
          </div>
        ))}
      </nav>
      <div className="sfoot">
        Trust · Value · Growth
        <br />
        <a href="/login" onClick={handleSignOut}>← Sign out</a>
      </div>
    </aside>
  );
}
