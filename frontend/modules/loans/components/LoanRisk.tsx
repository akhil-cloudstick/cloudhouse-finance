"use client";

import { useCallback, useEffect, useState } from "react";
import { fmt } from "@/common/utils/format";
import { ApiError } from "@/common/services/httpClient";
import { DatePicker } from "@/common/components/ui/DatePicker";
import {
  listLoanRiskAssessmentPage, RISK_STATUSES, LOAN_RISK_PAGE_SIZE,
  type LoanRiskRow, type LoanRiskLevel, type LoanRiskCounts,
} from "@/modules/loans/services/loanService";

const RISK_CHIP: Record<LoanRiskLevel, string> = { Green: "green", Orange: "amber", Red: "red" };
const RISK_LABEL: Record<LoanRiskLevel, string> = { Green: "Safe", Orange: "At Risk", Red: "Loss" };

/* Gold-value risk assessment — compares each open loan's principal against
 * what its pledged gold would fetch sold TODAY (backend/internal/loan/
 * service.go's ListLoanRiskAssessment: today's published rate × each
 * ornament's own purity/weight), not the value the loan was opened at, so a
 * loan that looked fully covered at disbursement can still surface here if
 * the gold price has since fallen.
 *
 * Red ("Loss"): today's gold value is below the principal outright — the
 * gold, sold today, would not even cover what's lent out.
 * Orange ("At Risk"): covered today, but by less than the 10% safety
 * margin (RiskBufferPercent on the backend) — the cushion has eroded.
 * Green ("Safe"): comfortably covered.
 *
 * Server-side paginated (8/page), with a loan-status filter and an
 * opened-date range filter — both sent straight to GET /loans/risk-
 * assessment's `status`/`from`/`to` params, same convention as Loans.tsx
 * and Cash Movements' own date filter. The KPI tiles come from the same
 * response's `counts`/`total`, which cover every matching loan, not just
 * the current page. */
export function LoanRisk() {
  const [rows, setRows] = useState<LoanRiskRow[]>([]);
  const [hasMore, setHasMore] = useState(false);
  const [total, setTotal] = useState(0);
  const [counts, setCounts] = useState<LoanRiskCounts>({ red: 0, orange: 0, green: 0 });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [page, setPage] = useState(1);
  const [status, setStatus] = useState("");
  const [fromDate, setFromDate] = useState("");
  const [toDate, setToDate] = useState("");
  const totalPages = Math.max(1, Math.ceil(total / LOAN_RISK_PAGE_SIZE));

  // Any filter change resets back to page 1 rather than leaving the user
  // stranded on a page number the new filter may not have.
  useEffect(() => { setPage(1); }, [status, fromDate, toDate]);

  const refresh = useCallback(() => {
    setLoading(true);
    listLoanRiskAssessmentPage(page, LOAN_RISK_PAGE_SIZE, { status: status || undefined, fromDate: fromDate || undefined, toDate: toDate || undefined })
      .then(({ items, hasMore, total, counts }) => {
        setRows(items);
        setHasMore(hasMore);
        setTotal(total);
        setCounts(counts);
        setError("");
      })
      .catch((e) => {
        setRows([]);
        setError(e instanceof ApiError ? e.message : "Could not load the risk assessment — a gold rate may not be published yet.");
      })
      .finally(() => setLoading(false));
  }, [page, status, fromDate, toDate]);

  useEffect(() => { refresh(); }, [refresh]);

  return (
    <>
      <div className="page-h">
        <div><h1>Loan Risk</h1><p>Principal vs. today&apos;s gold value for every open loan — flags loans a falling gold price has put at risk or at a loss</p></div>
      </div>
      <hr className="gold-rule" />

      <div className="kpis" style={{ marginBottom: 16 }}>
        <div className="kpi"><div className="l">Total Open Loans</div><div className="v">{total}</div></div>
        <div className="kpi"><div className="l">Loss</div><div className="v" style={{ color: "var(--red)" }}>{counts.red}</div></div>
        <div className="kpi"><div className="l">At Risk</div><div className="v" style={{ color: "var(--amber)" }}>{counts.orange}</div></div>
        <div className="kpi"><div className="l">Safe</div><div className="v" style={{ color: "var(--green)" }}>{counts.green}</div></div>
      </div>

      {error && <div className="notice" style={{ marginBottom: 14 }}>{error}</div>}

      <div className="card">
        <div className="hd" style={{ flexWrap: "wrap", rowGap: 10 }}>
          <h3>Loans</h3>
          <div className="sp" />
          <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
            <select className="inp" style={{ width: 170 }} value={status} onChange={(e) => setStatus(e.target.value)}>
              <option value="">All statuses</option>
              {RISK_STATUSES.map((s) => <option key={s} value={s}>{s}</option>)}
            </select>
            <DatePicker value={fromDate} onChange={setFromDate} placeholder="Opened from…" max={toDate || undefined} />
            <DatePicker value={toDate} onChange={setToDate} placeholder="Opened to…" min={fromDate || undefined} />
            {(status || fromDate || toDate) && (
              <button className="btn ghost sm" onClick={() => { setStatus(""); setFromDate(""); setToDate(""); }}>Clear</button>
            )}
          </div>
        </div>
        <div className="tbl-wrap tbl-scroll">
          <table className="tbl tbl-center">
            <thead>
              <tr>
                <th>Loan / Customer</th>
                <th>Status</th>
                <th className="num">Principal</th>
                <th className="num">Gold Weight</th>
                <th className="num">Current Gold Value</th>
                <th className="num">Margin</th>
                <th>Risk</th>
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <tr><td colSpan={7} className="empty">Loading risk assessment…</td></tr>
              ) : rows.length === 0 ? (
                <tr><td colSpan={7} className="empty">No loans in this category.</td></tr>
              ) : rows.map((r) => {
                const margin = r.currentGoldValue - r.principalAmount;
                return (
                  <tr key={r.loanId}>
                    <td>
                      <a href={`#loan/${r.loanNumber}`}>{r.loanNumber}</a>
                      <div style={{ fontSize: 11.5, color: "var(--muted)" }}>{r.customerName}</div>
                    </td>
                    <td>{r.status}</td>
                    <td className="num">{fmt(r.principalAmount)}</td>
                    <td className="num">{r.totalNetWeight.toFixed(2)} g</td>
                    <td className="num">{fmt(r.currentGoldValue)}</td>
                    <td className="num" style={{ color: margin >= 0 ? "var(--green)" : "var(--red)" }}>
                      {margin >= 0 ? "+" : "−"}{fmt(Math.abs(margin))}
                    </td>
                    <td><span className={`chip ${RISK_CHIP[r.riskLevel]}`}>{RISK_LABEL[r.riskLevel]}</span></td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        <div className="ft" style={{ display: "flex", alignItems: "center", gap: 10 }}>
          <button className="btn plain sm" disabled={page <= 1} onClick={() => setPage((p) => Math.max(1, p - 1))}>‹ Prev</button>
          <span style={{ fontSize: 12.5 }}>Page {page} of {totalPages}</span>
          <button className="btn plain sm" disabled={!hasMore} onClick={() => setPage((p) => p + 1)}>Next ›</button>
        </div>
        {/* <div className="ft">Red = gold, sold today, would not cover the principal · Orange = covered by less than a 10% margin · Green = comfortably covered</div> */}
      </div>
    </>
  );
}
