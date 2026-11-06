"use client";

import { TableCols } from "@/common/components/ui/TableCols";
import { useCallback, useEffect, useRef, useState } from "react";
import { useBalanceInHand } from "@/common/hooks/use-balance-in-hand";
import { useAuth, useApprovalWorkflow } from "@/common/providers/AuthProvider";
import { useToast } from "@/common/components/ToastProvider";
import { StageTracker } from "@/common/components/StageTracker";
import { RejectRemarksModalContent } from "@/common/components/modals/RejectRemarksModalContent";
import { ConfirmModalContent } from "@/common/components/modals/ConfirmModalContent";
import { canActAtStage, chainFor, isFinalStage, nextStage, stageByPending, trackerLabels } from "@/common/services/approvalWorkflowService";
import { useModal } from "@/common/components/ModalProvider";
import { useDropdownMenu } from "@/common/hooks/use-dropdown-menu";
import { Icon } from "@/common/components/Icon";
import { ApiError } from "@/common/services/httpClient";
import { fmt, fmtDate, localToday } from "@/common/utils/format";
import { StatusChip } from "@/common/components/ui/StatusChip";
import { LedgerRefLink } from "@/common/components/LedgerRefLink";
import { FooterTotals } from "@/common/components/ui/FooterTotals";
import { NewPersonalLoanModalContent } from "@/modules/personal-loans/components/NewPersonalLoanModalContent";
import { getPersonalLoan, resolvePersonalLoanNumber, getPersonalLoanSchedulePage, getPersonalLoanHistoryPage, listPersonalLoanPaymentsPage, downloadPersonalLoanBond, approvePersonalLoan, listPersonalLoanApprovals, deletePersonalLoan, PERSONAL_LOAN_PAGE_SIZE } from "@/modules/personal-loans/services/personalLoanService";
import { type PersonalLoanApprovalRecord, type PersonalLoanBondLang, type BackendPersonalLoan, type BackendPersonalLoanInstallment, type BackendPersonalLoanHistory, type BackendPersonalLoanPayment } from "@/modules/personal-loans/types/personal-loan-types";
import { CollectPaymentModalContent } from "@/modules/personal-loans/components/CollectPaymentModalContent";
import { PersonalLedgerEditModalContent } from "@/modules/personal-loans/components/PersonalLedgerEditModalContent";
import { LoanLedgerInfoModalContent, type LedgerInfoAction } from "@/modules/loans/components/LoanLedgerInfoModalContent";
import { RenewLoanModalContent } from "@/modules/personal-loans/components/RenewLoanModalContent";
import { EsignLanguageModalContent } from "@/modules/loans/components/EsignLanguageModalContent";
import { navigate, routeHref } from "@/common/services/appRoutes";
import { modeCellFor } from "@/modules/cash/utils/ledgerCells";
import { singleFlight } from "@/common/utils/singleFlight";
import { useScrollPageSize } from "@/common/utils/responsive";
import { ScrollSentinel } from "@/common/components/ui/ScrollSentinel";

/* Click-paginated table (10 rows/page) — same shape/theme as the Customer
 * 360 detail tables (modules/customers/pages/CustomerDetailPage.tsx):
 * `.card > .hd > h3` header, `.tbl-wrap.tbl-wrap-auto` + `.tbl.tbl-center`
 * body, and this same Pager footer. */
// The personal loan bond is a promissory note, so its picker names that document rather than the pledge agreement.
const BOND_LANG_OPTIONS: { value: PersonalLoanBondLang; label: string; native: string }[] = [
  { value: "en", label: "English", native: "Promissory Note" },
  { value: "ml", label: "Malayalam", native: "വാഗ്ദത്ത പത്രം" },
];

/* Due date of the last installment — the schedule is paged, so it is derived the
 * same way the backend builds it (generateScheduleFrom: one step per installment from the opened date). */
function finalDueDate(loan: BackendPersonalLoan): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(loan.openedDate || "");
  if (!m || !(loan.tenureCount > 0)) return "—";
  const d = new Date(+m[1], +m[2] - 1, +m[3]);
  if (loan.frequency === "Monthly") d.setMonth(d.getMonth() + loan.tenureCount);
  else d.setDate(d.getDate() + loan.tenureCount * (loan.frequency === "Weekly" ? 7 : 1));
  const p = (n: number) => String(n).padStart(2, "0");
  return fmtDate(`${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`);
}

function usePagedTable<T>(fetchPage: (page: number, size: number) => Promise<{ items: T[]; hasMore: boolean; total: number; totalDebit?: number; totalCredit?: number }>, resetKey: unknown) {
  const [items, setItems] = useState<T[]>([]);
  const [page, setPage] = useState(1);
  const [total, setTotal] = useState(0);
  const [hasMore, setHasMore] = useState(false);
  // Debit/Credit column sums over every page — only the ledger endpoint sends them.
  const [sums, setSums] = useState({ debit: 0, credit: 0 });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  // Below the card breakpoint the pager is hidden and the list grows on scroll instead.
  const { cards, size, more } = useScrollPageSize(PERSONAL_LOAN_PAGE_SIZE);
  const hasRows = useRef(false);
  hasRows.current = items.length > 0;
  const seq = useRef(0);

  const load = useCallback(async (p: number) => {
    const my = ++seq.current;
    if (!(cards && hasRows.current)) setLoading(true);
    try {
      const res = await fetchPage(cards ? 0 : p - 1, size);
      if (my !== seq.current) return;
      setItems(res.items);
      setTotal(Number.isFinite(res.total) ? res.total : 0);
      setHasMore(!!res.hasMore);
      setSums({ debit: res.totalDebit ?? 0, credit: res.totalCredit ?? 0 });
      setError("");
    } catch (e) {
      if (my !== seq.current) return;
      setError(e instanceof ApiError ? e.message : "Could not load.");
    } finally {
      if (my === seq.current) setLoading(false);
    }
  }, [fetchPage, cards, size]);

  useEffect(() => { setPage(1); }, [resetKey, cards]);
  // resetKey is the loan id, 0 while a loan number is still being resolved — nothing to fetch yet (id 0 only 404s).
  useEffect(() => { if (resetKey) void load(page); }, [load, page, resetKey]);

  // Guards against a NaN total (a stale/failed request, or a response
  // missing the field) ever propagating into "Page N of NaN" — and, via
  // the Pager's Math.min(totalPages, ...)/Math.max(totalPages, ...) Next/
  // Prev handlers, into a NaN `page` itself.
  const totalPages = Math.max(1, Math.ceil((Number.isFinite(total) ? total : 0) / PERSONAL_LOAN_PAGE_SIZE));
  return { items, page, setPage, totalPages, sums, loading, error, reload: () => load(page), cards, hasMore, more };
}

type PagerProps = { page: number; totalPages: number; onChange: (p: number) => void; children?: React.ReactNode };

/* Mirrors Loans.tsx's own `.card.tbl-card` + `.tbl-wrap` + plain `.ft`
 * pattern exactly, rather than the old tbl-wrap-auto/ft-static combo, so
 * this page's tables grow/scroll and its pagers sit exactly like every
 * other list table's — including on tall/wide screens, where
 * tbl-wrap-auto's own calc(100vh - 350px) cap made these tables noticeably
 * shorter than Loans.tsx's `.tbl-card > .tbl-wrap{max-height:none}` one.
 * `.tbl-card`'s own layout (see its app.css comment) is what already solves
 * the two-stacked-cards sticky-footer collision ft-static used to work
 * around, so the plain `.ft` here needs no such opt-out. */
function Pager({ page, totalPages, onChange, children }: PagerProps) {
  return (
    <div className="ft ft-scroll-hide" style={{ display: "flex", alignItems: "center", gap: 12, padding: "12px 14px", flexWrap: "wrap" }}>
      <button className="btn plain" style={{ padding: "9px 18px", fontSize: 13 }} disabled={page <= 1} onClick={() => onChange(Math.max(1, page - 1))}>‹ Prev</button>
      <span style={{ fontSize: 13 }}>Page {page} of {totalPages}</span>
      <button className="btn plain" style={{ padding: "9px 18px", fontSize: 13 }} disabled={page >= totalPages} onClick={() => onChange(Math.min(totalPages, page + 1))}>Next ›</button>
      {children}
    </div>
  );
}

type PersonalLoanDetailPageProps = { id?: string };

export function PersonalLoanDetailPage({ id }: PersonalLoanDetailPageProps) {
  const { can, role, isSystem } = useAuth();
  const { openModal, openChildModal, closeAllModals, closeModal } = useModal();
  const canUpdate = can("Personal_Loan_Management", "can_update_personal_loan");
  // Same grants the gold loan ledger uses: editing or deleting recalculates the loan.
  const canEditLedger = can("Loan_Management", "can_edit_ledger_entry");
  const canDeleteLedger = can("Loan_Management", "can_delete_ledger_entry");
  const toast = useToast();
  // Which personal-loan approval stages apply is per-business configuration.
  const { config: workflow } = useApprovalWorkflow();
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
  const [deciding, setDeciding] = useState(false);
  // The approval chain's audit trail — only fetched for a loan that is (or
  // was) in the chain, to show who rejected it and why.
  const [approvals, setApprovals] = useState<PersonalLoanApprovalRecord[]>([]);

  // `id` is the numeric id, or a loan number ("PL-00003") when reached from
  // a ledger reference — resolved to the numeric id first.
  const [resolvedId, setResolvedId] = useState(0);
  const numericId = Number(id) || resolvedId;
  useEffect(() => {
    if (!id || Number(id)) return;
    resolvePersonalLoanNumber(id)
      .then(setResolvedId)
      .catch((e) => { setError(e instanceof ApiError ? e.message : "Loan not found."); setLoading(false); });
  }, [id]);

  const refreshLoan = useCallback(async () => {
    if (!numericId) return;
    setLoading(true);
    setError("");
    try {
      const rec = await getPersonalLoan(numericId);
      setLoan(rec);
      // An id link gets the loan number (PL-00003) written into the address bar.
      if (id && Number(id) && rec.loanNumber) window.history.replaceState(window.history.state, "", routeHref("personalloan", rec.loanNumber) + window.location.search);
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "Could not load this loan.");
    } finally {
      setLoading(false);
    }
  }, [numericId, id]);

  useEffect(() => { void refreshLoan(); }, [refreshLoan]);

  useEffect(() => {
    if (!loan || (loan.status !== "Pending Approval" && loan.status !== "Rejected")) return;
    listPersonalLoanApprovals(loan.id).then(setApprovals).catch(() => setApprovals([]));
  }, [loan?.id, loan?.status, loan?.approvalStage]);

  const [scheduleTab, setScheduleTab] = useState<"schedule" | "history">("schedule");

  const schedule = usePagedTable<BackendPersonalLoanInstallment>(
    useCallback((page, size) => getPersonalLoanSchedulePage(numericId, page, size),[numericId]),
    numericId
  );
  const history = usePagedTable<BackendPersonalLoanHistory>(
    useCallback((page, size) => getPersonalLoanHistoryPage(numericId, page, size),[numericId]),
    numericId
  );
  const payments = usePagedTable<BackendPersonalLoanPayment>(
    useCallback((page, size) => listPersonalLoanPaymentsPage(numericId, page, size),[numericId]),
    numericId
  );

  // The renewal chain links by numeric id; resolve each to its loan number
  // (PL-xxxxx) so the links read like the rest of the module.
  const [linkedNumbers, setLinkedNumbers] = useState<Record<number, string>>({});
  const renewedFromId = loan?.renewedFromLoanId;
  const renewedToId = loan?.renewedToLoanId;
  useEffect(() => {
    [renewedFromId, renewedToId].forEach((lid) => {
      if (!lid) return;
      getPersonalLoan(lid)
        .then((l) => setLinkedNumbers((m) => ({ ...m, [lid]: l.loanNumber })))
        .catch(() => undefined);
    });
  }, [renewedFromId, renewedToId]);

  // Branch Balance in Hand — the final approval stage pays the loan out of it.
  const balanceInHand = useBalanceInHand(loan?.status === "Pending Approval" ? loan.branchId : undefined);

  if (loading) return <div className="notice">Loading loan…</div>;
  if (error || !loan) return <div className="notice">{error || "Loan not found."}</div>;

  function openCollect() {
    if (!loan) return;
    openModal(<CollectPaymentModalContent loan={loan} onSaved={() => { closeModal(); void refreshLoan(); schedule.reload(); payments.reload(); }} />);
  }
  function openRenew() {
    if (!loan) return;
    openModal(<RenewLoanModalContent loan={loan} onSaved={() => { closeModal(); navigate("personalloans"); }} />, true);
  }

  async function handleDownloadBond(lang: PersonalLoanBondLang) { return singleFlight("personal-loan:download-bond", async () => {
    if (!loan || downloadingBond) return;
    setDownloadingBond(true);
    setDownloadError("");
    try {
      await downloadPersonalLoanBond(loan.id, lang);
    } catch (e) {
      setDownloadError(e instanceof ApiError ? e.message : "Could not download the bond.");
    } finally {
      setDownloadingBond(false);
    }
  }); }

  const customerName = loan.customer?.name || loan.customer?.code || "";

  // Approval chain (personal_loan flow) — a loan parked on a stage that has
  // since been switched off still resolves here and stays on the tracker.
  const pendingApproval = loan.status === "Pending Approval";
  const approvalStageView = pendingApproval ? stageByPending(workflow, "personal_loan", loan.approvalStage) : null;
  const approvalChain = pendingApproval ? chainFor(workflow, "personal_loan", loan.approvalStage) : [];
  const approvalIndex = approvalStageView ? approvalChain.findIndex((s) => s.key === approvalStageView.key) : approvalChain.length;
  const canActOnApproval = canUpdate && canActAtStage({ role, isSystem }, approvalStageView);
  const approvalIsFinal = !!approvalStageView && isFinalStage(workflow, "personal_loan", approvalStageView.key);
  // Same check the backend applies (EnsureCashInHand on the disbursed amount).
  const disburseBlocked = approvalIsFinal && balanceInHand !== null && loan.disbursedAmount > balanceInHand + 0.005;
  const lastRejection = loan.status === "Rejected" ? [...approvals].reverse().find((a) => a.action === "Rejected") : undefined;

  async function decide(action: "Approved" | "Rejected", remarks = "") {
    if (!loan || !approvalStageView) return;
    setDeciding(true);
    try {
      const updated = await approvePersonalLoan(loan.id, { stage: approvalStageView.key, action, remarks: remarks || undefined });
      const next = nextStage(workflow, "personal_loan", approvalStageView.key);
      toast(
        action === "Rejected"
          ? "Personal loan rejected"
          : updated.status === "Pending Approval"
            ? `Approved${next ? ` — sent to ${next.label}` : ""}`
            : `Approved — ${fmt(updated.disbursedAmount)} disbursed to the customer`
      );
      setLoan(updated);
      schedule.reload();
      history.reload();
      payments.reload();
    } catch (e) {
      toast(e instanceof ApiError ? e.message : "Could not record the decision — try again");
      // Rethrown so the reject prompt keeps itself open with the message.
      if (action === "Rejected") throw e;
    } finally {
      setDeciding(false);
    }
  }

  return (
    <>
      <div className="page-h">
        <div>
          <h1>{loan.loanNumber}</h1>
        </div>
        <div className="sp" />
        {pendingApproval && approvalStageView && (canActOnApproval ? (
          <>
            <button
              className="btn"
              disabled={deciding || disburseBlocked}
              title={disburseBlocked ? `Balance in hand ${fmt(balanceInHand!)} is lower than the ${fmt(loan.disbursedAmount)} to disburse — add cash first` : undefined}
              onClick={() => decide("Approved")}
            >
              <Icon name="check" /> {approvalIsFinal ? "Approve & Disburse" : "Approve"}
            </button>
            <button
              className="btn danger"
              disabled={deciding}
              onClick={() => openModal(<RejectRemarksModalContent title={`Reject ${loan.loanNumber}`} required onConfirm={(remarks) => decide("Rejected", remarks)} />)}
            >
              Reject
            </button>
          </>
        ) : (
          <span style={{ color: "var(--muted)", fontSize: 13 }}>Awaiting {approvalStageView.role} approval</span>
        ))}
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
                  openModal(
                    <EsignLanguageModalContent
                      loanNumber={loan.loanNumber}
                      customerName={customerName}
                      title="Print Promissory Note"
                      confirmLabel="🖨 Print Bond"
                      options={BOND_LANG_OPTIONS}
                      onConfirm={(lang) => handleDownloadBond(lang as PersonalLoanBondLang)}
                    />
                  );
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
              {canUpdate && (loan.status === "Active" || loan.status === "Pending Approval") && !loan.renewedFromLoanId && !loan.renewedToLoanId && !loan.totalPaid && !loan.totalPenalInterestCharged && (
                <a href="#" title="Edit Loan" onClick={(e) => { e.preventDefault(); setActionsMenuOpen(false); openModal(<NewPersonalLoanModalContent loan={loan} onSaved={() => { closeModal(); void refreshLoan(); schedule.reload(); payments.reload(); }} />, true); }}>
                  <Icon name="edit" /><span className="tx">Edit Loan</span>
                </a>
              )}
              {canDeleteLedger && (
                <a
                  href="#"
                  title="Delete Loan"
                  className="danger"
                  onClick={(e) => {
                    e.preventDefault();
                    setActionsMenuOpen(false);
                    openModal(
                      <ConfirmModalContent
                        title="Delete Personal Loan"
                        confirmLabel="Delete Loan"
                        busyLabel="Deleting…"
                        danger
                        message={<>Delete <strong>{loan.loanNumber}</strong> and reverse its cash entry? This can&apos;t be undone.</>}
                        onConfirm={async () => {
                          await deletePersonalLoan(loan.id);
                          toast(`${loan.loanNumber} deleted`);
                          navigate("personalloans");
                        }}
                      />
                    );
                  }}
                >
                  <Icon name="trash" /><span className="tx">Delete Loan</span>
                </a>
              )}
            </div>
          )}
        </div>
      </div>
      {downloadError && <div className="notice" style={{ marginBottom: 12 }}>{downloadError}</div>}
      <hr className="gold-rule" />

      {pendingApproval && approvalChain.length > 1 && (
        <div className="card" style={{ marginBottom: 14 }}>
          <div className="bd">
            <StageTracker stages={trackerLabels(workflow, "personal_loan", approvalChain)} currentIndex={approvalIndex} />
            <p className="ccheck-hint" style={{ marginTop: 10 }}>
              Nothing is disbursed and no schedule is created until the final stage approves this loan.
            </p>
          </div>
        </div>
      )}
      {loan.status === "Rejected" && (
        <div className="notice" style={{ marginBottom: 14, color: "var(--red)" }}>
          <Icon name="shield" /> Rejected{lastRejection ? ` by ${lastRejection.actorRole} on ${fmtDate(lastRejection.createdAt)}` : ""}
          {lastRejection?.remarks ? ` — ${lastRejection.remarks}` : ""}. This loan was never disbursed.
        </div>
      )}

      <div className="kpis-strip" style={{ marginBottom: 16 }}>
        <div className="kpis-strip-item"><span className="l">Created</span><span className="v">{fmtDate(loan.openedDate)}</span></div>
        <div className="kpis-strip-item"><span className="l">Principal</span><span className="v">{fmt(loan.principalAmount)}</span></div>
        <div className="kpis-strip-item"><span className="l">Interest</span><span className="v">{fmt(loan.interestAmount)}</span><span className="s">({loan.interestType === "Flat" ? "Flat" : `${loan.interestValue}%`})</span></div>
        <div className="kpis-strip-item"><span className="l">Disbursed</span><span className="v">{fmt(loan.disbursedAmount)}</span></div>
        <div className="kpis-strip-item"><span className="l">Outstanding</span><span className="v">{fmt(loan.outstandingAmount)}</span></div>
        <div className="kpis-strip-item"><span className="l">Status</span><StatusChip status={loan.status} /></div>
        <div className="kpis-strip-item"><span className="l">Frequency</span><span className="v">{loan.frequency}</span></div>
        <div className="kpis-strip-item"><span className="l">Installment</span><span className="v">{fmt(loan.installmentAmount)}</span><span className="s">× {loan.tenureCount}</span></div>
        <div className="kpis-strip-item"><span className="l">Due Date</span><span className="v">{finalDueDate(loan)}</span></div>
        <div className="kpis-strip-item"><span className="l">Grace Period</span><span className="v">{loan.gracePeriodDays > 0 ? `${loan.gracePeriodDays} days` : "None"}</span></div>
        <div className="kpis-strip-item"><span className="l">Penal Interest Rate</span><span className="v">{loan.penalInterestRate}%</span>{loan.penalFlatAmount > 0 && <span className="s">+ {fmt(loan.penalFlatAmount)} flat</span>}</div>
        <div className="kpis-strip-item"><span className="l">Total Paid</span><span className="v">{fmt(loan.totalPaid)}</span></div>
        {loan.renewedFromLoanId && (
          <div className="kpis-strip-item"><span className="l">Renewed From</span><a href={routeHref(`personalloan/${linkedNumbers[loan.renewedFromLoanId] || loan.renewedFromLoanId}`)}>{linkedNumbers[loan.renewedFromLoanId] || "…"}</a></div>
        )}
        {loan.renewedToLoanId && (
          <div className="kpis-strip-item"><span className="l">Renewed To</span><a href={routeHref(`personalloan/${linkedNumbers[loan.renewedToLoanId] || loan.renewedToLoanId}`)}>{linkedNumbers[loan.renewedToLoanId] || "…"}</a></div>
        )}
        {loan.penalCycleCount > 0 && (
          <div className="kpis-strip-item"><span className="l">Penal Interest</span><span className="v">{fmt(loan.totalPenalInterestCharged)}</span><span className="s">(cycle {loan.penalCycleCount})</span></div>
        )}
      </div>

      <div className="pl-detail-grid">
        <div className="card tbl-card tbl-card-fill">
          <div className="hd" style={{ justifyContent: "space-between" }}>
            <h3>{scheduleTab === "schedule" ? "Schedule" : "History"}</h3>
            <div
              className="seg-toggle"
              role="button"
              tabIndex={0}
              onClick={() => setScheduleTab(scheduleTab === "schedule" ? "history" : "schedule")}
              onKeyDown={(e) => {
                if (e.key === "Enter" || e.key === " ") setScheduleTab(scheduleTab === "schedule" ? "history" : "schedule");
              }}
            >
              <span className="seg-toggle-thumb" style={{ transform: scheduleTab === "schedule" ? "translateX(0)" : "translateX(100%)" }} />
              <span className={`seg-toggle-opt${scheduleTab === "schedule" ? " active" : ""}`}>Schedule</span>
              <span className={`seg-toggle-opt${scheduleTab === "history" ? " active" : ""}`}>History</span>
            </div>
          </div>
          {scheduleTab === "schedule" ? (
            <>
              {schedule.error && schedule.items.length > 0 && <div className="notice" style={{ margin: 14 }}>{schedule.error}</div>}
              <div className="tbl-wrap pl-tbl-wrap-fixed"><table className="tbl tbl-center tbl-cards">
                <TableCols widths={[10, 35, 30, 25]} />
                <thead><tr><th>#</th><th>Due Date</th><th className="num">Amount</th><th>Status</th></tr></thead>
                <tbody>
                  {schedule.loading ? (
                    <tr><td colSpan={4} className="empty compact">Loading…</td></tr>
                  ) : schedule.items.length === 0 ? (
                    <tr><td colSpan={4} className="empty compact">No installments.</td></tr>
                  ) : schedule.items.map((s) => {
                    // An unpaid installment past its due date is Missed, not still Pending (same rule as the mobile app).
                    const missed = s.status !== "Paid" && s.status !== "PartiallyPaid" && s.dueDate.slice(0, 10) < localToday();
                    return (
                    <tr key={s.id}>
                      <td data-label="#">{s.sequenceNo}</td>
                      <td data-label="Due Date">{fmtDate(s.dueDate)}</td>
                      <td data-label="Amount" className="num">{fmt(s.amount)}</td>
                      <td data-label="Status"><StatusChip status={missed ? "Missed" : s.status === "PartiallyPaid" ? "Partially Paid" : s.status} /></td>
                    </tr>
                    );
                  })}
                </tbody>
              </table></div>
              <ScrollSentinel enabled={schedule.cards && schedule.hasMore && !schedule.loading} onVisible={schedule.more} watch={schedule.items.length} />
              <Pager page={schedule.page} totalPages={schedule.totalPages} onChange={schedule.setPage} />
            </>
          ) : (
            <>
              {history.error && history.items.length > 0 && <div className="notice" style={{ margin: 14 }}>{history.error}</div>}
              <div className="tbl-wrap pl-tbl-wrap-fixed"><table className="tbl tbl-center tbl-cards">
                <TableCols widths={[25, 45, 30]} />
                <thead><tr><th>Date</th><th>Event</th><th className="num">Amount</th></tr></thead>
                <tbody>
                  {history.loading ? (
                    <tr><td colSpan={3} className="empty compact">Loading…</td></tr>
                  ) : history.items.length === 0 ? (
                    <tr><td colSpan={3} className="empty compact">No history yet.</td></tr>
                  ) : history.items.map((hEntry) => (
                    <tr key={hEntry.id}>
                      <td data-label="Date">{fmtDate(hEntry.occurredAt)}</td>
                      <td data-label="Event" className="pl-history-detail" title={hEntry.detail}>
                        {hEntry.detail}
                        {hEntry.relatedLoanId && (
                          <> · <a href={routeHref(`personalloan/${hEntry.relatedLoanId}`)}>View loan</a></>
                        )}
                      </td>
                      <td data-label="Amount" className="num">{hEntry.amount ? fmt(hEntry.amount) : ""}</td>
                    </tr>
                  ))}
                </tbody>
              </table></div>
              <ScrollSentinel enabled={history.cards && history.hasMore && !history.loading} onVisible={history.more} watch={history.items.length} />
              <Pager page={history.page} totalPages={history.totalPages} onChange={history.setPage} />
            </>
          )}
        </div>

        <div className="card tbl-card tbl-card-fill">
          <div className="hd" style={{ justifyContent: "space-between" }}>
            <h3>Payment Ledger</h3>
          </div>
          {payments.error && <div className="notice" style={{ margin: 14 }}>{payments.error}</div>}
          <div className="tbl-wrap"><table className="tbl tbl-center tbl-stack ledger-amt">
            <TableCols widths={["112px", "108px", null, "88px", null, null, null]} />
            <thead><tr><th>Date</th><th>Ref No</th><th>Particulars</th><th>Method</th><th className="num">Debit</th><th className="num">Credit</th><th className="num">Balance</th></tr></thead>
            <tbody>
              {payments.loading ? (
                <tr><td colSpan={7} className="empty compact">Loading…</td></tr>
              ) : payments.items.length === 0 ? (
                <tr><td colSpan={7} className="empty compact">No ledger entries yet.</td></tr>
              ) : payments.items.map((p, i) => (
                <tr key={p.key || `${p.kind ?? "row"}-${p.id}-${i}`}>
                  <td data-label="Date">{fmtDate(p.date)}</td>
                  <td data-label="Ref No"><LedgerRefLink kind="personalloan" id={p.refNo} label={p.refNo} /></td>
                  <td data-label="Particulars">{p.particulars}</td>
                  <td data-label="Method">
                    {modeCellFor(p.mode || undefined)}
                    {p.bankId && (
                      <div style={{ marginTop: 4 }}>
                        <LedgerRefLink kind="bank" id={p.bankId} label={p.bankName || "Bank"} />
                      </div>
                    )}
                  </td>
                  <td data-label="Debit" className="num" style={{ color: p.debit ? "var(--red)" : undefined }}>{p.debit ? fmt(p.debit) : "—"}</td>
                  <td data-label="Credit" className="num" style={{ color: p.credit ? "var(--green)" : undefined }}>{p.credit ? fmt(p.credit) : "—"}</td>
                  <td data-label="Balance" className="num">
                    {fmt(p.balance)}
                    {(() => {
                      const isPayment = p.kind === "payment" && p.id > 0 && (!p.part || p.part.index === 0);
                      const isDisbursement = p.kind === "disbursement";
                      // a split payment's bank sits on its UPI / Bank Transfer row, which may not be this first row
                      const bankId = p.bankId ?? payments.items.find((x) => x.kind === p.kind && x.id === p.id && x.bankId)?.bankId ?? null;
                      // the bank is shown for a UPI / Bank Transfer entry (a split payment keeps it on that part's row)
                      const bankName = p.mode && p.mode !== "Cash" ? (p.bankName || payments.items.find((x) => x.kind === p.kind && x.id === p.id && x.bankName)?.bankName || "") : "";
                      const entry = isPayment ? { ...p, amount: payments.items.filter((x) => x.kind === "payment" && x.id === p.id).reduce((s, x) => s + x.amount, 0) } : p;
                      const minDate = ((loan && (loan.disbursedAt || loan.openedDate)) || "").slice(0, 10) || undefined;
                      const done = () => { void refreshLoan(); schedule.reload(); payments.reload(); history.reload(); closeAllModals(); };
                      // Edit / Delete live in the entry's info popup and open on top of it
                      const actions: LedgerInfoAction[] = [];
                      if (loan && (isPayment || isDisbursement)) {
                        if (canEditLedger) actions.push({ label: "Edit", icon: "edit", run: () => openChildModal(<PersonalLedgerEditModalContent loanId={loan.id} entry={entry} bankId={bankId} mode="edit" minDate={minDate} onSaved={done} />, true) });
                        // the disbursement is the loan's start and cannot be deleted
                        if (canDeleteLedger && isPayment) actions.push({ label: "Delete", icon: "trash", danger: true, run: () => openChildModal(<PersonalLedgerEditModalContent loanId={loan.id} entry={entry} bankId={bankId} mode="delete" onSaved={done} />, true) });
                      }
                      return (
                        <span className="ledger-info">
                          <button type="button" title="Details" aria-label="Entry details" style={{ border: 0, background: "none", cursor: "pointer", padding: 0, color: "var(--muted)", display: "inline-flex", alignItems: "center" }}
                            onClick={() => openModal(<LoanLedgerInfoModalContent
                              title={p.particulars}
                              kind={(p.debit ? "Debit · " : "Credit · ") + p.particulars}
                              rows={[
                                ["Date", fmtDate(p.date)], ["Ref no", p.refNo], ["Amount", fmt(entry.debit || entry.credit || 0)],
                                ["Mode", p.mode || "—"], ...(bankName ? [["Bank", bankName] as [string, React.ReactNode]] : []), ["Balance", fmt(p.balance)],
                              ]}
                              description={<>{p.particulars}{p.part ? <><br />Split {p.part.index + 1} of {p.part.count}</> : null}</>}
                              actions={actions}
                            />)}><Icon name="info" /></button>
                        </span>
                      );
                    })()}
                  </td>
                </tr>
              ))}
            </tbody>
          </table></div>
          <ScrollSentinel enabled={payments.cards && payments.hasMore && !payments.loading} onVisible={payments.more} watch={payments.items.length} />
          <Pager page={payments.page} totalPages={payments.totalPages} onChange={payments.setPage}>
            <FooterTotals aligned items={[
              { value: payments.sums.debit, color: "var(--red)" },
              { value: payments.sums.credit, color: "var(--green)" },
            ]} />
          </Pager>
        </div>
      </div>
    </>
  );
}
