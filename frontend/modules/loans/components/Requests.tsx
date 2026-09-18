"use client";

import { useCallback, useEffect, useState } from "react";
import { useModal } from "@/common/components/Modal";
import { StatusChip } from "@/common/components/ui/StatusChip";
import { Icon } from "@/common/components/Icon";
import { Select } from "@/common/components/ui/Select";
import { useLoans } from "@/modules/loans/store/LoansProvider";
import { listLoanRequestsPage, getLoanByNumber, type RequestView } from "@/modules/loans/services/loanService";
import { getCustomer } from "@/modules/customers/services/customerService";
import { printReleaseAgreement, type ReleaseAgreementLang } from "@/modules/loans/utils/releaseAgreement";
import { useToast } from "@/common/components/Toast";
import { useAuth } from "@/common/auth-context";
import { useResponsivePageSize } from "@/common/utils/responsive";
const STATUS_OPTIONS = [
  { value: "", label: "All" },
  { value: "Pending", label: "Pending" },
  { value: "Approved", label: "Approved" },
  { value: "Rejected", label: "Rejected" },
];
import { ReleaseReviewModalContent } from "@/common/components/modals/ReleaseReviewModal";
import { ExtensionReviewModalContent } from "@/common/components/modals/ExtensionReviewModal";
import { routeHref } from "@/common/services/appRoutes";

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
  const toast = useToast();

  const pageSize = useResponsivePageSize(10, 7);
  const [reqs, setReqs] = useState<RequestView[]>([]);
  const [loading, setLoading] = useState(true);
  const [page, setPage] = useState(1);
  const [total, setTotal] = useState(0);
  const [status, setStatus] = useState("");
  const [downloadingId, setDownloadingId] = useState<number | null>(null);
  const [downloadMenuId, setDownloadMenuId] = useState<number | null>(null);

  // Lets an Approved release row's document be re-downloaded right from
  // this list, without navigating to Loan Detail first — same generator
  // LoanDetail.tsx's own Documents menu uses.
  async function downloadReleaseAgreement(r: RequestView, lang: ReleaseAgreementLang) {
    setDownloadMenuId(null);
    setDownloadingId(r.id);
    try {
      const loan = await getLoanByNumber(r.loanNumber);
      const customer = await getCustomer(loan.customerId);
      printReleaseAgreement(
        {
          loanNumber: loan.id,
          branchName: loan.branchName,
          customerName: customer.name,
          customerAddress: customer.address,
          borrowedDate: loan.opened,
          borrowedAmount: loan.principal,
          returnedAmount: loan.totalPaid,
          totalInterest: loan.interestPaid + loan.penalInterestPaid,
          ornaments: loan.ornaments.map((o) => ({
            name: o.name,
            purity: o.purity,
            quantity: o.quantity,
            grossWeight: o.grossWeight,
            netWeight: o.netWeight,
            value: o.goldValue,
          })),
        },
        toast,
        lang
      );
    } catch {
      toast("Could not load loan/customer details — try again");
    } finally {
      setDownloadingId(null);
    }
  }
  const totalPages = Math.max(1, Math.ceil(total / pageSize));

  // Re-fetches whatever page is currently on screen — used both by the
  // page-change effect below and after a decision/review-save, so an admin
  // working through page 3 isn't bounced back to page 1 every time.
  const refresh = useCallback(() => {
    listLoanRequestsPage(page, { status: status || undefined }, pageSize)
      .then((res) => { setReqs(res.items); setTotal(res.total); })
      .catch(() => { setReqs([]); setTotal(0); })
      .finally(() => setLoading(false));
  }, [page, status, pageSize]);

  useEffect(() => { refresh(); }, [refresh]);

  function refreshAfterSave() {
    refresh();
    refreshLoans();
  }

  return (
    <>
      <div className="page-h">
        <div><h1>Loan Extensions &amp; Gold Release</h1><p>Extension/release requests submitted by customers (or logged by staff on their behalf) — review and approve/reject through each request's staged approval chain</p></div>
      </div>
      <hr className="gold-rule" style={{ margin: "4px 0 10px" }} />
      <div style={{ display: "flex", alignItems: "flex-end", justifyContent: "flex-end", gap: 12, flexWrap: "wrap", marginTop: 0, marginBottom: 10 }}>
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
      <div className="card tbl-card">
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
                  <td><span className={`chip ${r.type === "Extension" ? "info" : "brand"}`}>{r.type}</span></td>
                  <td><a href={routeHref(`loan/${r.loanNumber}`)}>{r.loanNumber}</a></td>
                  <td>{r.customerName}</td>
                  <td>{r.detail}</td>
                  <td>{r.requestedAt}</td>
                  <td>
                    <StatusChip status={r.status} />
                    {/* Set by RecordReleasePayment when a Manager-stage discount+payment
                        fell short of the final settlement — see ReleaseReviewModal.tsx. */}
                    {r.paymentDueDate && r.status === "Pending" && !r.paymentVerified && new Date(r.paymentDueDate) < new Date() && (
                      <span className="chip" style={{ marginLeft: 6, color: "var(--red)", borderColor: "var(--red)" }}>Payment Overdue</span>
                    )}
                  </td>
                  <td style={{ whiteSpace: "nowrap" }}>
                    {/* Fixed flex layout, not text-align:center on the cell —
                        centering inline content shifts the View/Review
                        button's own x-position depending on whether the
                        Download button beside it exists on that row. A
                        reserved, always-same-size slot (invisible when not
                        applicable) keeps every row's View button lined up
                        in the same column. */}
                    <div style={{ display: "flex", justifyContent: "center", alignItems: "center", gap: 6 }}>
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
                      <div
                        className="docs-dd"
                        style={{ visibility: r.type === "Release" && r.status === "Approved" ? "visible" : "hidden" }}
                      >
                        <button
                          type="button"
                          className="btn ghost sm"
                          style={{ padding: "6px 10px", display: "inline-flex", alignItems: "center" }}
                          title={downloadingId === r.id ? "Preparing…" : "Download Release Agreement"}
                          disabled={downloadingId === r.id}
                          onClick={() => setDownloadMenuId((cur) => (cur === r.id ? null : r.id))}
                          tabIndex={r.type === "Release" && r.status === "Approved" ? 0 : -1}
                        >
                          <Icon name="download" />
                        </button>
                        {downloadMenuId === r.id && (
                          <div className="docs-dd-menu" style={{ minWidth: 170, right: 0 }}>
                            <a href="#" onClick={(e) => { e.preventDefault(); downloadReleaseAgreement(r, "en"); }}>
                              <Icon name="doc" /><span className="tx">English</span>
                            </a>
                            <a href="#" onClick={(e) => { e.preventDefault(); downloadReleaseAgreement(r, "ml"); }}>
                              <Icon name="doc" /><span className="tx">Malayalam</span>
                            </a>
                          </div>
                        )}
                      </div>
                    </div>
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
