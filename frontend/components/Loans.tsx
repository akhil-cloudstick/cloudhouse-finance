"use client";

import { useState } from "react";
import { useData } from "@/lib/DataProvider";
import { custOf } from "@/lib/format";
import { LoanRow } from "@/components/LoanRow";
import { Icon } from "@/lib/icons";

const CATS = ["All", "Active", "Due Soon", "Overdue", "Pending Approval", "Auction Eligible", "Closed"];

/* Ported from legacy/app.js's `renderLoans()`. */
export function Loans() {
  const { db } = useData();
  const [cat, setCat] = useState("All");
  const [q, setQ] = useState("");

  const rows = db.loans.filter(
    (l) =>
      (cat === "All" || l.status === cat) &&
      (!q || (l.id + custOf(db, l.cust).name).toLowerCase().includes(q.toLowerCase()))
  );

  return (
    <>
      <div className="page-h">
        <div><h1>Loans</h1><p>All customer loans with search and status filters</p></div>
        <div className="sp" />
        <div className="search"><Icon name="search" /><input className="inp" placeholder="Search loan ID or customer…" value={q} onChange={(e) => setQ(e.target.value)} /></div>
        <a className="btn" href="#newloan"><Icon name="plus" /> New Gold Loan</a>
      </div>
      <hr className="gold-rule" />
      <div style={{ marginBottom: 14 }} className="tabs">
        {CATS.map((c) => (
          <button key={c} className={c === cat ? "on" : ""} onClick={() => setCat(c)}>{c}</button>
        ))}
      </div>
      <div className="card"><div className="tbl-wrap"><table className="tbl">
        <thead><tr><th>Loan / Customer</th><th>Scheme</th><th>Opened / Due</th><th className="num">Principal</th><th className="num">Outstanding</th><th>Pledge</th><th>Status</th></tr></thead>
        <tbody>
          {rows.length === 0 ? (
            <tr><td colSpan={7} className="empty">No loans in this category.</td></tr>
          ) : rows.map((l) => <LoanRow loan={l} key={l.id} />)}
        </tbody>
      </table></div></div>
    </>
  );
}
