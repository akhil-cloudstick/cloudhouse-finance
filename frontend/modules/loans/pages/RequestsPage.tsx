"use client";

import { ScrollSentinel } from "@/common/components/ui/ScrollSentinel";
import { useCallback, useEffect, useState } from "react";
import { useModal } from "@/common/components/ModalProvider";
import { StatusChip } from "@/common/components/ui/StatusChip";
import { Icon } from "@/common/components/Icon";
import { FilterPanel, type FilterCategory, type FilterValue } from "@/common/components/ui/FilterPanel";
import { usePersistedState } from "@/common/hooks/use-persisted-state";
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
import { fmtDate } from "@/common/utils/format";
import { singleFlight } from "@/common/utils/singleFlight";

export function RequestsPage() {
  const { openModal } = useModal();
  const { refresh: refreshLoans } = useLoans();
  // Without "can update loan" the review modal opens read-only, so the row button says View rather than Review.
  const { can } = useAuth();
  const canDecide = can("Loan_Management", "can_update_loan");
  const toast = useToast();

  const basePageSize = useResponsivePageSize(15, 15);
  const { cards, size: pageSize, more } = useScrollPageSize(basePageSize);
  const [reqs, setReqs] = useState<RequestView[]>([]);
  const [loading, setLoading] = useState(true);
  const [page, setPage] = useState(1);
  const [total, setTotal] = useState(0);
  const [status, setStatus] = usePersistedState("requests:status", "");
  const [type, setType] = usePersistedState("requests:type", "");
  // `qInput` is what's typed; `q` is the debounced value that drives the server query.
  const [qInput, setQInput] = useState("");
  const [q, setQ] = useState("");
  const [downloadingId, setDownloadingId] = useState<number | null>(null);
  const [downloadMenuId, setDownloadMenuId] = useState<number | null>(null);

  async function downloadReleaseAgreement(r: RequestView, lang: "en" | "ml") { return singleFlight("loans:release-agreement:"+r.id+":"+lang, async () => {
    setDownloadMenuId(null);
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

  // Keyed off the REQUEST rather than the loan — the receipt lists only what THIS request released.
  async function downloadPartialReceipt(r: RequestView, lang: "en" | "ml") { return singleFlight("loans:partial-receipt:"+r.id+":"+lang, async () => {
    setDownloadMenuId(null);
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

  // Re-fetches whatever page is on screen so an admin reviewing isn't bounced back to page 1.
  const refresh = useCallback(() => {
    listLoanRequestsPage(page, { status: status || undefined, type: type || undefined, q: q || undefined }, pageSize)
      .then((res) => { setReqs(res.items); setTotal(res.total); })
      .catch(() => { setReqs([]); setTotal(0); })
      .finally(() => setLoading(false));
  }, [page, status, type, q, pageSize]);

  useEffect(() => { refresh(); }, [refresh]);

  useEffect(() => {
    const t = qInput.trim();
    if (t === q) return;
    const handle = setTimeout(() => { setQ(t); setPage(1); }, 300);
    return () => clearTimeout(handle);
  }, [qInput, q]);

  const filterCategories: FilterCategory[] = [
    { key: "type", label: "Type", kind: "static", singleSelect: true, options: TYPE_OPTIONS },
    { key: "status", label: "Status", kind: "static", singleSelect: true, options: STATUS_OPTIONS },
  ];
  const filterValue: FilterValue = { type: type ? [type] : [], status: status ? [status] : [] };

  function refreshAfterSave() {
    refresh();
    refreshLoans();
  }

  return (
    <>
      <div className="page-h">
        <div><h1>Loan Extensions &amp; Gold Release</h1><p>Extension/release requests </p></div>
        <div className="sp" />
        <div className="search"><Icon name="search" /><input className="inp" placeholder="Search loan no, customer, phone…" title="Searches: loan number, customer name, customer code, phone" value={qInput} onChange={(e) => setQInput(e.target.value)} /></div>
      </div>
      <hr className="gold-rule" style={{ margin: "4px 0 10px" }} />
      <div style={{ display: "flex", justifyContent: "flex-end", marginBottom: 12 }}>
          <FilterPanel
            categories={filterCategories}
            value={filterValue}
            onChange={(next) => {
              setType(Array.isArray(next.type) ? next.type[0] || "" : "");
              setStatus(Array.isArray(next.status) ? next.status[0] || "" : "");
              setPage(1);
            }}
            hideChips
            hideClearAll
          />
        </div>
      <div className="card tbl-card tbl-card-fill tbl-rounded">
        <div className="tbl-wrap tbl-scroll">
          <table className="tbl tbl-cards">
            <thead>
              <tr><th>Request</th><th>Type</th><th>Loan</th><th>Customer</th><th>Detail</th><th>Date</th><th>Status</th><th style={{ textAlign: "center" }}>Actions</th></tr>
            </thead>
            <tbody>
              {loading && !(cards && reqs.length > 0) ? (
                <tr><td colSpan={8} className="empty">Loading requests…</td></tr>
              ) : reqs.length === 0 ? (
                <tr><td colSpan={8} className="empty">No extension or release requests yet.</td></tr>
              ) : reqs.map((r) => (
                <tr key={r.id}>
                  <td data-label="Request"><span className="id">#{r.id}</span></td>
                  <td data-label="Type">
                    <span className={`chip ${r.type === "Extension" ? "info" : r.type === "Release" ? "brand" : "amber"}`}>{r.type}</span>
                    {r.type === "Release" && r.isPartial && (
                      <span className="chip" style={{ marginLeft: 4 }}>Partial</span>
                    )}
                  </td>
                  <td data-label="Loan"><a href={routeHref(`loan/${r.loanNumber}`)}>{r.loanNumber}</a></td>
                  <td data-label="Customer">{r.customerName}</td>
                  <td data-label="Detail">{r.detail}</td>
                  <td data-label="Date">{fmtDate(r.requestedAt)}</td>
                  <td data-label="Status">
                    <StatusChip status={r.status} />
                    {r.paymentDueDate && r.status === "Pending" && !r.paymentRecorded && new Date(r.paymentDueDate) < new Date() && (
                      <span className="chip" style={{ marginLeft: 6, color: "var(--red)", borderColor: "var(--red)" }}>Payment Overdue</span>
                    )}
                  </td>
                  <td style={{ whiteSpace: "nowrap" }}>
                    {/* Fixed flex layout keeps the View button aligned regardless of whether the Download button is shown. */}
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
                          onClick={() => setDownloadMenuId((cur) => (cur === r.id ? null : r.id))}
                          tabIndex={r.type === "Release" && r.status === "Approved" ? 0 : -1}
                        >
                          <Icon name="download" />
                        </button>
                        {downloadMenuId === r.id && (
                          <div className="docs-dd-menu" style={{ minWidth: 170, right: 0 }}>
                            {/* A partial release never produces the FORM 7 full-release agreement — only its own receipt. */}
                            {r.isPartial ? (
                              <>
                                <a href="#" onClick={(e) => { e.preventDefault(); downloadPartialReceipt(r, "en"); }}>
                                  <Icon name="doc" /><span className="tx">Partial Receipt — English</span>
                                </a>
                                <a href="#" onClick={(e) => { e.preventDefault(); downloadPartialReceipt(r, "ml"); }}>
                                  <Icon name="doc" /><span className="tx">Partial Receipt — Malayalam</span>
                                </a>
                              </>
                            ) : (
                              <>
                                <a href="#" onClick={(e) => { e.preventDefault(); downloadReleaseAgreement(r, "en"); }}>
                                  <Icon name="doc" /><span className="tx">English</span>
                                </a>
                                <a href="#" onClick={(e) => { e.preventDefault(); downloadReleaseAgreement(r, "ml"); }}>
                                  <Icon name="doc" /><span className="tx">Malayalam</span>
                                </a>
                              </>
                            )}
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
        <ScrollSentinel enabled={cards && (page < totalPages)} onVisible={more} watch={reqs.length} />
        <div className="ft ft-scroll-hide" style={{ display: "flex", alignItems: "center", gap: 10 }}>
          <button className="btn plain sm" disabled={page <= 1} onClick={() => setPage((p) => Math.max(1, p - 1))}>‹ Prev</button>
          <span style={{ fontSize: 12.5 }}>Page {page} of {totalPages}</span>
          <button className="btn plain sm" disabled={page >= totalPages} onClick={() => setPage((p) => Math.min(totalPages, p + 1))}>Next ›</button>
        </div>
      </div>
    </>
  );
}
