"use client";

import { useCallback, useEffect, useState } from "react";
import { useModal } from "@/common/components/Modal";
import { StatusChip } from "@/common/components/ui/StatusChip";
import { Select } from "@/common/components/ui/Select";
import { useLoans } from "@/modules/loans/store/LoansProvider";
import { listLoanRequestsPage, type RequestView } from "@/modules/loans/services/loanService";
import { useAuth } from "@/common/auth-context";

const STATUS_OPTIONS = [
  { value: "", label: "All" },
  { value: "Pending", label: "Pending" },
  { value: "Approved", label: "Approved" },
  { value: "Rejected", label: "Rejected" },
];
import { ReleaseReviewModalContent } from "@/common/components/modals/ReleaseReviewModal";
import { ExtensionReviewModalContent } from "@/common/components/modals/ExtensionReviewModal";

/* Real "Extensions & Release" review page — staff approve/reject the
 * extension/release requests logged by the customer-mobile app (or by staff
 * on a customer's behalf via LoanDetail.tsx). Both types now go through
 * their own staged approval chain (Extension: Loan Officer -> Branch
 * Manager -> Management; Release: Manager -> Management), reviewed via the
 * Review/View modal below — see ExtensionReviewModal.tsx / ReleaseReviewModal.tsx
 * and backend/internal/loan/service.go's ApproveExtensionRequest /
 * ApproveReleaseRequest. Approving the final stage pushes the loan's due
 * date out (Extension) or moves it to "Closure Requested" (Release). */
export function Requests() {
  const { openModal } = useModal();
  const { refresh: refreshLoans } = useLoans();
  // Without "can update loan" the review modal opens read-only (its
  // checklist and approve/reject controls hide themselves), so the row
  // button says View rather than Review.
  const { can } = useAuth();
  const canDecide = can("Loan_Management", "can_update_loan");

  const [reqs, setReqs] = useState<RequestView[]>([]);
  const [loading, setLoading] = useState(true);
  const [page, setPage] = useState(1);
  const [hasMore, setHasMore] = useState(false);
  const [status, setStatus] = useState("");

  // Re-fetches whatever page is currently on screen — used both by the
  // page-change effect below and after a decision/review-save, so an admin
  // working through page 3 isn't bounced back to page 1 every time.
  const refresh = useCallback(() => {
    listLoanRequestsPage(page, { status: status || undefined })
      .then((res) => { setReqs(res.items); setHasMore(res.hasMore); })
      .catch(() => { setReqs([]); setHasMore(false); })
      .finally(() => setLoading(false));
  }, [page, status]);

  useEffect(() => { refresh(); }, [refresh]);

  function refreshAfterSave() {
    refresh();
    refreshLoans();
  }

  const totalPages = hasMore ? page + 1 : page;

  return (
    <>
      <div className="page-h">
        <div><h1>Loan Extensions &amp; Gold Release</h1><p>Extension/release requests submitted by customers (or logged by staff on their behalf) — review and approve/reject through each request's staged approval chain</p></div>
      </div>
      <hr className="gold-rule" />
      <div style={{ display: "flex", alignItems: "flex-end", justifyContent: "flex-end", gap: 12, flexWrap: "wrap", marginBottom: 16 }}>
        <div style={{ width: 180 }}>
          <label style={{ fontSize: 11.5, color: "var(--muted)", display: "block", marginBottom: 4 }}>Status</label>
          {/* setPage here rather than in a status-keyed effect, so the two
              state updates batch into one render and one request. */}
          <Select
            options={STATUS_OPTIONS}
            value={status}
            onChange={(v) => { setStatus(v); setPage(1); }}
          />
        </div>
      </div>
      <div className="card">
        <div className="tbl-wrap tbl-scroll">
          <table className="tbl">
            <thead>
              <tr><th>Request</th><th>Type</th><th>Loan</th><th>Customer</th><th>Detail</th><th>Date</th><th>Status</th><th style={{ textAlign: "center" }}>Actions</th></tr>
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
                  <td style={{ whiteSpace: "nowrap", textAlign: "center" }}>
                    <button
                      className="btn ghost sm"
                      onClick={() => openModal(
                        r.type === "Extension"
                          ? <ExtensionReviewModalContent request={r} onSaved={refreshAfterSave} />
                          : <ReleaseReviewModalContent request={r} onSaved={refreshAfterSave} />,
                        true
                      )}
                    >
                      {r.status === "Pending" && canDecide ? "Review" : "View"}
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <div className="ft" style={{ display: "flex", alignItems: "center", gap: 10 }}>
          <button className="btn plain sm" disabled={page <= 1} onClick={() => setPage((p) => Math.max(1, p - 1))}>‹ Prev</button>
          <span style={{ fontSize: 12.5 }}>Page {page} of {totalPages}</span>
          <button className="btn plain sm" disabled={page >= totalPages} onClick={() => setPage((p) => Math.min(totalPages, p + 1))}>Next ›</button>
        </div>
        {/* <div className="ft">Release settlement = Principal + Interest + Penal + Charges − Payments/Waivers · verified against packet location &amp; bank pledge status</div> */}
      </div>
    </>
  );
}
