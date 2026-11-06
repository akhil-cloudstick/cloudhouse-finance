"use client";

import { TableCols } from "@/common/components/ui/TableCols";
import { TableSearch } from "@/common/components/ui/TableSearch";
import { ScrollSentinel } from "@/common/components/ui/ScrollSentinel";
import { useCallback, useEffect, useRef, useState } from "react";
import { useModal } from "@/common/components/ModalProvider";
import { StatusChip } from "@/common/components/ui/StatusChip";
import { Icon } from "@/common/components/Icon";
import { FilterPanel, type FilterCategory, type FilterValue } from "@/common/components/ui/FilterPanel";
import { usePersistedState, usePersistedPage } from "@/common/hooks/use-persisted-state";
import { useLoans } from "@/modules/loans/store/LoansProvider";
import { listLoanRequestsPage, getLoanByNumber, downloadReleaseAgreementPDF, downloadPartialReleaseReceiptPDF } from "@/modules/loans/services/loanService";
import { type RequestView } from "@/modules/loans/types/loan-types";
import { useToast } from "@/common/components/ToastProvider";
import { useAuth } from "@/common/providers/AuthProvider";
import { useResponsivePageSize, useScrollPageSize } from "@/common/utils/responsive";
const STATUS_OPTIONS = [
  { value: "Pending", label: "Pending" },
  { value: "Approved", label: "Approved" },
  { value: "Rejected", label: "Rejected" },
];
const TYPE_OPTIONS = [
  { value: "extension", label: "Extension" },
  { value: "release", label: "Release" },
];
import { ReleaseReviewModalContent } from "@/modules/loans/components/ReleaseReviewModalContent";
import { ExtensionReviewModalContent } from "@/modules/loans/components/ExtensionReviewModalContent";
import { routeHref } from "@/common/services/appRoutes";
import { EsignLanguageModalContent } from "@/modules/loans/components/EsignLanguageModalContent";
import { RELEASE_LANG_OPTIONS } from "@/modules/loans/utils/indemnityBond";
import { fmtDate } from "@/common/utils/format";
import { singleFlight } from "@/common/utils/singleFlight";

/* Real "Extensions & Release" review page — staff approve/reject the
 * extension/release requests logged by the customer-mobile app (or by staff
 * on a customer's behalf via LoanDetail.tsx). Both types now go through
 * their own staged approval chain (Extension: Loan Officer -> Branch
 * Manager -> Management; Release: Manager -> Management), reviewed via the
 * Review/View modal below — see ExtensionReviewModal.tsx / ReleaseReviewModal.tsx
 * and backend/internal/loan/service.go's ApproveExtensionRequest /
 * ApproveReleaseRequest. Approving the final stage pushes the loan's due
 * date out (Extension) or moves it to "Closure Requested" (Release).
 * Which stages each chain has is per-business configuration (Roles &
 * Permissions → Approval Workflow). */
// The dashboard tiles open this page with a reserved route argument instead of a loan number.
const PENDING_PRESETS: Record<string, string> = { "pending-extension": "extension", "pending-release": "release" };

export function RequestsPage({ focusLoanNumber: routeArg }: { focusLoanNumber?: string } = {}) {
  const presetType = routeArg ? PENDING_PRESETS[routeArg] : undefined;
  const focusLoanNumber = presetType ? undefined : routeArg;
  const { openModal } = useModal();
  const { refresh: refreshLoans } = useLoans();
  // Without "can update loan" the review modal opens read-only (its
  // checklist and approve/reject controls hide themselves), so the row
  // button says View rather than Review.
  const { can } = useAuth();
  const canDecide = can("Loan_Management", "can_update_loan");
  const toast = useToast();

  const basePageSize = useResponsivePageSize(15, 15);
  const { cards, size: pageSize, more } = useScrollPageSize(basePageSize);
  const [reqs, setReqs] = useState<RequestView[]>([]);
  const [loading, setLoading] = useState(true);
  const [page, setPage] = usePersistedPage("requests");
  const [total, setTotal] = useState(0);
  const [status, setStatus] = usePersistedState("requests:status", "");
  const [type, setType] = usePersistedState("requests:type", "");
  const [fromDate, setFromDate] = usePersistedState("requests:from", "");
  const [toDate, setToDate] = usePersistedState("requests:to", "");
  // `qInput` is what's typed; `q` is the debounced value that drives the
  // server query, so each keystroke doesn't fire a request.
  const [qInput, setQInput] = useState(focusLoanNumber || "");
  const [q, setQ] = useState(focusLoanNumber || "");
  const [downloadingId, setDownloadingId] = useState<number | null>(null);

  // Lets an Approved release row's document be re-downloaded right from
  // this list, without navigating to Loan Detail first — same generator
  // LoanDetail.tsx's own Documents menu uses.
  async function downloadReleaseAgreement(r: RequestView, lang: "en" | "ml") { return singleFlight("loans:release-agreement:"+r.id+":"+lang, async () => {
    setDownloadingId(r.id);
    try {
      const loan = await getLoanByNumber(r.loanNumber);
      await downloadReleaseAgreementPDF(loan.numericId, lang);
    } catch {
      toast("Could not generate the release agreement — try again");
    } finally {
      setDownloadingId(null);
    }
  }); }

  // Partial Ornament Release counterpart — keyed off the REQUEST rather
  // than the loan (the receipt lists only what THIS request released), same
  // Approved-only gate as the full-release FORM 7 agreement above.
  async function downloadPartialReceipt(r: RequestView, lang: "en" | "ml") { return singleFlight("loans:partial-receipt:"+r.id+":"+lang, async () => {
    setDownloadingId(r.id);
    try {
      await downloadPartialReleaseReceiptPDF(r.id, lang);
    } catch {
      toast("Could not generate the partial release receipt — try again");
    } finally {
      setDownloadingId(null);
    }
  }); }
  const totalPages = Math.max(1, Math.ceil(total / pageSize));

  // Re-fetches whatever page is currently on screen — used both by the
  // page-change effect below and after a decision/review-save, so an admin
  // working through page 3 isn't bounced back to page 1 every time.
  const refresh = useCallback(() => {
    listLoanRequestsPage(page, { status: status || undefined, type: type || undefined, q: q || undefined, from: fromDate || undefined, to: toDate || undefined }, pageSize)
      .then((res) => { setReqs(res.items); setTotal(res.total); })
      .catch(() => { setReqs([]); setTotal(0); })
      .finally(() => setLoading(false));
  }, [page, status, type, q, fromDate, toDate, pageSize]);

  useEffect(() => { refresh(); }, [refresh]);

  // Arrived from the dashboard's Needs Attention list (/requests/<loanNumber>):
  // narrow to that loan's pending requests (a remembered Approved/Rejected or
  // type filter would hide them), and open the review straight away when
  // there is exactly one.
  const focusHandled = useRef(false);
  // Arrived from a dashboard Extension / Gold Release tile: that type's Pending list.
  useEffect(() => {
    if (!presetType) return;
    setStatus("Pending");
    setType(presetType);
    setPage(1);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [presetType]);
  useEffect(() => {
    if (!focusLoanNumber) return;
    setStatus("Pending");
    setType("");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [focusLoanNumber]);
  useEffect(() => {
    if (!focusLoanNumber || focusHandled.current || loading || status !== "Pending" || q !== focusLoanNumber) return;
    const mine = reqs.filter((r) => r.loanNumber === focusLoanNumber && r.status === "Pending");
    focusHandled.current = true;
    if (mine.length !== 1) return;
    const r = mine[0];
    openModal(
      r.type === "Extension"
        ? <ExtensionReviewModalContent request={r} onSaved={refreshAfterSave} />
        : <ReleaseReviewModalContent request={r} onSaved={refreshAfterSave} />,
      true
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [reqs, loading, status, q, focusLoanNumber]);

  useEffect(() => {
    const t = qInput.trim();
    if (t === q) return;
    const handle = setTimeout(() => { setQ(t); setPage(1); }, 300);
    return () => clearTimeout(handle);
  }, [qInput, q]);

  // One grouped filter for Type and Status (single choice each).
  const filterCategories: FilterCategory[] = [
    { key: "type", label: "Type", kind: "static", options: TYPE_OPTIONS },
    { key: "status", label: "Status", kind: "static", options: STATUS_OPTIONS },
    { key: "__date", label: "Requested date", kind: "date" as const },
  ];
  const filterValue: FilterValue = { type: type ? type.split(",") : [], status: status ? status.split(",") : [], __dateFrom: fromDate || undefined, __dateTo: toDate || undefined };

  function refreshAfterSave() {
    refresh();
    refreshLoans();
  }

  return (
    <>
      <div className="page-h">
        <div><h1>Loan Extensions &amp; Gold Release</h1><p>Extension/release requests </p></div>
        <div className="sp" />
        <TableSearch placeholder="Search loan no, customer, phone…" searches="loan number, customer name, customer code, phone" value={qInput} onChange={setQInput} />
      </div>
      <hr className="gold-rule" style={{ margin: "4px 0 10px" }} />
      <div className="filter-row-right" style={{ marginBottom: 12 }}>
          <FilterPanel
            categories={filterCategories}
            value={filterValue}
            onChange={(next) => {
              setType(Array.isArray(next.type) ? next.type.join(",") : "");
              setStatus(Array.isArray(next.status) ? next.status.join(",") : "");
              setFromDate(next.__dateFrom || "");
              setToDate(next.__dateTo || "");
              setPage(1);
            }}
            hideChips
            hideClearAll
          />
        </div>
      <div className="card tbl-card tbl-card-fill tbl-rounded">
        <div className="tbl-wrap tbl-scroll">
          <table className="tbl tbl-cards tbl-center">
            <TableCols widths={[10, 10, 20, 28, 10, 10, 12]} />
            <thead>
              <tr><th>Type</th><th>Loan</th><th>Customer</th><th>Detail</th><th>Date</th><th>Status</th><th style={{ textAlign: "center" }}>Actions</th></tr>
            </thead>
            <tbody>
              {loading && !(cards && reqs.length > 0) ? (
                <tr><td colSpan={7} className="empty">Loading requests…</td></tr>
              ) : reqs.length === 0 ? (
                <tr><td colSpan={7} className="empty">No extension or release requests yet.</td></tr>
              ) : reqs.map((r) => (
                <tr key={r.id}>
                  <td data-label="Type">
                    <span className={`chip ${r.type === "Extension" ? "info" : r.type === "Release" ? "brand" : "amber"}`}>{r.type}</span>
                    {/* Only meaningful for Release — flags at a glance which
                        rows hand back every ornament vs. only some, since
                        the review chain and CompleteRelease behave
                        differently for each (see backend/internal/loan/
                        model_request.go's LoanRequest.IsPartial). */}
                    {r.type === "Release" && r.isPartial && (
                      <span className="chip" style={{ marginLeft: 4 }}>Partial</span>
                    )}
                  </td>
                  <td data-label="Loan"><a href={routeHref(`loan/${r.loanNumber}`)}>{r.loanNumber}</a></td>
                  <td data-label="Customer">
                    {r.customerName}
                    {/* a partial release hands back only some ornaments: say so right after the customer */}
                    {r.type === "Release" && r.isPartial && <span style={{ color: "var(--muted)" }}> · Partial release</span>}
                  </td>
                  <td data-label="Detail">{r.detail}</td>
                  <td data-label="Date" style={{ whiteSpace: "nowrap" }}>{fmtDate(r.requestedAt)}</td>
                  <td data-label="Status">
                    <StatusChip status={r.status} />
                    {/* Set by RecordReleaseRequestPayment when a recorded discount+payment
                        fell short of the final settlement — see ReleaseReviewModal.tsx. */}
                    {r.paymentDueDate && r.status === "Pending" && !r.paymentRecorded && new Date(r.paymentDueDate) < new Date() && (
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
                        style={{ minWidth: 74, textAlign: "center", justifyContent: "center" }}
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
                          onClick={() => openModal(
                            <EsignLanguageModalContent
                              loanNumber={r.loanNumber}
                              customerName={r.customerName}
                              title={r.isPartial ? "Partial Release Receipt" : "Release Agreement"}
                              confirmLabel="🖨 Download"
                              options={RELEASE_LANG_OPTIONS}
                              onConfirm={(lang) => (r.isPartial ? downloadPartialReceipt(r, lang === "ml" ? "ml" : "en") : downloadReleaseAgreement(r, lang === "ml" ? "ml" : "en"))}
                            />
                          )}
                          tabIndex={r.type === "Release" && r.status === "Approved" ? 0 : -1}
                        >
                          <Icon name="download" />
                        </button>
                      </div>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <ScrollSentinel enabled={cards && (page < totalPages)} onVisible={more} watch={reqs.length} />
        <div className="ft ft-scroll-hide" style={{ display: "flex", alignItems: "center", gap: 10 }}>
          <button className="btn plain sm" disabled={page <= 1} onClick={() => setPage((p) => Math.max(1, p - 1))}>‹ Prev</button>
          <span style={{ fontSize: 12.5 }}>Page {page} of {totalPages}</span>
        <span style={{ fontSize: 12.5, color: "var(--muted)" }}>· {total.toLocaleString("en-IN")} {total === 1 ? "result" : "results"}</span>
          <button className="btn plain sm" disabled={page >= totalPages} onClick={() => setPage((p) => Math.min(totalPages, p + 1))}>Next ›</button>
        </div>
        {/* <div className="ft">Release settlement = Principal + Interest + Penal + Charges − Payments/Waivers · verified against packet location &amp; bank pledge status</div> */}
      </div>
    </>
  );
}
