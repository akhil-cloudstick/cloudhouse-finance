"use client";

import { useEffect, useState } from "react";
import { useModal } from "@/common/components/Modal";
import { ApiError } from "@/common/services/httpClient";
import { fmt } from "@/common/utils/format";
import { StatusChip } from "@/common/components/ui/StatusChip";
import { getInvestorLedger, type InvestorLedgerRow, type InvestorLedgerTotals } from "@/modules/reports/services/reportsService";
import { navigate } from "@/common/services/appRoutes";

const dt = (v: string) => v ? new Date(v).toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" }) : "—";

/* "View Statement" — every investment belonging to one investor, in one
 * modal (GET /reports/investments/investor-ledger, see backend/internal/
 * reports/reports_investments.go's InvestorLedger doc comment: a detail
 * view rather than a date-scoped register, so it's launched directly from
 * InvestmentDetail.tsx rather than through the Reports tile grid). */
export function InvestorStatementModalContent({ customerId, customerName }: { customerId: number; customerName: string }) {
  const { closeModal } = useModal();

  const [rows, setRows] = useState<InvestorLedgerRow[]>([]);
  const [totals, setTotals] = useState<InvestorLedgerTotals | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    let cancelled = false;
    getInvestorLedger(customerId)
      .then((res) => { if (!cancelled) { setRows(res.rows); setTotals(res.totals); } })
      .catch((e) => { if (!cancelled) setError(e instanceof ApiError ? e.message : "Could not load this investor's statement."); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [customerId]);

  return (
    <>
      <div className="hd"><h3>Investor Statement — {customerName}</h3><button className="x" onClick={closeModal}>×</button></div>
      <div className="bd">
        {totals && (
          <div className="kpis" style={{ marginBottom: 14 }}>
            <div className="kpi"><div className="l">Investments</div><div className="v">{totals.count}</div></div>
            <div className="kpi"><div className="l">Total Principal</div><div className="v">{fmt(totals.totalPrincipal)}</div></div>
            <div className="kpi"><div className="l">Total Interest Paid</div><div className="v">{fmt(totals.totalInterestPaid)}</div></div>
          </div>
        )}
        {error && <div className="notice">{error}</div>}
        <div className="tbl-wrap tbl-wrap-auto"><table className="tbl tbl-center">
          <thead><tr><th>Investment #</th><th>Plan</th><th className="num">Principal</th><th className="num">Interest Paid</th><th>Start</th><th>Maturity</th><th>Status</th></tr></thead>
          <tbody>
            {loading ? (
              <tr><td colSpan={7} className="empty compact">Loading…</td></tr>
            ) : rows.length === 0 ? (
              <tr><td colSpan={7} className="empty compact">No investments for this investor.</td></tr>
            ) : rows.map((r) => (
              <tr key={r.investmentId} className="click" onClick={() => { navigate("investment/" + r.investmentId); closeModal(); }}>
                <td>{r.investmentNumber}</td>
                <td>{r.planName}</td>
                <td className="num">{fmt(r.principalAmount)}</td>
                <td className="num">{fmt(r.totalInterestPaid)}</td>
                <td>{dt(r.startDate)}</td>
                <td>{dt(r.maturityDate)}</td>
                <td><StatusChip status={r.status} /></td>
              </tr>
            ))}
          </tbody>
        </table></div>
      </div>
      <div className="ft">
        <button className="btn plain" style={{ fontSize: 12.5, fontWeight: 600, letterSpacing: ".16em", textTransform: "uppercase" }} onClick={closeModal}>Close</button>
      </div>
    </>
  );
}
