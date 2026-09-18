"use client";

import { useCallback, useEffect, useState } from "react";
import { useAuth } from "@/common/auth-context";
import { useModal } from "@/common/components/Modal";
import { useDropdownMenu } from "@/hooks/useDropdownMenu";
import { Icon } from "@/common/components/Icon";
import { ApiError } from "@/common/services/httpClient";
import { fmt } from "@/common/utils/format";
import { StatusChip } from "@/common/components/ui/StatusChip";
import {
  getPersonalLoan,
  getPersonalLoanSchedulePage,
  getPersonalLoanHistoryPage,
  listPersonalLoanPaymentsPage,
  downloadPersonalLoanBond,
  PERSONAL_LOAN_PAGE_SIZE,
  type BackendPersonalLoan,
  type BackendPersonalLoanInstallment,
  type BackendPersonalLoanHistory,
  type BackendPersonalLoanPayment,
} from "@/modules/personal-loans/services/personalLoanService";
import { CollectPaymentModalContent } from "@/modules/personal-loans/components/CollectPaymentModal";
import { RenewLoanModalContent } from "@/modules/personal-loans/components/RenewLoanModal";

/* Click-paginated table (10 rows/page) — same shape/theme as the Customer
 * 360 detail tables (modules/customers/components/CustomerDetail.tsx):
 * `.card > .hd > h3` header, `.tbl-wrap.tbl-wrap-auto` + `.tbl.tbl-center`
 * body, and this same Pager footer. */
function usePagedTable<T>(fetchPage: (page: number) => Promise<{ items: T[]; hasMore: boolean; total: number }>, resetKey: unknown) {
  const [items, setItems] = useState<T[]>([]);
  const [page, setPage] = useState(1);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  const load = useCallback(async (p: number) => {
    setLoading(true);
    try {
      const res = await fetchPage(p - 1);
      setItems(res.items);
      setTotal(res.total);
      setError("");
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "Could not load.");
    } finally {
      setLoading(false);
    }
  }, [fetchPage]);

  useEffect(() => { setPage(1); }, [resetKey]);
  useEffect(() => { void load(page); }, [load, page]);

  const totalPages = Math.max(1, Math.ceil(total / PERSONAL_LOAN_PAGE_SIZE));
  return { items, page, setPage, totalPages, loading, error, reload: () => load(page) };
}

/* Mirrors Loans.tsx's own `.card.tbl-card` + `.tbl-wrap` + plain `.ft`
 * pattern exactly, rather than the old tbl-wrap-auto/ft-static combo, so
 * this page's tables grow/scroll and its pagers sit exactly like every
 * other list table's — including on tall/wide screens, where
 * tbl-wrap-auto's own calc(100vh - 350px) cap made these tables noticeably
 * shorter than Loans.tsx's `.tbl-card > .tbl-wrap{max-height:none}` one.
 * `.tbl-card`'s own layout (see its app.css comment) is what already solves
 * the two-stacked-cards sticky-footer collision ft-static used to work
 * around, so the plain `.ft` here needs no such opt-out. */
function Pager({ page, totalPages, onChange }: { page: number; totalPages: number; onChange: (p: number) => void }) {
  return (
    <div className="ft" style={{ display: "flex", alignItems: "center", gap: 12, padding: "12px 14px" }}>
      <button className="btn plain" style={{ padding: "9px 18px", fontSize: 13 }} disabled={page <= 1} onClick={() => onChange(Math.max(1, page - 1))}>‹ Prev</button>
      <span style={{ fontSize: 13 }}>Page {page} of {totalPages}</span>
      <button className="btn plain" style={{ padding: "9px 18px", fontSize: 13 }} disabled={page >= totalPages} onClick={() => onChange(Math.min(totalPages, page + 1))}>Next ›</button>
    </div>
  );
}

export function PersonalLoanDetail({ id }: { id?: string }) {
  const { can } = useAuth();
  const { openModal, closeModal } = useModal();
  const canUpdate = can("Personal_Loan_Management", "can_update_personal_loan");
  // Download Bond + Renew Loan used to be two separate header buttons —
  // collapsed into one "Loan Actions" dropdown, same shape as gold loan's
  // LoanDetail.tsx (LoanActions/Documents menus, both built on this hook).
  const {
    open: actionsMenuOpen,
    setOpen: setActionsMenuOpen,
    menuRef: actionsMenuRef,
    triggerRef: actionsMenuTriggerRef,
    onKeyDown: onActionsMenuKeyDown,
  } = useDropdownMenu<HTMLDivElement>();

  const [loan, setLoan] = useState<BackendPersonalLoan | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [downloadingBond, setDownloadingBond] = useState(false);
  const [downloadError, setDownloadError] = useState("");

  const numericId = Number(id);

  const refreshLoan = useCallback(async () => {
    if (!numericId) return;
    setLoading(true);
    setError("");
    try {
      setLoan(await getPersonalLoan(numericId));
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "Could not load this loan.");
    } finally {
      setLoading(false);
    }
  }, [numericId]);

  useEffect(() => { void refreshLoan(); }, [refreshLoan]);

  const [scheduleTab, setScheduleTab] = useState<"schedule" | "history">("schedule");

  const schedule = usePagedTable<BackendPersonalLoanInstallment>(
    useCallback((page) => getPersonalLoanSchedulePage(numericId, page), [numericId]),
    numericId
  );
  const history = usePagedTable<BackendPersonalLoanHistory>(
    useCallback((page) => getPersonalLoanHistoryPage(numericId, page), [numericId]),
    numericId
  );
  const payments = usePagedTable<BackendPersonalLoanPayment>(
    useCallback((page) => listPersonalLoanPaymentsPage(numericId, page), [numericId]),
    numericId
  );

  if (loading) return <div className="notice">Loading loan…</div>;
  if (error || !loan) return <div className="notice">{error || "Loan not found."}</div>;

  function openCollect() {
    if (!loan) return;
    openModal(<CollectPaymentModalContent loan={loan} onSaved={() => { closeModal(); void refreshLoan(); schedule.reload(); payments.reload(); }} />);
  }
  function openRenew() {
    if (!loan) return;
    openModal(<RenewLoanModalContent loan={loan} onSaved={() => { closeModal(); location.hash = "personalloans"; }} />);
  }

  async function handleDownloadBond() {
    if (!loan || downloadingBond) return;
    setDownloadingBond(true);
    setDownloadError("");
    try {
      await downloadPersonalLoanBond(loan.id);
    } catch (e) {
      setDownloadError(e instanceof ApiError ? e.message : "Could not download the bond.");
    } finally {
      setDownloadingBond(false);
    }
  }

  const customerName = loan.customer?.name || loan.customer?.code || "";

  return (
    <>
      <div className="page-h">
        <div>
          <h1>Loan {loan.loanNumber}{customerName ? ` · ${customerName}` : ""}</h1>
        </div>
        <div className="sp" />
        {canUpdate && (loan.status === "Active" || loan.status === "Pending") && (
          <button className="btn" onClick={openCollect}>+ Collect</button>
        )}
        <div className="docs-dd" ref={actionsMenuRef} onKeyDown={onActionsMenuKeyDown}>
          <button
            ref={actionsMenuTriggerRef}
            type="button"
            className="btn ghost"
            onClick={() => setActionsMenuOpen((v) => !v)}
            aria-haspopup="menu"
            aria-expanded={actionsMenuOpen}
          >
            <Icon name="gear" /> Loan Actions <Icon name="chevronDown" className="docs-dd-chev" />
          </button>
          {actionsMenuOpen && (
            <div className="docs-dd-menu" role="menu">
              <a
                href="#"
                title="Download Bond"
                className={downloadingBond ? "disabled" : ""}
                onClick={(e) => {
                  e.preventDefault();
                  if (downloadingBond) return;
                  setActionsMenuOpen(false);
                  void handleDownloadBond();
                }}
              >
                <Icon name="download" /><span className="tx">{downloadingBond ? "Preparing…" : "Download Bond"}</span>
              </a>
              {/* Renewable in both Active and Pending (past its schedule +
               * grace period, carrying a penal charge — see backend
               * PersonalLoan.StatusPending's doc comment) — renewal rolls
               * over whatever OutstandingAmount currently is either way. */}
              {canUpdate && (loan.status === "Active" || loan.status === "Pending") && (
                <a href="#" title="Renew Loan" onClick={(e) => { e.preventDefault(); setActionsMenuOpen(false); openRenew(); }}>
                  <Icon name="clock" /><span className="tx">Renew Loan</span>
                </a>
              )}
            </div>
          )}
        </div>
      </div>
      {downloadError && <div className="notice" style={{ marginBottom: 12 }}>{downloadError}</div>}
      <hr className="gold-rule" />

      <div className="kpis-strip" style={{ marginBottom: 16 }}>
        <div className="kpis-strip-item"><span className="l">Created</span><span className="v">{loan.openedDate.slice(0, 10)}</span></div>
        <div className="kpis-strip-item"><span className="l">Principal</span><span className="v">{fmt(loan.principalAmount)}</span></div>
        <div className="kpis-strip-item"><span className="l">Interest</span><span className="v">{fmt(loan.interestAmount)}</span><span className="s">({loan.interestType === "Flat" ? "Flat" : `${loan.interestValue}%`})</span></div>
        <div className="kpis-strip-item"><span className="l">Disbursed</span><span className="v">{fmt(loan.disbursedAmount)}</span></div>
        <div className="kpis-strip-item"><span className="l">Outstanding</span><span className="v">{fmt(loan.outstandingAmount)}</span></div>
        <div className="kpis-strip-item"><span className="l">Status</span><StatusChip status={loan.status} /></div>
        <div className="kpis-strip-item"><span className="l">Frequency</span><span className="v">{loan.frequency}</span></div>
        {loan.renewedFromLoanId && (
          <div className="kpis-strip-item"><span className="l">Renewed From</span><a href={`#personalloan/${loan.renewedFromLoanId}`}>Loan #{loan.renewedFromLoanId}</a></div>
        )}
        {loan.renewedToLoanId && (
          <div className="kpis-strip-item"><span className="l">Renewed To</span><a href={`#personalloan/${loan.renewedToLoanId}`}>Loan #{loan.renewedToLoanId}</a></div>
        )}
        {loan.penalCycleCount > 0 && (
          <div className="kpis-strip-item"><span className="l">Penal Interest</span><span className="v">{fmt(loan.totalPenalInterestCharged)}</span><span className="s">(cycle {loan.penalCycleCount})</span></div>
        )}
      </div>

      <div className="pl-detail-grid">
        <div className="card tbl-card">
          <div className="hd" style={{ justifyContent: "space-between" }}>
            <h3>{scheduleTab === "schedule" ? "Schedule" : "History"}</h3>
            <div className="seg" style={{ display: "flex", gap: 4 }}>
              <button
                type="button"
                className={`btn plain${scheduleTab === "schedule" ? " active" : ""}`}
                style={{ height: 24, padding: "0 10px", fontSize: 11.5, lineHeight: "22px", fontWeight: scheduleTab === "schedule" ? 600 : 400 }}
                onClick={() => setScheduleTab("schedule")}
              >
                Schedule
              </button>
              <button
                type="button"
                className={`btn plain${scheduleTab === "history" ? " active" : ""}`}
                style={{ height: 24, padding: "0 10px", fontSize: 11.5, lineHeight: "22px", fontWeight: scheduleTab === "history" ? 600 : 400 }}
                onClick={() => setScheduleTab("history")}
              >
                History
              </button>
            </div>
          </div>
          {scheduleTab === "schedule" ? (
            <>
              {schedule.error && <div className="notice" style={{ margin: 14 }}>{schedule.error}</div>}
              <div className="tbl-wrap pl-tbl-wrap-fixed"><table className="tbl tbl-center">
                <thead><tr><th>#</th><th>Due Date</th><th className="num">Amount</th><th>Status</th></tr></thead>
                <tbody>
                  {schedule.loading ? (
                    <tr><td colSpan={4} className="empty compact">Loading…</td></tr>
                  ) : schedule.items.length === 0 ? (
                    <tr><td colSpan={4} className="empty compact">No installments.</td></tr>
                  ) : schedule.items.map((s) => (
                    <tr key={s.id}>
                      <td>{s.sequenceNo}</td>
                      <td>{s.dueDate.slice(0, 10)}</td>
                      <td className="num">{fmt(s.amount)}</td>
                      <td><StatusChip status={s.status === "PartiallyPaid" ? "Partially Paid" : s.status} /></td>
                    </tr>
                  ))}
                </tbody>
              </table></div>
              <Pager page={schedule.page} totalPages={schedule.totalPages} onChange={schedule.setPage} />
            </>
          ) : (
            <>
              {history.error && <div className="notice" style={{ margin: 14 }}>{history.error}</div>}
              <div className="tbl-wrap pl-tbl-wrap-fixed"><table className="tbl tbl-center">
                <thead><tr><th>Date</th><th>Event</th><th className="num">Amount</th></tr></thead>
                <tbody>
                  {history.loading ? (
                    <tr><td colSpan={3} className="empty compact">Loading…</td></tr>
                  ) : history.items.length === 0 ? (
                    <tr><td colSpan={3} className="empty compact">No history yet.</td></tr>
                  ) : history.items.map((hEntry) => (
                    <tr key={hEntry.id}>
                      <td>{hEntry.occurredAt.slice(0, 10)}</td>
                      <td className="pl-history-detail" title={hEntry.detail}>
                        {hEntry.detail}
                        {hEntry.relatedLoanId && (
                          <> · <a href={`#personalloan/${hEntry.relatedLoanId}`}>View loan</a></>
                        )}
                      </td>
                      <td className="num">{hEntry.amount ? fmt(hEntry.amount) : ""}</td>
                    </tr>
                  ))}
                </tbody>
              </table></div>
              <Pager page={history.page} totalPages={history.totalPages} onChange={history.setPage} />
            </>
          )}
        </div>

        <div className="card tbl-card">
          <div className="hd" style={{ justifyContent: "space-between" }}>
            <h3>Payment History</h3>
          </div>
          {payments.error && <div className="notice" style={{ margin: 14 }}>{payments.error}</div>}
          <div className="tbl-wrap pl-tbl-wrap-fixed"><table className="tbl tbl-center">
            <thead><tr><th>Date</th><th className="num">Amount</th><th>Method</th><th className="num">Balance</th></tr></thead>
            <tbody>
              {payments.loading ? (
                <tr><td colSpan={4} className="empty compact">Loading…</td></tr>
              ) : payments.items.length === 0 ? (
                <tr><td colSpan={4} className="empty compact">No payments yet.</td></tr>
              ) : payments.items.map((p) => (
                <tr key={p.id}>
                  <td>{p.paidOn.slice(0, 10)}</td>
                  <td className="num">{fmt(p.amount)}</td>
                  <td>{p.method}</td>
                  <td className="num">{fmt(p.runningBalance)}</td>
                </tr>
              ))}
            </tbody>
          </table></div>
          <Pager page={payments.page} totalPages={payments.totalPages} onChange={payments.setPage} />
        </div>
      </div>
    </>
  );
}
