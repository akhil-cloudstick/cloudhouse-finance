"use client";

import { useEffect, useMemo, useState } from "react";
import { TableCols } from "@/common/components/ui/TableCols";
import { BackLink } from "@/common/components/ui/BackLink";
import { FilterPanel, type FilterCategory, type FilterValue } from "@/common/components/ui/FilterPanel";
import { Icon } from "@/common/components/Icon";
import { useModal } from "@/common/components/ModalProvider";
import { useToast } from "@/common/components/ToastProvider";
import { ConfirmModalContent } from "@/common/components/modals/ConfirmModalContent";
import { ApiError } from "@/common/services/httpClient";
import { fmt, fmtDate } from "@/common/utils/format";
import { singleFlight } from "@/common/utils/singleFlight";
import { useShowBranchFilter } from "@/common/hooks/use-branch-switch";
import { listActiveBranches } from "@/modules/branches/services/branchService";
import { type BranchView } from "@/modules/branches/types/branch-types";
import { ExportMenu, type ExportKind } from "@/modules/reports/components/ExportMenu";
import { DayBookEntryModalContent } from "@/modules/reports/components/DayBookEntryModalContent";
import { deleteDayBookEntry, exportReport, getDayBook } from "@/modules/reports/services/reportsService";
import { type DayBookRow, type DayBookTotals, type ReportFilters } from "@/modules/reports/types/reports-types";

/* Day Book — lines staff record by hand (Date, Particulars, Debit, Credit, Interest), oldest
 * first, with the period's totals. Nothing is pulled in from the other modules: every line is
 * added here (or from the dashboard's Quick actions) through DayBookEntryModalContent.
 * Filters: a whole month, a date range, and the branch where the business has several. */

// How many past months the Month filter offers.
const MONTH_CHOICES = 24;
// Entries per page.
const PAGE_SIZE = 14;

type DayBookReportViewProps = { onBack: () => void };

export function DayBookReportView({ onBack }: DayBookReportViewProps) {
  const toast = useToast();
  const { openModal } = useModal();
  const showBranchFilter = useShowBranchFilter();
  const [branches, setBranches] = useState<BranchView[]>([]);
  // Branch ids: one, or several comma-joined.
  const [branchId, setBranchId] = useState("");
  // Opens on the current month.
  const [month, setMonth] = useState(monthKey(new Date()));
  const [from, setFrom] = useState(monthRange(monthKey(new Date())).from);
  const [to, setTo] = useState(monthRange(monthKey(new Date())).to);
  // Bumped after an add / edit / delete so the list reloads.
  const [version, setVersion] = useState(0);
  const reload = () => setVersion((v) => v + 1);

  // What the server returned, and for which filters — loading until it matches the current ones.
  const [data, setData] = useState<{ key: string; rows: DayBookRow[]; totals: DayBookTotals | null; error: string } | null>(null);
  const [exporting, setExporting] = useState<ExportKind | null>(null);

  useEffect(() => {
    if (showBranchFilter) listActiveBranches().then(setBranches).catch(() => {});
  }, [showBranchFilter]);

  const filters: ReportFilters = useMemo(() => {
    const f: ReportFilters = { from, to };
    if (branchId) f.branchId = branchId;
    return f;
  }, [from, to, branchId]);

  const filtersKey = JSON.stringify(filters);
  const loadKey = `${filtersKey}#${version}`;
  useEffect(() => {
    let cancelled = false;
    getDayBook(filters)
      .then((r) => { if (!cancelled) setData({ key: loadKey, rows: r.rows ?? [], totals: r.totals, error: "" }); })
      .catch((e) => { if (!cancelled) setData({ key: loadKey, rows: [], totals: null, error: e instanceof ApiError ? e.message : "Could not load the day book." }); });
    return () => { cancelled = true; };
  }, [filters, loadKey]);
  // After a reload the previous rows stay on screen until the new ones arrive.
  const loading = !data || !data.key.startsWith(`${filtersKey}#`);
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

  async function handleExport(format: ExportKind) { return singleFlight("reports:day-book-export:" + format, async () => {
    setExporting(format);
    try {
      await exportReport("day-book", format, filters);
    } catch (e) {
      toast(e instanceof ApiError ? e.message : "Export failed.");
    } finally {
      setExporting(null);
    }
  }); }

  function onDelete(r: DayBookRow) {
    openModal(
      <ConfirmModalContent
        title="Delete Day Book Entry"
        message={<>Delete <b>{r.particulars}</b> dated <b>{fmtDate(r.date)}</b>?</>}
        confirmLabel="Delete"
        busyLabel="Deleting…"
        onConfirm={async () => {
          await deleteDayBookEntry(r.id);
          reload();
          toast("Day book entry deleted");
        }}
      />,
    );
  }

  // One grouped filter: Month, Date (and Branch where the business has several).
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
    ...(!showBranchFilter ? [] : [{ key: "branch", label: "Branch", kind: "static" as const, searchHint: "Searches: branch name", options: branches.map((b) => ({ value: String(b.id), label: b.name })) }]),
    { key: "__date", label: "Date", kind: "date" },
  ];
  const filterValue: FilterValue = {
    month: month ? [month] : [],
    branch: branchId ? branchId.split(",") : [],
    __dateFrom: from || undefined,
    __dateTo: to || undefined,
  };
  function onFilterChange(next: FilterValue) {
    const pickedMonth = Array.isArray(next.month) && next.month[0] ? next.month[0] : "";
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
          <h1>Day Book</h1>
          <p>Record each entry by hand — date, particulars, debit, credit and interest.</p>
        </div>
        <div className="sp" />
        <button className="btn" onClick={() => openModal(<DayBookEntryModalContent onSaved={reload} />)}><Icon name="plus" /> Add Entry</button>
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
            <TableCols widths={[14, 34, null, null, null, 10]} />
            <thead><tr><th>Date</th><th>Particulars</th><th className="num">Debit</th><th className="num">Credit</th><th className="num">Interest</th><th></th></tr></thead>
            <tbody>
              {loading ? (
                <tr><td colSpan={6} className="empty">Loading day book…</td></tr>
              ) : rows.length === 0 ? (
                error ? null : <tr><td colSpan={6} className="empty">No entries in this period — use Add Entry to record one.</td></tr>
              ) : (
                <>
                  {pageRows.map((r) => (
                    <tr key={r.id}>
                      <td>{fmtDate(r.date)}</td>
                      <td>{r.particulars}</td>
                      <td className="num" style={r.debit ? { color: "var(--red)" } : undefined}>{r.debit ? fmt(r.debit) : "—"}</td>
                      <td className="num" style={r.credit ? { color: "var(--green)" } : undefined}>{r.credit ? fmt(r.credit) : "—"}</td>
                      <td className="num">{r.interest ? fmt(r.interest) : "—"}</td>
                      <td className="tbl-acts">
                        <button type="button" className="tbl-ibtn" title="Edit entry" aria-label={`Edit ${r.particulars}`}
                          onClick={() => openModal(<DayBookEntryModalContent entry={r} onSaved={reload} />)}>
                          <Icon name="edit" />
                        </button>
                        <button type="button" className="tbl-ibtn danger" title="Delete entry" aria-label={`Delete ${r.particulars}`}
                          onClick={() => onDelete(r)}>
                          <Icon name="trash" />
                        </button>
                      </td>
                    </tr>
                  ))}
                  {page === totalPages && totals && (
                    <tr style={{ fontWeight: 700 }}>
                      <td />
                      <td>Total</td>
                      <td className="num" style={{ color: "var(--red)" }}>{fmt(totals.debit)}</td>
                      <td className="num" style={{ color: "var(--green)" }}>{fmt(totals.credit)}</td>
                      <td className="num">{fmt(totals.interest)}</td>
                      <td />
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
