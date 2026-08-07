"use client";

import { useToast } from "@/components/Toast";
import { Icon } from "@/lib/icons";

const REPORTS: [string, string, string][] = [
  ["Daily Loan Disbursement", "Loans opened per day with amounts", "chart"],
  ["Active / Closed / Overdue Loans", "Portfolio status breakdown", "list"],
  ["Interest & Penal Collection", "Collections by month and branch", "coin"],
  ["Outstanding Principal", "Exposure by scheme & branch", "chart"],
  ["Gold / Ornament & Weight", "Total pledged weight by purity", "scale"],
  ["Packet Tracking & Locker", "Movement & storage audit", "scan"],
  ["Bank Pledge & Liability", "External pledge exposure", "bank"],
  ["Gold Release / Closure", "Settlements and releases", "unlock"],
  ["Auction Reports", "Cases, notices, recovery", "gavel"],
  ["Expense & Cash Flow", "Cash movement and expense heads", "coin"],
  ["KYC Verification", "PAN/Aadhaar verification log", "shield"],
  ["Gold Rate History", "Published daily rates", "coin"],
  ["Employee Performance", "Loans, collections & follow-ups per employee", "user"],
  ["Communication History", "SMS / WhatsApp sent per loan", "chat"],
];

/* Ported from legacy/app.js's `renderReports()`. Purely static — no real
 * data, no per-tile modal — each tile just toasts a "full build" stub,
 * matching legacy exactly. */
export function Reports() {
  const toast = useToast();

  return (
    <>
      <div className="page-h">
        <div><h1>Reports</h1><p>Filterable reports, exportable to PDF / Excel</p></div>
      </div>
      <hr className="gold-rule" />
      <div className="grid" style={{ gridTemplateColumns: "repeat(auto-fill,minmax(250px,1fr))" }}>
        {REPORTS.map(([t, s, ic]) => (
          <div className="card" style={{ cursor: "pointer" }} key={t} onClick={() => toast(`${t} report — generated in full build (PDF/Excel)`)}>
            <div className="bd" style={{ display: "flex", gap: 13, alignItems: "center" }}>
              <span className="ic" style={{ width: 40, height: 40, borderRadius: 9, background: "#f8eecb", color: "var(--gold-deep)", display: "grid", placeContent: "center" }}><Icon name={ic} /></span>
              <div>
                <b style={{ fontSize: 14.5, color: "var(--charcoal)" }}>{t}</b>
                <div style={{ fontSize: 12, color: "var(--muted)", marginTop: 2 }}>{s}</div>
              </div>
            </div>
          </div>
        ))}
      </div>
    </>
  );
}
