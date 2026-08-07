"use client";

import { useData } from "@/lib/DataProvider";
import { useModal } from "@/components/Modal";
import { Icon } from "@/lib/icons";
import { fmt, initials } from "@/lib/format";
import { EmployeeModalContent } from "@/components/modals/EmployeeModal";

/* Ported from legacy/app.js's `renderEmployees()`. */
export function Employees() {
  const { db } = useData();
  const { openModal } = useModal();

  return (
    <>
      <div className="page-h">
        <div><h1>Employees &amp; Roles</h1><p>Role-based access · performance across loans, collections and follow-ups</p></div>
        <div className="sp" />
        <button className="btn" onClick={() => openModal(<EmployeeModalContent />)}><Icon name="plus" /> Add Employee</button>
      </div>
      <hr className="gold-rule" />
      <div className="card">
        <div className="tbl-wrap">
          <table className="tbl">
            <thead>
              <tr><th>Employee</th><th>Role</th><th>Branch</th><th className="num">Loans Processed</th><th className="num">Collections</th><th className="num">Follow-ups</th><th className="num">Pending</th></tr>
            </thead>
            <tbody>
              {db.employees.map((e) => (
                <tr key={e.id}>
                  <td>
                    <span style={{ display: "inline-flex", alignItems: "center", gap: 10 }}>
                      <span className="av" style={{ width: 30, height: 30, borderRadius: "50%", background: "linear-gradient(135deg,var(--gold-light),var(--gold-deep))", color: "#2b2001", display: "grid", placeContent: "center", fontWeight: 600, fontSize: 11.5 }}>{initials(e.name)}</span>
                      <span><b>{e.name}</b><span className="sub">{e.id}</span></span>
                    </span>
                  </td>
                  <td><span className={`chip ${e.role === "Administrator" ? "gold" : e.role === "Branch Manager" ? "blue" : "gray"}`}>{e.role}</span></td>
                  <td>{e.branch}</td>
                  <td className="num">{e.loans || "—"}</td>
                  <td className="num">{fmt(e.collections)}</td>
                  <td className="num">{e.followups}</td>
                  <td className="num">{e.pending}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <div className="ft">Roles: Administrator · Management · Branch Manager · Loan Operator · Cashier · Accountant · Collection Staff · Auction Admin · Auditor. Sensitive actions (rate changes, waivers, reversals, closures) sit behind approval workflows with a full audit trail.</div>
      </div>
    </>
  );
}
