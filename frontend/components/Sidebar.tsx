"use client";

import { Icon } from "@/lib/icons";

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
];

export function Sidebar({ route, open }: { route: string; open: boolean }) {
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
            {items.map(([r, t, ic]) => {
              const isOn =
                route === r ||
                (route === "loan" && r === "loans") ||
                (route === "customer" && r === "customers");
              return (
                <a key={r} href={`#${r}`} className={isOn ? "on" : ""}>
                  <Icon name={ic} />
                  {t}
                  {r === "requests" && <span className="pill">3</span>}
                  {r === "auctions" && <span className="pill">1</span>}
                </a>
              );
            })}
          </div>
        ))}
      </nav>
      <div className="sfoot">
        Trust · Value · Growth
        <br />
        <a href="/">← Sign out</a>
      </div>
    </aside>
  );
}
