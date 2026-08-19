"use client";

import { useEffect, useMemo, useState } from "react";
import { Icon } from "@/common/components/Icon";
import { DatePicker } from "@/common/components/ui/DatePicker";
import { SearchableSelect } from "@/common/components/ui/SearchableSelect";
import { Select } from "@/common/components/ui/Select";
import { useToast } from "@/common/components/Toast";
import { ApiError } from "@/common/services/httpClient";
import { listActiveBranches, type BranchView } from "@/modules/branches/services/branchService";
import { exportReport, type ReportFilters, type ReportKey, type ReportResult } from "@/modules/reports/services/reportsService";

const PAGE_SIZE = 10;

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
  const toast = useToast();
  const [branches, setBranches] = useState<BranchView[]>([]);
  const [branchId, setBranchId] = useState<number>(0);
  const [branchLabel, setBranchLabel] = useState("All branches");
  const [from, setFrom] = useState(firstOfMonth());
  const [to, setTo] = useState(today());
  const [extraValue, setExtraValue] = useState("");
  const [page, setPage] = useState(1);

  const [result, setResult] = useState<ReportResult<any, any> | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [exporting, setExporting] = useState<"xlsx" | "pdf" | null>(null);

  useEffect(() => {
    listActiveBranches().then(setBranches).catch(() => {});
  }, []);

  const filters: ReportFilters = useMemo(() => {
    const f: ReportFilters = { from, to, page, pageSize: PAGE_SIZE };
    if (branchId) f.branchId = branchId;
    if (config.extraFilter && extraValue) {
      if (config.extraFilter.field === "status") f.status = extraValue;
      else f.triggerType = extraValue;
    }
    return f;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [from, to, branchId, extraValue, page, config.id]);

  // Reset to page 1 whenever a filter (other than page itself) changes.
  useEffect(() => { setPage(1); }, [from, to, branchId, extraValue, config.id]);

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
  const totalPages = Math.max(1, Math.ceil(totalCount / PAGE_SIZE));
  const totalsItems = result ? config.totals(result.totals) : [];

  return (
    <div>
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
          <Icon name="doc" /> {exporting === "xlsx" ? "Exporting…" : "Export Excel"}
        </button>
        <button className="btn" disabled={exporting !== null} onClick={() => handleExport("pdf")}>
          <Icon name="doc" /> {exporting === "pdf" ? "Exporting…" : "Export PDF"}
        </button>
      </div>
      <hr className="gold-rule" />

      <div className="card" style={{ marginBottom: 18 }}>
        <div className="hd" style={{ flexWrap: "wrap", gap: 10 }}>
          <div style={{ width: 160 }}>
            <label style={{ fontSize: 11.5, color: "var(--muted)", display: "block", marginBottom: 4 }}>From</label>
            <DatePicker value={from} onChange={setFrom} max={to} />
          </div>
          <div style={{ width: 160 }}>
            <label style={{ fontSize: 11.5, color: "var(--muted)", display: "block", marginBottom: 4 }}>To</label>
            <DatePicker value={to} onChange={setTo} min={from} />
          </div>
          <div style={{ width: 200 }}>
            <label style={{ fontSize: 11.5, color: "var(--muted)", display: "block", marginBottom: 4 }}>Branch</label>
            <SearchableSelect<BranchView>
              value={branchLabel}
              onChange={(id, item) => { setBranchId(item.id); setBranchLabel(item.name); }}
              fetchFn={searchBranchesFilter}
              getLabel={(b) => b.name}
              getId={(b) => String(b.id)}
              placeholder="Search branch…"
            />
          </div>
          {config.extraFilter && (
            <div style={{ width: 180 }}>
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

      {totalsItems.length > 0 && (
        <div className="kpis" style={{ marginBottom: 18 }}>
          {totalsItems.map((t) => (
            <div className="kpi" key={t.label}>
              <div className="l">{t.label}</div>
              <div className="v">{t.value}</div>
            </div>
          ))}
        </div>
      )}

      {error && <div className="notice" style={{ marginBottom: 14 }}>{error}</div>}

      <div className="card">
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
              ) : rows.map((row) => (
                <tr key={config.rowKey(row)}>
                  {config.columns.map((c) => (
                    <td key={c.key} className={c.numeric ? "num" : undefined}>{c.render(row)}</td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <div className="ft" style={{ display: "flex", alignItems: "center", gap: 10 }}>
          <button className="btn plain sm" disabled={page <= 1} onClick={() => setPage((p) => Math.max(1, p - 1))}>‹ Prev</button>
          <span style={{ fontSize: 12.5 }}>Page {page} of {totalPages}</span>
          <button className="btn plain sm" disabled={page >= totalPages} onClick={() => setPage((p) => Math.min(totalPages, p + 1))}>Next ›</button>
          <div className="sp" />
          <span>{totalCount} row{totalCount === 1 ? "" : "s"} total</span>
        </div>
      </div>
    </div>
  );
}
