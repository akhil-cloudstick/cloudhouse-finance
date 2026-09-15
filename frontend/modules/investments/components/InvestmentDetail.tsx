"use client";

import { useCallback, useEffect, useState } from "react";
import { useAuth } from "@/common/auth-context";
import { useToast } from "@/common/components/Toast";
import { ApiError } from "@/common/services/httpClient";
import { fmt } from "@/common/utils/format";
import { StatusChip } from "@/common/components/ui/StatusChip";
import {
  getInvestment,
  getInvestmentSchedulePage,
  type BackendInvestment,
  type BackendInvestmentPayout,
} from "@/modules/investments/services/investmentService";
import { MaturityModalContent } from "@/modules/investments/components/MaturityModal";
import { InvestorStatementModalContent } from "@/modules/investments/components/InvestorStatementModal";
import { MarkPayoutPaidModalContent } from "@/common/components/modals/MarkPayoutPaidModal";
import { useModal } from "@/common/components/Modal";

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
  const { openModal, closeModal } = useModal();
  const toast = useToast();
  const canUpdate = can("Investment_Management", "can_update_investment");

  const [investment, setInvestment] = useState<BackendInvestment | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  const numericId = Number(id);

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
        }}
      />
    );
  }

  function openMaturity() {
    if (!investment) return;
    openModal(<MaturityModalContent investment={investment} onSaved={() => { closeModal(); void refreshInvestment(); schedule.reload(); }} />);
  }

  function openStatement() {
    if (!investment) return;
    openModal(<InvestorStatementModalContent customerId={investment.customerId} customerName={investment.customer?.name || "Investor"} />);
  }

  const investorName = investment.customer?.name || investment.customer?.code || "";

  return (
    <>
      <div className="page-h">
        <div>
          <a href="#investments" style={{ fontSize: 13 }}>← Back</a>
          <h1>Investment {investment.investmentNumber}{investorName ? ` · ${investorName}` : ""}</h1>
        </div>
        <div className="sp" />
        <button className="btn plain" onClick={openStatement}>View Statement</button>
        {canUpdate && investment.status === "Matured" && (
          <button className="btn" onClick={openMaturity}>Close / Renew</button>
        )}
      </div>
      <hr className="gold-rule" />

      <div className="kpis" style={{ marginBottom: 16 }}>
        <div className="kpi"><div className="l">Principal</div><div className="v">{fmt(investment.principalAmount)}</div></div>
        <div className="kpi"><div className="l">Interest Rate</div><div className="v">{investment.interestRatePercent}%</div><div className="s">{investment.interestRateType} · {investment.payoutFrequency}</div></div>
        <div className="kpi"><div className="l">Interest Paid</div><div className="v">{fmt(investment.totalInterestPaid)}</div></div>
        <div className="kpi"><div className="l">Maturity Date</div><div className="v" style={{ fontSize: 17 }}>{investment.maturityDate.slice(0, 10)}</div></div>
        <div className="kpi"><div className="l">Status</div><div className="v" style={{ fontSize: 15 }}><StatusChip status={investment.status} /></div></div>
        <div className="kpi"><div className="l">Tenure</div><div className="v" style={{ fontSize: 17 }}>{investment.tenureMonths} mo</div></div>
        {investment.renewedFromInvestmentId && (
          <div className="kpi"><div className="l">Renewed From</div><div className="v" style={{ fontSize: 17 }}><a href={`#investment/${investment.renewedFromInvestmentId}`}>Investment #{investment.renewedFromInvestmentId}</a></div></div>
        )}
        {investment.renewedToInvestmentId && (
          <div className="kpi"><div className="l">Renewed To</div><div className="v" style={{ fontSize: 17 }}><a href={`#investment/${investment.renewedToInvestmentId}`}>Investment #{investment.renewedToInvestmentId}</a></div></div>
        )}
      </div>

      <div className="card">
        <div className="hd"><h3>Interest Payout Schedule</h3></div>
        {schedule.error && <div className="notice" style={{ margin: 14 }}>{schedule.error}</div>}
        <div className="tbl-wrap tbl-wrap-auto"><table className="tbl tbl-center">
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
    </>
  );
}
