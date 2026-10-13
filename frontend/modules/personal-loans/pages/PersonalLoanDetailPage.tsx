"use client";

import { useCallback, useEffect, useState } from "react";
import { useBalanceInHand } from "@/common/hooks/use-balance-in-hand";
import { useAuth, useApprovalWorkflow } from "@/common/providers/AuthProvider";
import { useToast } from "@/common/components/ToastProvider";
import { StageTracker } from "@/common/components/StageTracker";
import { RejectRemarksModalContent } from "@/common/components/modals/RejectRemarksModalContent";
import { canActAtStage, chainFor, isFinalStage, nextStage, stageByPending, trackerLabels } from "@/common/services/approvalWorkflowService";
import { useModal } from "@/common/components/ModalProvider";
import { useDropdownMenu } from "@/common/hooks/use-dropdown-menu";
import { Icon } from "@/common/components/Icon";
import { ApiError } from "@/common/services/httpClient";
import { fmt, fmtDate } from "@/common/utils/format";
import { StatusChip } from "@/common/components/ui/StatusChip";
import { LedgerRefLink } from "@/common/components/LedgerRefLink";
import { FooterTotals } from "@/common/components/ui/FooterTotals";
import { getPersonalLoan, resolvePersonalLoanNumber, getPersonalLoanSchedulePage, getPersonalLoanHistoryPage, listPersonalLoanPaymentsPage, downloadPersonalLoanBond, approvePersonalLoan, listPersonalLoanApprovals, PERSONAL_LOAN_PAGE_SIZE } from "@/modules/personal-loans/services/personalLoanService";
import { type PersonalLoanApprovalRecord, type PersonalLoanBondLang, type BackendPersonalLoan, type BackendPersonalLoanInstallment, type BackendPersonalLoanHistory, type BackendPersonalLoanPayment } from "@/modules/personal-loans/types/personal-loan-types";
import { CollectPaymentModalContent } from "@/modules/personal-loans/components/CollectPaymentModalContent";
import { RenewLoanModalContent } from "@/modules/personal-loans/components/RenewLoanModalContent";
import { EsignLanguageModalContent } from "@/modules/loans/components/EsignLanguageModalContent";
import { navigate, routeHref } from "@/common/services/appRoutes";
import { modeCellFor } from "@/modules/cash/utils/ledgerCells";
import { singleFlight } from "@/common/utils/singleFlight";

/* Click-paginated table (10 rows/page) — same shape/theme as the Customer
 * 360 detail tables (modules/customers/pages/CustomerDetailPage.tsx):
 * `.card > .hd > h3` header, `.tbl-wrap.tbl-wrap-auto` + `.tbl.tbl-center`
 * body, and this same Pager footer. */
// The personal loan bond is a promissory note, so its picker names that document rather than the pledge agreement.
const BOND_LANG_OPTIONS: { value: PersonalLoanBondLang; label: string; native: string }[] = [
  { value: "en", label: "English", native: "Promissory Note" },
  { value: "ml", label: "Malayalam", native: "വാഗ്ദത്ത പത്രം" },
];

function usePagedTable<T>(fetchPage: (page: number) => Promise<{ items: T[]; hasMore: boolean; total: number; totalDebit?: number; totalCredit?: number }>, resetKey: unknown) {
  const [items, setItems] = useState<T[]>([]);
  const [page, setPage] = useState(1);
  const [total, setTotal] = useState(0);
  // Debit/Credit column sums over every page — only the ledger endpoint sends them.
  const [sums, setSums] = useState({ debit: 0, credit: 0 });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  const load = useCallback(async (p: number) => {
    setLoading(true);
    try {
      const res = await fetchPage(p - 1);
      setItems(res.items);
      setTotal(Number.isFinite(res.total) ? res.total : 0);
      setSums({ debit: res.totalDebit ?? 0, credit: res.totalCredit ?? 0 });
      setError("");
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "Could not load.");
    } finally {
      setLoading(false);
    }
  }, [fetchPage]);

  useEffect(() => { setPage(1); }, [resetKey]);
  useEffect(() => { void load(page); }, [load, page]);

  // Guards against a NaN total (a stale/failed request, or a response
  // missing the field) ever propagating into "Page N of NaN" — and, via
  // the Pager's Math.min(totalPages, ...)/Math.max(totalPages, ...) Next/
  // Prev handlers, into a NaN `page` itself.
  const totalPages = Math.max(1, Math.ceil((Number.isFinite(total) ? total : 0) / PERSONAL_LOAN_PAGE_SIZE));
  return { items, page, setPage, totalPages, sums, loading, error, reload: () => load(page) };
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
    <div className="ft" style={{ display: "flex", alignItems: "center", gap: 12, padding: "12px 14px", flexWrap: "wrap" }}>
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
  const { openModal, closeModal } = useModal();
  const canUpdate = can("Personal_Loan_Management", "can_update_personal_loan");
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
      setLoan(await getPersonalLoan(numericId));
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "Could not load this loan.");
    } finally {
      setLoading(false);
    }
  }, [numericId]);

  useEffect(() => { void refreshLoan(); }, [refreshLoan]);

  useEffect(() => {
    if (!loan || (loan.status !== "Pending Approval" && loan.status !== "Rejected")) return;
    listPersonalLoanApprovals(loan.id).then(setApprovals).catch(() => setApprovals([]));
  }, [loan?.id, loan?.status, loan?.approvalStage]);

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
          <h1>{loan.loanNumber}{customerName ? ` · ${customerName}` : ""}</h1>
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
            </div>
          )}
        </div>
      </div>
      {downloadError && <div className="notice" style={{ marginBottom: 12 }}>{downloadError}</div>}
      <hr className="gold-rule" />

      {pendingApproval && approvalChain.length > 0 && (
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
        {loan.renewedFromLoanId && (
          <div className="kpis-strip-item"><span className="l">Renewed From</span><a href={routeHref(`personalloan/${loan.renewedFromLoanId}`)}>{linkedNumbers[loan.renewedFromLoanId] || "…"}</a></div>
        )}
        {loan.renewedToLoanId && (
          <div className="kpis-strip-item"><span className="l">Renewed To</span><a href={routeHref(`personalloan/${loan.renewedToLoanId}`)}>{linkedNumbers[loan.renewedToLoanId] || "…"}</a></div>
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
                      <td>{fmtDate(s.dueDate)}</td>
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
              {history.error && history.items.length > 0 && <div className="notice" style={{ margin: 14 }}>{history.error}</div>}
              <div className="tbl-wrap pl-tbl-wrap-fixed"><table className="tbl tbl-center">
                <thead><tr><th>Date</th><th>Event</th><th className="num">Amount</th></tr></thead>
                <tbody>
                  {history.loading ? (
                    <tr><td colSpan={3} className="empty compact">Loading…</td></tr>
                  ) : history.items.length === 0 ? (
                    <tr><td colSpan={3} className="empty compact">No history yet.</td></tr>
                  ) : history.items.map((hEntry) => (
                    <tr key={hEntry.id}>
                      <td>{fmtDate(hEntry.occurredAt)}</td>
                      <td className="pl-history-detail" title={hEntry.detail}>
                        {hEntry.detail}
                        {hEntry.relatedLoanId && (
                          <> · <a href={routeHref(`personalloan/${hEntry.relatedLoanId}`)}>View loan</a></>
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

        <div className="card tbl-card tbl-card-fill">
          <div className="hd" style={{ justifyContent: "space-between" }}>
            <h3>Payment Ledger</h3>
          </div>
          {payments.error && <div className="notice" style={{ margin: 14 }}>{payments.error}</div>}
          <div className="tbl-wrap pl-tbl-wrap-fixed"><table className="tbl tbl-center ledger-amt">
            <thead><tr><th>Date</th><th>Ref No</th><th>Particulars</th><th>Method</th><th className="num">Debit</th><th className="num">Credit</th><th className="num">Balance</th></tr></thead>
            <tbody>
              {payments.loading ? (
                <tr><td colSpan={7} className="empty compact">Loading…</td></tr>
              ) : payments.items.length === 0 ? (
                <tr><td colSpan={7} className="empty compact">No ledger entries yet.</td></tr>
              ) : payments.items.map((p, i) => (
                <tr key={p.key || `${p.kind ?? "row"}-${p.id}-${i}`}>
                  <td>{fmtDate(p.date)}</td>
                  <td><LedgerRefLink kind="personalloan" id={p.refNo} label={p.refNo} /></td>
                  <td>{p.particulars}</td>
                  <td>
                    {modeCellFor(p.mode || undefined)}
                    {p.bankId && (
                      <div style={{ marginTop: 4 }}>
                        <LedgerRefLink kind="bank" id={p.bankId} label={p.bankName || "Bank"} />
                      </div>
                    )}
                  </td>
                  <td className="num" style={{ color: p.debit ? "var(--red)" : undefined }}>{p.debit ? fmt(p.debit) : "—"}</td>
                  <td className="num" style={{ color: p.credit ? "var(--green)" : undefined }}>{p.credit ? fmt(p.credit) : "—"}</td>
                  <td className="num">{fmt(p.balance)}</td>
                </tr>
              ))}
            </tbody>
          </table></div>
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
