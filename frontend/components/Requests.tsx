"use client";

import { useCallback, useEffect, useState } from "react";
import { useModal } from "@/components/Modal";
import { useToast } from "@/components/Toast";
import { StatusChip } from "@/components/StatusChip";
import { useLoans } from "@/lib/LoansProvider";
import { listLoanRequests, decideRequest, type RequestView } from "@/lib/loansApi";
import { ApiError } from "@/lib/api";
import { ReleaseReviewModalContent } from "@/components/modals/ReleaseReviewModal";

/* Real "Extensions & Release" review page — staff approve/reject the
 * extension/release requests logged from LoanDetail.tsx / CustomerDetail.tsx
 * (or, later, submitted by the Android app). Approving an Extension pushes
 * the loan's due date out; approving a Release moves the loan to
 * "Closure Requested" — both happen server-side in
 * backend/internal/loan/service.go's DecideRequest. */
export function Requests() {
  const toast = useToast();
  const { openModal } = useModal();
  const { refresh: refreshLoans } = useLoans();

  const [reqs, setReqs] = useState<RequestView[]>([]);
  const [loading, setLoading] = useState(true);
  const [deciding, setDeciding] = useState<number | null>(null);

  const refresh = useCallback(() => {
    listLoanRequests()
      .then(setReqs)
      .catch(() => setReqs([]))
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => { refresh(); }, [refresh]);

  async function decide(id: number, action: "Approved" | "Rejected") {
    let remarks = "";
    if (action === "Rejected") {
      remarks = window.prompt("Reason for rejecting (optional):") || "";
    }
    setDeciding(id);
    try {
      // The deciding employee is derived server-side from the logged-in
      // user's JWT — no employeeId sent from here.
      await decideRequest(id, action, remarks);
      refresh();
      refreshLoans();
      toast(action === "Approved" ? "Request approved" : "Request rejected");
    } catch (e) {
      toast(e instanceof ApiError ? e.message : "Could not record the decision — try again.");
    } finally {
      setDeciding(null);
    }
  }

  return (
    <>
      <div className="page-h">
        <div><h1>Loan Extensions &amp; Gold Release</h1><p>Extension/release requests logged by staff on a customer's behalf — the Android app will submit these directly in a future build</p></div>
      </div>
      <hr className="gold-rule" />
      <div className="card">
        <div className="tbl-wrap">
          <table className="tbl">
            <thead>
              <tr><th>Request</th><th>Type</th><th>Loan</th><th>Customer</th><th>Detail</th><th>Date</th><th>Status</th><th></th></tr>
            </thead>
            <tbody>
              {loading ? (
                <tr><td colSpan={8} className="empty">Loading requests…</td></tr>
              ) : reqs.length === 0 ? (
                <tr><td colSpan={8} className="empty">No extension or release requests yet.</td></tr>
              ) : reqs.map((r) => (
                <tr key={r.id}>
                  <td><span className="id">#{r.id}</span></td>
                  <td><span className={`chip ${r.type === "Extension" ? "blue" : "gold"}`}>{r.type}</span></td>
                  <td><a href={`#loan/${r.loanNumber}`}>{r.loanNumber}</a></td>
                  <td>{r.customerName}</td>
                  <td>{r.detail}</td>
                  <td>{r.requestedAt}</td>
                  <td><StatusChip status={r.status} /></td>
                  <td style={{ whiteSpace: "nowrap", textAlign: "right" }}>
                    {r.type === "Extension" ? (
                      r.status === "Pending" && (
                        <>
                          <button className="btn sm" disabled={deciding === r.id} onClick={() => decide(r.id, "Approved")}>Approve</button>{" "}
                          <button className="btn danger sm" disabled={deciding === r.id} onClick={() => decide(r.id, "Rejected")}>Reject</button>
                        </>
                      )
                    ) : (
                      <button className="btn ghost sm" onClick={() => openModal(<ReleaseReviewModalContent request={r} onSaved={refresh} />, true)}>
                        {r.status === "Pending" ? "Review" : "View"}
                      </button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {/* <div className="ft">Release settlement = Principal + Interest + Penal + Charges − Payments/Waivers · verified against packet location &amp; bank pledge status</div> */}
      </div>
    </>
  );
}
