"use client";

import { useEffect, useMemo, useState } from "react";
import { Icon } from "@/product/components/Icon";
import { DatePicker } from "@/product/components/ui/DatePicker";
import { SearchableSelect } from "@/product/components/ui/SearchableSelect";
import { Select } from "@/product/components/ui/Select";
import { useToast } from "@/product/components/Toast";
import { ApiError } from "@/product/services/httpClient";
import { listActiveBranches, type BranchView } from "@/product/pages/branches/services/branchService";
import { useBranding } from "@/product/providers/BrandingProvider";
import { exportReport, type ReportFilters, type ReportKey, type ReportResult } from "@/product/pages/reports/services/reportsService";
import { useResponsivePageSize } from "@/product/utils/responsive";

export type ReportColumn<Row> = {
  key: string;
  label: string;
  numeric?: boolean;
  render: (row: Row) => React.ReactNode;
};

export type ReportTotalItem = { label: string; value: string };

/* One config object per report — the shared shape ReportView renders
 * against, so all 16 reports (Part B's endpoints) reuse this single
 * component instead of 16 bespoke ones (see plan Part C.2). */
export type ReportConfig<Row = any, Totals = any> = {
  id: string;
  title: string;
  description: string;
  icon: string;
  exportKey: ReportKey;
  fetchFn: (f: ReportFilters) => Promise<ReportResult<Row, Totals>>;
  columns: ReportColumn<Row>[];
  totals: (t: Totals) => ReportTotalItem[];
  rowKey: (row: Row) => string | number;
  // Extra filter beyond date range + branch — a single dropdown, either the
  // loan-status report's `status` param or communication-history's
  // `triggerType` param (reports.Handler's per-report extra query param).
  extraFilter?: {
    field: "status" | "triggerType";
    label: string;
    options: string[];
  };
  // Per-report override for the initial "From" date — every report defaults
  // to firstOfMonth() unless it supplies this (Form G is the only one that
  // does, and it renders via its own FormGReportView rather than this
  // generic ReportConfig path — kept here too in case a future tabular
  // report needs a non-default range). No other report passes this, so no
  // other report's default range changes.
  defaultFromFn?: () => string;
  // Set for the Personal Loans and Investments reports only — gates the
  // report card the same way Sidebar.tsx gates those pages' own nav
  // entries, so a business without the module doesn't see its reports
  // exist either (the backend refuses the API calls too — see
  // internal/reports/routes.go).
  tenantModule?: string;
};

const ALL_BRANCHES: BranchView = { id: 0, name: "All branches", code: "", address: "", phone: "", isActive: true };

function firstOfMonth(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-01`;
}
function today(): string {
  return new Date().toISOString().slice(0, 10);
}

export function ReportView({ config, onBack }: { config: ReportConfig; onBack: () => void }) {
  const pageSize = useResponsivePageSize(15, 15);
  const toast = useToast();
  const [branches, setBranches] = useState<BranchView[]>([]);
  // Single-branch business: no branch filter — every row is its one branch.
  const { singleBranch } = useBranding();
  const [branchId, setBranchId] = useState<number>(0);
  const [branchLabel, setBranchLabel] = useState("All branches");
  const [from, setFrom] = useState(config.defaultFromFn ? config.defaultFromFn() : firstOfMonth());
  const [to, setTo] = useState(today());
  const [extraValue, setExtraValue] = useState("");
  const [page, setPage] = useState(1);

  const [result, setResult] = useState<ReportResult<any, any> | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [exporting, setExporting] = useState<"xlsx" | "pdf" | null>(null);

  useEffect(() => {
    listActiveBranches().then(setBranches).catch(() => { });
  }, []);

  const filters: ReportFilters = useMemo(() => {
    const f: ReportFilters = { from, to, page, pageSize };
    if (branchId) f.branchId = branchId;
    if (config.extraFilter && extraValue) {
      if (config.extraFilter.field === "status") f.status = extraValue;
      else f.triggerType = extraValue;
    }
    return f;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [from, to, branchId, extraValue, page, pageSize, config.id]);

  // Reset to page 1 whenever a filter (other than page itself) changes.
  useEffect(() => { setPage(1); }, [from, to, branchId, extraValue, pageSize, config.id]);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    config.fetchFn(filters)
      .then((r) => { if (!cancelled) { setResult(r); setError(""); } })
      .catch((e) => { if (!cancelled) setError(e instanceof ApiError ? e.message : "Could not load report."); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filters]);

  async function searchBranchesFilter(q: string, _page: number): Promise<{ items: BranchView[]; hasMore: boolean }> {
    const query = q.trim().toLowerCase();
    const all = [ALL_BRANCHES, ...branches];
    const items = query ? all.filter((b) => b.name.toLowerCase().includes(query)) : all;
    return { items, hasMore: false };
  }

  async function handleExport(format: "xlsx" | "pdf") {
    setExporting(format);
    try {
      await exportReport(config.exportKey, format, filters);
    } catch (e) {
      toast(e instanceof ApiError ? e.message : "Export failed.");
    } finally {
      setExporting(null);
    }
  }

  const rows = result?.rows ?? [];
  const totalCount = result?.totalCount ?? 0;
  const totalPages = Math.max(1, Math.ceil(totalCount / pageSize));
  const totalsItems = result ? config.totals(result.totals) : [];

  return (
    <>
      <div className="page-h">
        <div>
          <button className="btn plain sm" style={{ marginBottom: 6 }} onClick={onBack}>
            ← Back to Reports
          </button>
          <h1>{config.title}</h1>
          <p>{config.description}</p>
        </div>
        <div className="sp" />
        <button className="btn ghost" disabled={exporting !== null} onClick={() => handleExport("xlsx")}>
          <Icon name="download" /> {exporting === "xlsx" ? "Exporting…" : "Export Excel"}
        </button>
        <button className="btn" disabled={exporting !== null} onClick={() => handleExport("pdf")}>
          <Icon name="download" /> {exporting === "pdf" ? "Exporting…" : "Export PDF"}
        </button>
      </div>
      <hr className="gold-rule" />

      {/* No wrapping .card here — the KPI totals and the filter row sit
       * directly on the page, on one line below the title: totals on the
       * left, filter fields on the right (justify-content:space-between
       * pins each group to its own edge rather than leaving them flush
       * together in the middle), instead of each getting its own full-
       * width block stacked one above the other. */}
      <div style={{ display: "flex", flexWrap: "wrap", alignItems: "flex-end", justifyContent: "space-between", gap: 4, marginBottom: 23 }}>
        {/* Plain flex, not `.kpis` (display:grid; repeat(auto-fill,213px))
         * — a grid with auto-fill track repetition has no well-defined
         * intrinsic size, so nested as a flex item here (every other
         * `.kpis` usage sits on its own full-width line instead) it
         * collapsed to a single column, stacking the two cards vertically
         * instead of grouping them side by side on the left. `.kpi` itself
         * (each card's own fixed 213×89px box, flex-shrink:0 so it never
         * shrinks below that regardless of context) is unaffected either
         * way. maxWidth:"100%" is what actually lets flexWrap do its job
         * once there isn't room for every card on one line — flex-wrap
         * only wraps a container's children once the container itself is
         * width-constrained; flexShrink:0 alone (refusing to shrink below
         * its natural, fully-unwrapped width) left this free to just grow
         * past the viewport with nothing to wrap against instead. */}
        {totalsItems.length > 0 && (
          <div className="report-kpis" style={{ display: "flex", flexWrap: "wrap", flexShrink: 0, maxWidth: "100%", gap: 4 }}>
            {totalsItems.map((t) => (
              <div className="kpi" key={t.label}>
                <div className="l">{t.label}</div>
                <div className="v">{t.value}</div>
              </div>
            ))}
          </div>
        )}
        {/* .report-filter-row scopes the DatePicker width override below —
         * DatePicker.tsx's own root carries a global `.dp-date{width:230px;
         * flex:0 0 230px}` that ignores whatever width this wrapper <div>
         * asks for, so reducing just the wrapper's width (Branch/extraFilter
         * below, plain SearchableSelect/Select, have no such override and
         * shrink correctly) left From/To exactly the same size. Every field
         * here is the same 150px now, and `gap` (a single value, so it's
         * necessarily identical between every adjacent pair) keeps them
         * evenly spaced regardless of how many are showing. */}
        <div className="report-filter-row" style={{ display: "flex", flexWrap: "wrap", gap: 4, marginLeft: "auto" }}>
          <div style={{ width: 150 }}>
            <label style={{ fontSize: 11.5, color: "var(--muted)", display: "block", marginBottom: 4 }}>From</label>
            <DatePicker value={from} onChange={setFrom} max={to} />
          </div>
          <div style={{ width: 150 }}>
            <label style={{ fontSize: 11.5, color: "var(--muted)", display: "block", marginBottom: 4 }}>To</label>
            <DatePicker value={to} onChange={setTo} min={from} />
          </div>
          {!singleBranch && (
          <div style={{ width: 150 }}>
            <label style={{ fontSize: 11.5, color: "var(--muted)", display: "block", marginBottom: 4 }}>Branch</label>
            <SearchableSelect<BranchView>
              value={branchLabel}
              onChange={(id, item) => { setBranchId(item.id); setBranchLabel(item.name); }}
              fetchFn={searchBranchesFilter}
              searchHint="Searches: branch name"
              getLabel={(b) => b.name}
              getId={(b) => String(b.id)}
              placeholder="Search branch…"
            />
          </div>
          )}
          {config.extraFilter && (
            <div style={{ width: 150 }}>
              <label style={{ fontSize: 11.5, color: "var(--muted)", display: "block", marginBottom: 4 }}>{config.extraFilter.label}</label>
              <Select
                options={[{ value: "", label: "All" }, ...config.extraFilter.options.map((o) => ({ value: o, label: o }))]}
                value={extraValue}
                onChange={setExtraValue}
              />
            </div>
          )}
        </div>
      </div>

      {error && <div className="notice" style={{ marginBottom: 4 }}>{error}</div>}

      <div className="card tbl-card tbl-card-fill">
        <div className="tbl-wrap">
          <table className="tbl">
            <thead>
              <tr>{config.columns.map((c) => <th key={c.key} className={c.numeric ? "num" : undefined}>{c.label}</th>)}</tr>
            </thead>
            <tbody>
              {loading ? (
                <tr><td colSpan={config.columns.length} className="empty">Loading report…</td></tr>
              ) : rows.length === 0 ? (
                <tr><td colSpan={config.columns.length} className="empty">No data for the selected filters.</td></tr>
              ) : rows.map((row, i) => (
                // Some reports' rowKey (e.g. interest-collection's
                // `loanId-paidOn`) isn't guaranteed unique — two rows for the
                // same loan can share a paidOn timestamp (interest and penal
                // applied in the same run). The row's own position within
                // the current page is always unique, so appending it here
                // guards every report's key, not just that one.
                <tr key={`${config.rowKey(row)}-${i}`}>
                  {config.columns.map((c) => (
                    <td key={c.key} className={c.numeric ? "num" : undefined}>{c.render(row)}</td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <div className="ft" style={{ display: "flex", alignItems: "center", gap: 4 }}>
          <button className="btn plain sm" disabled={page <= 1} onClick={() => setPage((p) => Math.max(1, p - 1))}>‹ Prev</button>
          <span style={{ fontSize: 12.5 }}>Page {page} of {totalPages}</span>
          <button className="btn plain sm" disabled={page >= totalPages} onClick={() => setPage((p) => Math.min(totalPages, p + 1))}>Next ›</button>
        </div>
      </div>
    </>
  );
}
