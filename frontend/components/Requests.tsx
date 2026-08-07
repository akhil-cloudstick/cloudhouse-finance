"use client";

import { useData } from "@/lib/DataProvider";
import { useToast } from "@/components/Toast";
import { StatusChip } from "@/components/StatusChip";

/* Ported from legacy/app.js's `renderRequests()`. Approve/Reject are demo
 * stubs in legacy too — they only toast, no data mutation, no loan status
 * change. Kept identical here, not a place to add real approval logic. */
export function Requests() {
  const { db } = useData();
  const toast = useToast();

  return (
    <>
      <div className="page-h">
        <div><h1>Loan Extensions &amp; Gold Release</h1><p>Requests submitted by customers through the Android app</p></div>
      </div>
      <hr className="gold-rule" />
      <div className="card">
        <div className="tbl-wrap">
          <table className="tbl">
            <thead>
              <tr><th>Request</th><th>Type</th><th>Loan</th><th>Customer</th><th>Detail</th><th>Date</th><th>Status</th><th></th></tr>
            </thead>
            <tbody>
              {db.requests.map((r) => (
                <tr key={r.id}>
                  <td><span className="id">{r.id}</span></td>
                  <td><span className={`chip ${r.type === "Extension" ? "blue" : "gold"}`}>{r.type}</span></td>
                  <td><a href={`#loan/${r.loan}`}>{r.loan}</a></td>
                  <td>{r.cust}</td>
                  <td>{r.detail}</td>
                  <td>{r.date}</td>
                  <td><StatusChip status={r.status} /></td>
                  <td style={{ whiteSpace: "nowrap", textAlign: "right" }}>
                    {r.status === "Pending" && (
                      <>
                        <button className="btn sm" onClick={() => toast(`${r.type} approved (demo)`)}>Approve</button>{" "}
                        <button className="btn danger sm" onClick={() => toast("Rejected (demo)")}>Reject</button>
                      </>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <div className="ft">Release settlement = Principal + Interest + Penal + Charges − Payments/Waivers · verified against packet location &amp; bank pledge status</div>
      </div>
    </>
  );
}
