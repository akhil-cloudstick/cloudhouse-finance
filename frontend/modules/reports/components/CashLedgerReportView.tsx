"use client";

import { Fragment, useEffect, useMemo, useState } from "react";
import { TableCols } from "@/common/components/ui/TableCols";
import { BackLink } from "@/common/components/ui/BackLink";
import { FilterPanel, type FilterCategory, type FilterValue } from "@/common/components/ui/FilterPanel";
import { useToast } from "@/common/components/ToastProvider";
import { ApiError } from "@/common/services/httpClient";
import { fmt, fmtDate } from "@/common/utils/format";
import { singleFlight } from "@/common/utils/singleFlight";
import { useShowBranchFilter } from "@/common/hooks/use-branch-switch";
import { listActiveBranches } from "@/modules/branches/services/branchService";
import { type BranchView } from "@/modules/branches/types/branch-types";
import { listLoansPage } from "@/modules/loans/services/loanService";
import { ExportMenu, type ExportKind } from "@/modules/reports/components/ExportMenu";
import { exportReport, getCashLedger } from "@/modules/reports/services/reportsService";
import { type CashLedgerRow, type CashLedgerTotals, type ReportFilters } from "@/modules/reports/types/reports-types";

/* Cash Ledger — the main ledger's every cash movement for a period, oldest first: Date,
 * Particulars (the gold loan as "00144/26" — its number and the year it opened — blank for any
 * other movement), Debit (money out), Credit (money in) and the running Balance in hand. Each month
 * gets a heading and closes with a subtotal. Filters: date range, a whole month, one loan. */

// How many past months the Month filter offers.
const MONTH_CHOICES = 24;
// Ledger rows (entries and month totals) per page.
const PAGE_SIZE = 14;

type CashLedgerReportViewProps = { onBack: () => void };

export function CashLedgerReportView({ onBack }: CashLedgerReportViewProps) {
  const toast = useToast();
  const showBranchFilter = useShowBranchFilter();
  const [branches, setBranches] = useState<BranchView[]>([]);
  // Branch ids and loan numbers: one, or several comma-joined.
  const [branchId, setBranchId] = useState("");
  // Opens on the current month.
  const [month, setMonth] = useState(monthKey(new Date()));
  const [from, setFrom] = useState(monthRange(monthKey(new Date())).from);
  const [to, setTo] = useState(monthRange(monthKey(new Date())).to);
  const [loan, setLoan] = useState("");

  // What the server returned, and for which filters — loading until it matches the current ones.
  const [data, setData] = useState<{ key: string; rows: CashLedgerRow[]; totals: CashLedgerTotals | null; error: string } | null>(null);
  const [exporting, setExporting] = useState<ExportKind | null>(null);

  useEffect(() => {
    if (showBranchFilter) listActiveBranches().then(setBranches).catch(() => {});
  }, [showBranchFilter]);

  const filters: ReportFilters = useMemo(() => {
    const f: ReportFilters = { from, to };
    if (branchId) f.branchId = branchId;
    if (loan) f.loan = loan;
    return f;
  }, [from, to, branchId, loan]);

  const filtersKey = JSON.stringify(filters);
  useEffect(() => {
    let cancelled = false;
    getCashLedger(filters)
      .then((r) => { if (!cancelled) setData({ key: filtersKey, rows: r.rows ?? [], totals: r.totals, error: "" }); })
      .catch((e) => { if (!cancelled) setData({ key: filtersKey, rows: [], totals: null, error: e instanceof ApiError ? e.message : "Could not load the ledger." }); });
    return () => { cancelled = true; };
  }, [filters, filtersKey]);
  const loading = data?.key !== filtersKey;
  const rows = data?.rows ?? [];
  const totals = data?.totals ?? null;
  const error = data?.error ?? "";

  // The whole period arrives at once; it is shown PAGE_SIZE rows a page, back on page 1 whenever
  // the filters change.
  const [pageState, setPageState] = useState({ key: filtersKey, page: 1 });
  const totalPages = Math.max(1, Math.ceil(rows.length / PAGE_SIZE));
  const page = pageState.key === filtersKey ? Math.min(pageState.page, totalPages) : 1;
  const setPage = (p: number) => setPageState({ key: filtersKey, page: p });
  const pageRows = rows.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE);

  async function handleExport(format: ExportKind) { return singleFlight("reports:cash-ledger-export:" + format, async () => {
    setExporting(format);
    try {
      await exportReport("cash-ledger", format, filters);
    } catch (e) {
      toast(e instanceof ApiError ? e.message : "Export failed.");
    } finally {
      setExporting(null);
    }
  }); }

  // One grouped filter: Month, Loan, Date (and Branch where the business has several).
  const monthOptions = useMemo(() => {
    const now = new Date();
    return Array.from({ length: MONTH_CHOICES }, (_, i) => {
      const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
      return { value: monthKey(d), label: monthLabel(monthKey(d)) };
    });
  }, []);
  const filterCategories: FilterCategory[] = [
    // Month stays single-choice: it sets the date range, and two months can't be one range.
    { key: "month", label: "Month", kind: "static", singleSelect: true, searchHint: "Searches: month name", options: monthOptions },
    {
      key: "loan", label: "Loan", kind: "async", searchHint: "Searches: loan number, customer name",
      fetchOptions: async (search, page) => {
        const r = await listLoansPage({ q: search || undefined, page, limit: 20 });
        return { items: r.items.map((l) => ({ value: l.loanNumber, label: `${loanParticulars(l.loanNumber, l.opened)} — ${l.customerName}` })), hasMore: r.hasMore };
      },
    },
    ...(!showBranchFilter ? [] : [{ key: "branch", label: "Branch", kind: "static" as const, searchHint: "Searches: branch name", options: branches.map((b) => ({ value: String(b.id), label: b.name })) }]),
    { key: "__date", label: "Date", kind: "date" },
  ];
  const filterValue: FilterValue = {
    month: month ? [month] : [],
    loan: loan ? loan.split(",") : [],
    branch: branchId ? branchId.split(",") : [],
    __dateFrom: from || undefined,
    __dateTo: to || undefined,
  };
  function onFilterChange(next: FilterValue) {
    const pickedMonth = Array.isArray(next.month) && next.month[0] ? next.month[0] : "";
    setLoan(Array.isArray(next.loan) ? next.loan.join(",") : "");
    setBranchId(Array.isArray(next.branch) ? next.branch.join(",") : "");
    if (pickedMonth && pickedMonth !== month) {
      // A month sets the date range to that month.
      const r = monthRange(pickedMonth);
      setMonth(pickedMonth);
      setFrom(r.from);
      setTo(r.to);
      return;
    }
    const nextFrom = next.__dateFrom || "";
    const nextTo = next.__dateTo || "";
    // A date range of its own replaces the month (unless it still is exactly that month).
    const r = pickedMonth ? monthRange(pickedMonth) : null;
    setMonth(r && r.from === nextFrom && r.to === nextTo ? pickedMonth : "");
    setFrom(nextFrom);
    setTo(nextTo);
  }

  return (
    <>
      <div className="page-h">
        <div>
          <BackLink onClick={onBack} label="Back to Reports" />
          <h1>Cash Ledger</h1>
          <p>Every cash movement by date, loan-wise, with the running balance and month totals.</p>
        </div>
      </div>
      <hr className="gold-rule" />

      <div className="card tbl-card tbl-card-fill">
        <div className="hd" style={{ flexWrap: "wrap", rowGap: 10, gap: 12 }}>
          <h3>{month ? monthLabel(month) : periodLabel(from, to)}</h3>
          <div className="sp" />
          <FilterPanel categories={filterCategories} value={filterValue} onChange={onFilterChange} />
          <ExportMenu busy={exporting} onExport={handleExport} />
        </div>
        {error && <div className="notice" style={{ margin: 14 }}>{error}</div>}
        <div className="tbl-wrap tbl-scroll">
          <table className="tbl tbl-center ledger-amt ledger-nowrap">
            <TableCols widths={[16, 34, null, null, null]} />
            <thead><tr><th>Date</th><th>Particulars</th><th className="num">Debit</th><th className="num">Credit</th><th className="num">Balance</th></tr></thead>
            <tbody>
              {loading ? (
                <tr><td colSpan={5} className="empty">Loading ledger…</td></tr>
              ) : !totals ? null : (
                <>
                  {page === 1 && (
                    <tr style={{ fontWeight: 600 }}>
                      <td />
                      <td>Opening balance</td>
                      <td className="num" />
                      <td className="num" />
                      <td className="num">{fmt(totals.openingBalance)}</td>
                    </tr>
                  )}
                  {rows.length === 0 && <tr><td colSpan={5} className="empty">{loan ? "No entries for this loan in this period." : "No entries in this period."}</td></tr>}
                  {pageRows.map((r, i) => (
                    <Fragment key={`${r.month}-${(page - 1) * PAGE_SIZE + i}`}>
                      {/* A month's heading, repeated at the top of a page that continues it. */}
                      {(i === 0 || r.month !== pageRows[i - 1].month) && (
                        <tr><td colSpan={5} style={{ textAlign: "left", fontWeight: 700, color: "var(--brand)", background: "var(--brand-faint, rgba(0,0,0,.03))" }}>{monthLabel(r.month)}</td></tr>
                      )}
                      {r.total ? (
                        <tr style={{ fontWeight: 700 }}>
                          <td />
                          <td>{r.particulars}</td>
                          <td className="num" style={{ color: "var(--red)" }}>{fmt(r.debit)}</td>
                          <td className="num" style={{ color: "var(--green)" }}>{fmt(r.credit)}</td>
                          <td className="num">{fmt(r.balance)}</td>
                        </tr>
                      ) : (
                        <tr>
                          <td>{fmtDate(r.date)}</td>
                          <td>{r.particulars}</td>
                          <td className="num" style={r.debit ? { color: "var(--red)" } : undefined}>{r.debit ? fmt(r.debit) : "—"}</td>
                          <td className="num" style={r.credit ? { color: "var(--green)" } : undefined}>{r.credit ? fmt(r.credit) : "—"}</td>
                          <td className="num">{fmt(r.balance)}</td>
                        </tr>
                      )}
                    </Fragment>
                  ))}
                  {page === totalPages && (
                    <tr style={{ fontWeight: 700 }}>
                      <td />
                      <td>Closing balance</td>
                      <td className="num" style={{ color: "var(--red)" }}>{fmt(totals.totalDebit)}</td>
                      <td className="num" style={{ color: "var(--green)" }}>{fmt(totals.totalCredit)}</td>
                      <td className="num">{fmt(totals.closingBalance)}</td>
                    </tr>
                  )}
                </>
              )}
            </tbody>
          </table>
        </div>
        <div className="ft ft-static" style={{ display: "flex", alignItems: "center", gap: 10 }}>
          <button className="btn plain sm" disabled={page <= 1} onClick={() => setPage(Math.max(1, page - 1))}>‹ Prev</button>
          <span style={{ fontSize: 12.5 }}>Page {page} of {totalPages}</span>
          <button className="btn plain sm" disabled={page >= totalPages} onClick={() => setPage(Math.min(totalPages, page + 1))}>Next ›</button>
        </div>
      </div>
    </>
  );
}

// "2026-10" for the month a date falls in (local time, so the 1st never slips into the month before).
function monthKey(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
}

// "October 2026"
function monthLabel(key: string): string {
  const [y, m] = key.split("-").map(Number);
  return new Date(y, m - 1, 1).toLocaleDateString("en-IN", { month: "long", year: "numeric" });
}

// The month's first day to its last — or to today for the current month.
function monthRange(key: string): { from: string; to: string } {
  const [y, m] = key.split("-").map(Number);
  const last = new Date(y, m, 0).getDate();
  const now = new Date();
  const isCurrent = now.getFullYear() === y && now.getMonth() + 1 === m;
  const pad = (n: number) => String(n).padStart(2, "0");
  return { from: `${y}-${pad(m)}-01`, to: `${y}-${pad(m)}-${pad(isCurrent ? now.getDate() : last)}` };
}

function periodLabel(from: string, to: string): string {
  if (!from && !to) return "All entries";
  return `${from ? fmtDate(from) : "Start"} – ${to ? fmtDate(to) : "Today"}`;
}

// LN-00144 opened in 2026 → "00144/26", as the backend writes Particulars.
function loanParticulars(loanNumber: string, opened: string): string {
  const digits = loanNumber.replace(/^LN-/i, "");
  const year = opened ? opened.slice(2, 4) : "";
  return year ? `${digits}/${year}` : digits;
}
