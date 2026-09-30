"use client";

import { useCallback, useEffect, useState } from "react";
import { fmt } from "@/product/utils/format";
import { ApiError } from "@/product/services/httpClient";
import { DatePicker } from "@/product/components/ui/DatePicker";
import { Select } from "@/product/components/ui/Select";
import {
  listLoanRiskAssessmentPage, RISK_STATUSES, LOAN_RISK_PAGE_SIZE,
  type LoanRiskRow, type LoanRiskLevel, type LoanRiskCounts,
} from "@/product/pages/loans/services/loanService";
import { routeHref } from "@/product/services/appRoutes";

const RISK_CHIP: Record<LoanRiskLevel, string> = { Safe: "green", AtRisk: "amber", Loss: "red" };
const RISK_LABEL: Record<LoanRiskLevel, string> = { Safe: "Safe", AtRisk: "At Risk", Loss: "Loss" };
// All three levels, in the order the KPI tiles/filter pills display them.
const RISK_LEVELS: LoanRiskLevel[] = ["Loss", "AtRisk", "Safe"];

/* Gold-value risk assessment — compares each open loan's principal against
 * what its pledged gold would fetch sold TODAY (backend/internal/loan/
 * service.go's ListLoanRiskAssessment: today's published rate × each
 * ornament's own purity/weight), not the value the loan was opened at, so a
 * loan that looked fully covered at disbursement can still surface here if
 * the gold price has since fallen.
 *
 * Loss: today's gold value is below the principal outright — the gold,
 * sold today, would not even cover what's lent out.
 * At Risk: covered today, but by less than the 10% safety margin
 * (RiskBufferPercent on the backend) — the cushion has eroded.
 * Safe: comfortably covered.
 *
 * Server-side paginated (8/page), with a loan-status filter, a risk-level
 * filter, and an opened-date range filter — all sent straight to GET
 * /loans/risk-assessment's `status`/`riskLevel`/`from`/`to` params, same
 * convention as Loans.tsx and Cash Movements' own date filter. The KPI
 * tiles come from the same response's `counts`/`total`, which cover every
 * loan matching status/from/to regardless of the riskLevel filter, not
 * just the current page. */
export function LoanRisk() {
  const [rows, setRows] = useState<LoanRiskRow[]>([]);
  const [hasMore, setHasMore] = useState(false);
  const [total, setTotal] = useState(0);
  const [counts, setCounts] = useState<LoanRiskCounts>({ loss: 0, atRisk: 0, safe: 0 });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [page, setPage] = useState(1);
  const [status, setStatus] = useState("");
  const [riskLevel, setRiskLevel] = useState<LoanRiskLevel | "">("");
  const [fromDate, setFromDate] = useState("");
  const [toDate, setToDate] = useState("");
  const totalPages = Math.max(1, Math.ceil(total / LOAN_RISK_PAGE_SIZE));

  // Any filter change resets back to page 1 rather than leaving the user
  // stranded on a page number the new filter may not have.
  useEffect(() => { setPage(1); }, [status, riskLevel, fromDate, toDate]);

  const refresh = useCallback(() => {
    setLoading(true);
    listLoanRiskAssessmentPage(page, LOAN_RISK_PAGE_SIZE, {
      status: status || undefined,
      riskLevel: riskLevel || undefined,
      fromDate: fromDate || undefined,
      toDate: toDate || undefined,
    })
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
  }, [page, status, riskLevel, fromDate, toDate]);

  useEffect(() => { refresh(); }, [refresh]);

  return (
    <>
      <div className="page-h">
        <div><h1>Loan Risk</h1><p>Outstanding principal vs. today&apos;s gold value for every open loan — flags loans a falling gold price has put at risk or at a loss</p></div>
      </div>
      <hr className="gold-rule" />

      {/* Each tile also acts as a one-click filter for that risk level —
        * clicking the level already selected clears it back to "All", same
        * toggle behavior as re-picking a Select's current value would give,
        * but faster since the count is already right there. Counts
        * themselves always reflect the full status/date-matched set (see
        * loanService.ts's LoanRiskCounts doc comment), so the other two
        * tiles don't collapse to zero while one level is selected. */}
      <div className="kpis" style={{ marginBottom: 16 }}>
        <div className="kpi"><div className="l">Total Open Loans</div><div className="v">{total}</div></div>
        {RISK_LEVELS.map((level) => (
          <button
            key={level}
            type="button"
            className="kpi"
            style={{
              cursor: "pointer",
              textAlign: "left",
              border: riskLevel === level ? `1px solid var(--${RISK_CHIP[level]})` : undefined,
            }}
            onClick={() => setRiskLevel((cur) => (cur === level ? "" : level))}
            title={`Show only ${RISK_LABEL[level]} loans`}
          >
            <div className="l">{RISK_LABEL[level]}</div>
            <div className="v" style={{ color: `var(--${RISK_CHIP[level]})` }}>
              {level === "Loss" ? counts.loss : level === "AtRisk" ? counts.atRisk : counts.safe}
            </div>
          </button>
        ))}
      </div>

      <div className="loan-risk-filters" style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap", marginBottom: 10, justifyContent: "flex-end" }}>
        <div style={{ width: 170 }}>
          <Select
            options={[{ value: "", label: "All statuses" }, ...RISK_STATUSES.map((s) => ({ value: s, label: s }))]}
            value={status}
            onChange={setStatus}
          />
        </div>
        <div style={{ width: 150 }}>
          <Select
            options={[{ value: "", label: "All risk levels" }, ...RISK_LEVELS.map((l) => ({ value: l, label: RISK_LABEL[l] }))]}
            value={riskLevel}
            onChange={(v) => setRiskLevel(v as LoanRiskLevel | "")}
          />
        </div>
        <DatePicker value={fromDate} onChange={setFromDate} placeholder="Opened from…" max={toDate || undefined} />
        <DatePicker value={toDate} onChange={setToDate} placeholder="Opened to…" min={fromDate || undefined} />
        {(status || riskLevel || fromDate || toDate) && (
          <button className="btn ghost sm" onClick={() => { setStatus(""); setRiskLevel(""); setFromDate(""); setToDate(""); }}>Clear</button>
        )}
      </div>

      {error && <div className="notice" style={{ marginBottom: 14 }}>{error}</div>}

      <div className="card tbl-card tbl-card-fill">
        <div className="tbl-wrap tbl-scroll">
          <table className="tbl tbl-center">
            <thead>
              <tr>
                <th>Loan / Customer</th>
                <th>Status</th>
                <th className="num">Outstanding Principal</th>
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
                const margin = r.currentGoldValue - r.outstandingAmount;
                return (
                  <tr key={r.loanId}>
                    <td>
                      <a href={routeHref(`loan/${r.loanNumber}`)}>{r.loanNumber}</a>
                      <div style={{ fontSize: 11.5, color: "var(--muted)" }}>{r.customerName}</div>
                    </td>
                    <td>{r.status}</td>
                    <td className="num">{fmt(r.outstandingAmount)}</td>
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
