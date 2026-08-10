"use client";

import { useState } from "react";
import { useData } from "@/lib/DataProvider";
import { useCustomers } from "@/lib/CustomersProvider";
import { useModal } from "@/components/Modal";
import { StatusChip } from "@/components/StatusChip";
import { Icon } from "@/lib/icons";
import { RegisterCustomerModalContent } from "@/components/modals/RegisterCustomerModal";

/* Ported from legacy/app.js's `renderCustomers()`. Loads real data from the
 * Go backend (`GET /api/v1/customers`) instead of the localStorage mock
 * store — see the Customer Module stage-1 plan. Loan counts still come
 * from the mock `db.loans` (the Loan module itself is out of scope here). */
export function Customers() {
  const { db } = useData();
  const { customers, loading, error, refresh } = useCustomers();
  const { openModal } = useModal();
  const [q, setQ] = useState("");

  const rows = customers.filter(
    (c) => !q || (c.name + c.phone + c.code).toLowerCase().includes(q.toLowerCase())
  );

  return (
    <>
      <div className="page-h">
        <div><h1>Customers &amp; KYC</h1><p>{customers.length} customers · PAN &amp; Aadhaar verification status</p></div>
        <div className="sp" />
        <div className="search"><Icon name="search" /><input className="inp" placeholder="Search name, phone, ID…" value={q} onChange={(e) => setQ(e.target.value)} /></div>
        <button className="btn" onClick={() => openModal(<RegisterCustomerModalContent onSaved={refresh} />)}>
          <Icon name="plus" /> Register Customer
        </button>
      </div>
      <hr className="gold-rule" />
      {error && (
        <p style={{ color: "var(--red)", fontSize: 13.5 }}>
          Could not reach the server — {error}
          <button className="btn plain sm" style={{ marginLeft: 8 }} onClick={refresh}>Retry</button>
        </p>
      )}
      <div className="card"><div className="tbl-wrap"><table className="tbl">
        <thead><tr><th>Customer</th><th>Contact</th><th>Branch</th><th>PAN</th><th>Aadhaar</th><th>KYC Status</th><th className="num">Loans</th><th></th></tr></thead>
        <tbody>
          {loading ? (
            <tr><td colSpan={8} className="empty">Loading customers…</td></tr>
          ) : rows.length === 0 ? (
            <tr><td colSpan={8} className="empty">{error ? "—" : "No customers match your search."}</td></tr>
          ) : rows.map((c) => (
            <tr className="click" key={c.id} onClick={() => { location.hash = "customer/" + c.id; }}>
              <td><span className="id">{c.code}</span><span className="sub" style={{ fontSize: 13.5, color: "var(--charcoal)", fontWeight: 500 }}>{c.name}</span></td>
              <td>{c.phone}<span className="sub">{c.address}</span></td>
              <td>{c.branchName}</td>
              <td><StatusChip status={c.panStatus} /></td>
              <td><StatusChip status={c.aadhaarStatus} /></td>
              <td><StatusChip status={c.kycStatus} /></td>
              <td className="num">{db.loans.filter((l) => l.cust === c.id).length}</td>
              <td style={{ textAlign: "right", color: "var(--gold-deep)" }}>›</td>
            </tr>
          ))}
        </tbody>
      </table></div></div>
    </>
  );
}
