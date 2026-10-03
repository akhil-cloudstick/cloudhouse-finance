"use client";

import { useCallback, useEffect, useState } from "react";
import { useAuth } from "@/product/providers/auth-context";
import { useToast } from "@/product/components/Toast";
import { ApiError } from "@/product/services/httpClient";
import { fmt } from "@/product/utils/format";
import { useLedgerFocus } from "@/product/hooks/useLedgerFocus";
import { StatusChip } from "@/product/components/ui/StatusChip";
import {
  getInvestment,
  getInvestmentSchedulePage,
  getInvestmentLedger,
  resolveInvestmentNumber,
  printInvestmentBondPdf,
  printInvestmentStatementPdf,
  type BackendInvestment,
  type BackendInvestmentPayout,
  type InvestmentLedgerRow,
} from "@/product/pages/investments/services/investmentService";
import { LedgerRefLink } from "@/product/components/ui/LedgerRefLink";
import { MaturityModalContent } from "@/product/pages/investments/components/MaturityModal";
import { MarkPayoutPaidModalContent } from "@/product/components/modals/MarkPayoutPaidModal";
import { AddInvestmentCashModalContent } from "@/product/components/modals/AddInvestmentCashModal";
import { WithdrawInvestmentModalContent } from "@/product/components/modals/WithdrawInvestmentModal";
import { useModal } from "@/product/components/Modal";
import { useDropdownMenu } from "@/product/hooks/useDropdownMenu";
import { Icon } from "@/product/components/Icon";
import { routeHref } from "@/product/services/appRoutes";
import { modeCellFor } from "@/product/pages/cash/components/ledgerCells";

/* Same click-paginated table pattern as personal-loans/components/
 * PersonalLoanDetail.tsx's usePagedTable + Pager. */
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

function Pager({ page, totalPages, onChange }: { page: number; totalPages: number; onChange: (p: number) => void }) {
  return (
    <div className="ft" style={{ display: "flex", alignItems: "center", gap: 12, padding: "12px 14px" }}>
      <button className="btn plain" style={{ padding: "9px 18px", fontSize: 13 }} disabled={page <= 1} onClick={() => onChange(Math.max(1, page - 1))}>‹ Prev</button>
      <span style={{ fontSize: 13 }}>Page {page} of {totalPages}</span>
      <button className="btn plain" style={{ padding: "9px 18px", fontSize: 13 }} disabled={page >= totalPages} onClick={() => onChange(Math.min(totalPages, page + 1))}>Next ›</button>
    </div>
  );
}

export function InvestmentDetail({ id }: { id?: string }) {
  const { can } = useAuth();
  const canExport = can("Ledger_Export", "can_export_ledger");
  const { openModal, closeModal } = useModal();
  const toast = useToast();
  const canUpdate = can("Investment_Management", "can_update_investment");

  const [investment, setInvestment] = useState<BackendInvestment | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [printingBond, setPrintingBond] = useState(false);
  const [printingStatement, setPrintingStatement] = useState(false);

  const {
    open: cashMenuOpen,
    setOpen: setCashMenuOpen,
    menuRef: cashMenuRef,
    triggerRef: cashMenuTriggerRef,
    onKeyDown: onCashMenuKeyDown,
  } = useDropdownMenu<HTMLDivElement>();
  const {
    open: docsMenuOpen,
    setOpen: setDocsMenuOpen,
    menuRef: docsMenuRef,
    triggerRef: docsMenuTriggerRef,
    onKeyDown: onDocsMenuKeyDown,
  } = useDropdownMenu<HTMLDivElement>();

  // `id` is the numeric id, or an investment number ("INV-00003") when
  // reached from a ledger reference — resolved to the numeric id first.
  const [numericId, setNumericId] = useState(() => Number(id) || 0);
  useEffect(() => {
    if (Number(id)) { setNumericId(Number(id)); return; }
    if (!id) return;
    resolveInvestmentNumber(id)
      .then(setNumericId)
      .catch((e) => { setError(e instanceof ApiError ? e.message : "Investment not found."); setLoading(false); });
  }, [id]);

  const [ledger, setLedger] = useState<InvestmentLedgerRow[]>([]);
  const [ledgerLoading, setLedgerLoading] = useState(true);
  const [ledgerError, setLedgerError] = useState("");
  const refreshLedger = useCallback(async () => {
    if (!numericId) return;
    setLedgerLoading(true);
    try {
      setLedger(await getInvestmentLedger(numericId));
      setLedgerError("");
    } catch (e) {
      setLedgerError(e instanceof ApiError ? e.message : "Could not load the ledger.");
    } finally {
      setLedgerLoading(false);
    }
  }, [numericId]);
  useEffect(() => { void refreshLedger(); }, [refreshLedger]);
  useLedgerFocus("investment-ledger", !ledgerLoading, [ledger]);

  const refreshInvestment = useCallback(async () => {
    if (!numericId) return;
    setLoading(true);
    setError("");
    try {
      setInvestment(await getInvestment(numericId));
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "Could not load this investment.");
    } finally {
      setLoading(false);
    }
  }, [numericId]);

  useEffect(() => { void refreshInvestment(); }, [refreshInvestment]);

  const schedule = usePagedTable<BackendInvestmentPayout>(
    useCallback((page) => getInvestmentSchedulePage(numericId, page), [numericId]),
    numericId
  );

  if (loading) return <div className="notice">Loading investment…</div>;
  if (error || !investment) return <div className="notice">{error || "Investment not found."}</div>;

  const isLive = investment.engine === "Live";

  function openMarkPaid(payout: BackendInvestmentPayout) {
    if (!investment) return;
    openModal(
      <MarkPayoutPaidModalContent
        investmentId={investment.id}
        payout={payout}
        onSaved={async () => {
          toast(`${payout.isPrincipalReturn ? "Principal return" : "Interest payout"} of ${fmt(payout.amount)} recorded as paid`);
          await refreshInvestment();
          schedule.reload();
          void refreshLedger();
        }}
      />
    );
  }

  function openMaturity() {
    if (!investment) return;
    openModal(<MaturityModalContent investment={investment} onSaved={() => { closeModal(); void refreshInvestment(); schedule.reload(); void refreshLedger(); }} />);
  }

  async function handlePrintBond() {
    if (!investment) return;
    setPrintingBond(true);
    try {
      await printInvestmentBondPdf(investment.id);
    } catch (e) {
      toast(e instanceof ApiError ? e.message : "Could not print the agreement — try again.");
    } finally {
      setPrintingBond(false);
    }
  }

  async function handlePrintStatement() {
    if (!investment) return;
    setPrintingStatement(true);
    try {
      await printInvestmentStatementPdf(investment.id);
    } catch (e) {
      toast(e instanceof ApiError ? e.message : "Could not print the statement — try again.");
    } finally {
      setPrintingStatement(false);
    }
  }

  function openAddCash() {
    if (!investment) return;
    openModal(
      <AddInvestmentCashModalContent
        investment={investment}
        onSaved={async () => {
          toast("Cash added to this investment");
          await refreshInvestment();
          void refreshLedger();
        }}
      />
    );
  }

  function openWithdraw() {
    if (!investment) return;
    openModal(
      <WithdrawInvestmentModalContent
        investment={investment}
        onSaved={async () => {
          toast("Withdrawal recorded");
          await refreshInvestment();
          void refreshLedger();
        }}
      />
    );
  }

  const investorName = investment.customer?.name || investment.customer?.code || "";

  return (
    <>
      <div className="page-h">
        <div>
          <h1>Investment {investment.investmentNumber}</h1>
          <p style={{ margin: "2px 0 0", fontSize: 13.5, color: "var(--muted)", display: "flex", alignItems: "center", gap: 8 }}>
            {investorName}{investment.plan?.name ? ` · ${investment.plan.name}` : ""}
            <StatusChip status={investment.status} />
          </p>
        </div>
        <div className="sp" />
        <div className="docs-dd" ref={docsMenuRef} onKeyDown={onDocsMenuKeyDown}>
          <button
            ref={docsMenuTriggerRef}
            className="btn plain"
            onClick={() => setDocsMenuOpen((v) => !v)}
            aria-haspopup="menu"
            aria-expanded={docsMenuOpen}
          >
            <Icon name="doc" /> Documents <Icon name="chevronDown" className="docs-dd-chev" />
          </button>
          {docsMenuOpen && (
            <div className="docs-dd-menu" role="menu">
              <a href="#" title="Print Agreement" className={printingBond ? "disabled" : ""} onClick={(e) => { e.preventDefault(); if (printingBond) return; setDocsMenuOpen(false); void handlePrintBond(); }}>
                <Icon name="doc" /><span className="tx">{printingBond ? "Opening…" : "Print Agreement"}</span>
              </a>
              {canExport && (
                <a href="#" title="Print Statement" className={printingStatement ? "disabled" : ""} onClick={(e) => { e.preventDefault(); if (printingStatement) return; setDocsMenuOpen(false); void handlePrintStatement(); }}>
                  <Icon name="doc" /><span className="tx">{printingStatement ? "Opening…" : "Print Statement"}</span>
                </a>
              )}
            </div>
          )}
        </div>
        {canUpdate && isLive && investment.status === "Active" && (
          <div className="docs-dd" ref={cashMenuRef} onKeyDown={onCashMenuKeyDown}>
            <button
              ref={cashMenuTriggerRef}
              className="btn"
              onClick={() => setCashMenuOpen((v) => !v)}
              aria-haspopup="menu"
              aria-expanded={cashMenuOpen}
            >
              <Icon name="coin" /> Cash <Icon name="chevronDown" className="docs-dd-chev" />
            </button>
            {cashMenuOpen && (
              <div className="docs-dd-menu" role="menu">
                <a href="#" title="Add Cash" onClick={(e) => { e.preventDefault(); setCashMenuOpen(false); openAddCash(); }}>
                  <Icon name="plus" /><span className="tx">Add Cash</span>
                </a>
                <a href="#" title="Withdraw" onClick={(e) => { e.preventDefault(); setCashMenuOpen(false); openWithdraw(); }}>
                  <Icon name="coin" /><span className="tx">Withdraw</span>
                </a>
              </div>
            )}
          </div>
        )}
        {canUpdate && !isLive && investment.status === "Matured" && (
          <button className="btn" onClick={openMaturity}>Close / Renew</button>
        )}
      </div>
      <hr className="gold-rule" />

      <div className="kpis" style={{ marginBottom: 16 }}>
        <div className="kpi"><div className="l">Principal</div><div className="v">{fmt(investment.principalAmount)}</div></div>
        <div className="kpi"><div className="l">Interest Rate</div><div className="v">{investment.interestRatePercent}%</div><div className="s">{investment.interestRateType} · {investment.payoutFrequency}</div></div>
        {isLive ? (
          <div className="kpi"><div className="l">Outstanding Interest</div><div className="v">{fmt(investment.outstandingInterest)}</div></div>
        ) : (
          <div className="kpi"><div className="l">Interest Paid</div><div className="v">{fmt(investment.totalInterestPaid)}</div></div>
        )}
        <div className="kpi"><div className="l">Maturity Date</div><div className="v" style={{ fontSize: 17 }}>{investment.maturityDate.slice(0, 10)}</div></div>
        {investment.renewedFromInvestmentId && (
          <div className="kpi"><div className="l">Renewed From</div><div className="v" style={{ fontSize: 17 }}><a href={routeHref(`investment/${investment.renewedFromInvestmentId}`)}>Investment #{investment.renewedFromInvestmentId}</a></div></div>
        )}
        {investment.renewedToInvestmentId && (
          <div className="kpi"><div className="l">Renewed To</div><div className="v" style={{ fontSize: 17 }}><a href={routeHref(`investment/${investment.renewedToInvestmentId}`)}>Investment #{investment.renewedToInvestmentId}</a></div></div>
        )}
      </div>

      {/* The investment's ledger — opening deposit, then every Add Cash/
        * Withdraw (Live) or paid payout (Schedule). Balance is the principal
        * still owed to the investor after each row. */}
      <div className="card tbl-card" style={{ marginBottom: 16 }}>
        <div className="hd">
          <h3>Ledger</h3>
          <div className="sp" />
          {investment.customerId ? (
            <LedgerRefLink kind="customer" id={investment.customerId} label={`${investorName || "Investor"} — customer ledger`} />
          ) : null}
        </div>
        {ledgerError && <div className="notice" style={{ margin: 14 }}>{ledgerError}</div>}
        <div className="tbl-wrap"><table className="tbl" data-ledger-scope="investment-ledger">
          <thead><tr><th>Date</th><th>Ref No</th><th>Particulars</th><th>Method</th><th className="num">Debit</th><th className="num">Credit</th><th className="num">Balance</th></tr></thead>
          <tbody>
            {ledgerLoading ? (
              <tr><td colSpan={7} className="empty compact">Loading…</td></tr>
            ) : ledger.length === 0 ? (
              <tr><td colSpan={7} className="empty compact">No ledger entries yet.</td></tr>
            ) : ledger.map((r) => {
              const split = [
                r.principalAmount > 0 && `Principal ${fmt(r.principalAmount)}`,
                r.interestAmount > 0 && `Interest ${fmt(r.interestAmount)}`,
              ].filter(Boolean).join(" · ");
              return (
                <tr key={r.id} data-ledger-key={r.id} data-ledger-date={r.date.slice(0, 10)} data-ledger-amount={r.amount}>
                  <td>{r.date.slice(0, 10)}</td>
                  <td>{r.reference || "—"}</td>
                  <td>
                    {r.description || r.type}
                    {split && r.debitOrCredit === "debit" && <div style={{ fontSize: "0.85em", color: "var(--muted)" }}>{split}</div>}
                  </td>
                  <td>
                    {modeCellFor(r.method)}
                  </td>
                  <td className="num" style={{ color: r.debitOrCredit === "debit" ? "var(--red)" : undefined }}>{r.debitOrCredit === "debit" ? fmt(r.amount) : "—"}</td>
                  <td className="num" style={{ color: r.debitOrCredit === "credit" ? "var(--green)" : undefined }}>{r.debitOrCredit === "credit" ? fmt(r.amount) : "—"}</td>
                  <td className="num">{fmt(r.runningBalance)}</td>
                </tr>
              );
            })}
          </tbody>
        </table></div>
      </div>

      {!isLive && (
        <div className="card tbl-card tbl-card-fill">
          <div className="hd"><h3>Interest Payout Schedule</h3></div>
          {schedule.error && <div className="notice" style={{ margin: 14 }}>{schedule.error}</div>}
          <div className="tbl-wrap"><table className="tbl tbl-center">
            <thead><tr><th>#</th><th>Due Date</th><th className="num">Amount</th><th>Type</th><th>Status</th><th></th></tr></thead>
            <tbody>
              {schedule.loading ? (
                <tr><td colSpan={6} className="empty compact">Loading…</td></tr>
              ) : schedule.items.length === 0 ? (
                <tr><td colSpan={6} className="empty compact">No payouts scheduled.</td></tr>
              ) : schedule.items.map((p) => (
                <tr key={p.id}>
                  <td>{p.sequenceNo}</td>
                  <td>{p.dueDate.slice(0, 10)}</td>
                  <td className="num">{fmt(p.amount)}</td>
                  <td>{p.isPrincipalReturn ? "Principal Return" : "Interest"}</td>
                  <td><StatusChip status={p.status} /></td>
                  <td>
                    {canUpdate && p.status === "Pending" && (
                      <button className="btn plain sm" onClick={() => openMarkPaid(p)}>Mark Paid</button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table></div>
          <Pager page={schedule.page} totalPages={schedule.totalPages} onChange={schedule.setPage} />
        </div>
      )}
    </>
  );
}
