"use client";

import { useCallback, useEffect, useState } from "react";
import { useAuth } from "@/common/auth-context";
import { useModal } from "@/common/components/Modal";
import { ApiError } from "@/common/services/httpClient";
import { fmt } from "@/common/utils/format";
import { StatusChip } from "@/common/components/ui/StatusChip";
import {
  getPersonalLoan,
  getPersonalLoanSchedulePage,
  listPersonalLoanPaymentsPage,
  downloadPersonalLoanBond,
  type BackendPersonalLoan,
  type BackendPersonalLoanInstallment,
  type BackendPersonalLoanPayment,
} from "@/modules/personal-loans/services/personalLoanService";
import { CollectPaymentModalContent } from "@/modules/personal-loans/components/CollectPaymentModal";
import { RenewLoanModalContent } from "@/modules/personal-loans/components/RenewLoanModal";
import { navigate, routeHref } from "@/common/services/appRoutes";

/* Click-paginated table (10 rows/page) — same shape/theme as the Customer
 * 360 detail tables (modules/customers/components/CustomerDetail.tsx):
 * `.card > .hd > h3` header, `.tbl-wrap.tbl-wrap-auto` + `.tbl.tbl-center`
 * body, and this same Pager footer. */
function usePagedTable<T>(fetchPage: (page: number) => Promise<{ items: T[]; hasMore: boolean }>, resetKey: unknown) {
  const [items, setItems] = useState<T[]>([]);
  const [page, setPage] = useState(1);
  const [hasMore, setHasMore] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  const load = useCallback(async (p: number) => {
    setLoading(true);
    try {
      const res = await fetchPage(p - 1);
      setItems(res.items);
      setHasMore(res.hasMore);
      setError("");
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "Could not load.");
    } finally {
      setLoading(false);
    }
  }, [fetchPage]);

  useEffect(() => { setPage(1); }, [resetKey]);
  useEffect(() => { void load(page); }, [load, page]);

  const totalPages = hasMore ? page + 1 : page;
  return { items, page, setPage, totalPages, loading, error, reload: () => load(page) };
}

/* Mirrors CustomerDetail.tsx's own local Pager exactly (same markup,
 * classes and inline sizing) so this page's pagination looks identical to
 * every Customer 360 table. */
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

  const schedule = usePagedTable<BackendPersonalLoanInstallment>(
    useCallback((page) => getPersonalLoanSchedulePage(numericId, page), [numericId]),
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
    openModal(<RenewLoanModalContent loan={loan} onSaved={() => { closeModal(); navigate("personalloans"); }} />);
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
          <a href={routeHref("personalloans")} style={{ fontSize: 13 }}>← Back</a>
          <h1>Loan {loan.loanNumber}{customerName ? ` · ${customerName}` : ""}</h1>
        </div>
        <div className="sp" />
        <button className="btn doc-action pl-download-bond" disabled={downloadingBond} onClick={handleDownloadBond}>
          <span className="doc-action-tx">{downloadingBond ? "Preparing…" : "Download Bond"}</span>
        </button>
        {canUpdate && loan.status === "Active" && (
          <button className="btn" onClick={openRenew}>Renew Loan</button>
        )}
      </div>
      {downloadError && <div className="notice" style={{ marginBottom: 12 }}>{downloadError}</div>}
      <hr className="gold-rule" />

      <div className="kpis" style={{ marginBottom: 16 }}>
        <div className="kpi"><div className="l">Principal</div><div className="v">{fmt(loan.principalAmount)}</div></div>
        <div className="kpi"><div className="l">Interest</div><div className="v">{fmt(loan.interestAmount)}</div><div className="s">{loan.interestType === "Flat" ? "Flat" : `${loan.interestValue}%`}</div></div>
        <div className="kpi"><div className="l">Disbursed</div><div className="v">{fmt(loan.disbursedAmount)}</div></div>
        <div className="kpi"><div className="l">Outstanding</div><div className="v">{fmt(loan.outstandingAmount)}</div></div>
        <div className="kpi"><div className="l">Status</div><div className="v" style={{ fontSize: 15 }}><StatusChip status={loan.status} /></div></div>
        <div className="kpi"><div className="l">Frequency</div><div className="v" style={{ fontSize: 17 }}>{loan.frequency}</div></div>
        {loan.renewedFromLoanId && (
          <div className="kpi"><div className="l">Renewed From</div><div className="v" style={{ fontSize: 17 }}><a href={routeHref(`personalloan/${loan.renewedFromLoanId}`)}>Loan #{loan.renewedFromLoanId}</a></div></div>
        )}
        {loan.renewedToLoanId && (
          <div className="kpi"><div className="l">Renewed To</div><div className="v" style={{ fontSize: 17 }}><a href={routeHref(`personalloan/${loan.renewedToLoanId}`)}>Loan #{loan.renewedToLoanId}</a></div></div>
        )}
      </div>

      <div className="pl-detail-grid">
        <div className="card">
          <div className="hd"><h3>Schedule</h3></div>
          {schedule.error && <div className="notice" style={{ margin: 14 }}>{schedule.error}</div>}
          <div className="tbl-wrap tbl-wrap-auto"><table className="tbl tbl-center">
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
        </div>

        <div className="card">
          <div className="hd" style={{ justifyContent: "space-between" }}>
            <h3>Payment History</h3>
            {canUpdate && loan.status === "Active" && <button className="btn sm" onClick={openCollect}>+ Collect</button>}
          </div>
          {payments.error && <div className="notice" style={{ margin: 14 }}>{payments.error}</div>}
          <div className="tbl-wrap tbl-wrap-auto"><table className="tbl tbl-center">
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
