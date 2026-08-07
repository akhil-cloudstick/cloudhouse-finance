"use client";

import { useState } from "react";
import { useData } from "@/lib/DataProvider";
import { useModal } from "@/components/Modal";
import { kycMarkColor, kycMarkLabel } from "@/lib/format";
import { StatusChip } from "@/components/StatusChip";
import { Icon } from "@/lib/icons";
import { RegisterCustomerModalContent } from "@/components/modals/RegisterCustomerModal";

/* Ported from legacy/app.js's `renderCustomers()`. */
export function Customers() {
  const { db } = useData();
  const { openModal } = useModal();
  const [q, setQ] = useState("");

  const rows = db.customers.filter(
    (c) => !q || (c.name + c.phone + c.id).toLowerCase().includes(q.toLowerCase())
  );

  return (
    <>
      <div className="page-h">
        <div><h1>Customers &amp; KYC</h1><p>{db.customers.length} customers · PAN &amp; Aadhaar verification status</p></div>
        <div className="sp" />
        <div className="search"><Icon name="search" /><input className="inp" placeholder="Search name, phone, ID…" value={q} onChange={(e) => setQ(e.target.value)} /></div>
        <button className="btn" onClick={() => openModal(<RegisterCustomerModalContent />)}>
          <Icon name="plus" /> Register Customer
        </button>
      </div>
      <hr className="gold-rule" />
      <div className="card"><div className="tbl-wrap"><table className="tbl">
        <thead><tr><th>Customer</th><th>Contact</th><th>Branch</th><th>PAN</th><th>Aadhaar / KYC</th><th>KYC Status</th><th className="num">Loans</th><th></th></tr></thead>
        <tbody>
          {rows.length === 0 ? (
            <tr><td colSpan={8} className="empty">No customers match your search.</td></tr>
          ) : rows.map((c) => (
            <tr className="click" key={c.id} onClick={() => { location.hash = "customer/" + c.id; }}>
              <td><span className="id">{c.id}</span><span className="sub" style={{ fontSize: 13.5, color: "var(--charcoal)", fontWeight: 500 }}>{c.name}</span></td>
              <td>{c.phone}<span className="sub">{c.addr}</span></td>
              <td>{c.branch}</td>
              <td><span className={`chip ${kycMarkColor(c.pan)}`}>{kycMarkLabel(c.pan)}</span></td>
              <td><span className={`chip ${kycMarkColor(c.aadhaar)}`}>{kycMarkLabel(c.aadhaar)}</span></td>
              <td><StatusChip status={c.kyc} /></td>
              <td className="num">{c.loans.length}</td>
              <td style={{ textAlign: "right", color: "var(--gold-deep)" }}>›</td>
            </tr>
          ))}
        </tbody>
      </table></div></div>
    </>
  );
}
