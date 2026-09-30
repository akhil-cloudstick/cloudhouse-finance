"use client";

import { useEffect, useMemo, useState } from "react";
import { Icon } from "@/common/components/Icon";
import { DatePicker } from "@/common/components/ui/DatePicker";
import { SearchableSelect } from "@/common/components/ui/SearchableSelect";
import { Select } from "@/common/components/ui/Select";
import { useToast } from "@/common/components/Toast";
import { ApiError } from "@/common/services/httpClient";
import { listActiveBranches, type BranchView } from "@/modules/branches/services/branchService";
import {
  exportFormG, getFormG,
  type FormGOverrides, type FormGStatement, type ReportFilters,
} from "@/modules/reports/services/reportsService";

const ALL_BRANCHES: BranchView = { id: 0, name: "All branches", code: "", address: "", phone: "", isActive: true };

const dt = (v?: string | null) => (v ? new Date(v).toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" }) : "—");
const fmt = (n: number) => n.toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

/* Form G (Kerala Money-Lenders Rules 1964, Rule 15(3)) is a fixed-layout
 * statutory statement — header particulars, two 4-row loan-movement
 * tables, a deposits block, a financial-position block, and a blank
 * declaration — not a flat repeated-row listing like every other report,
 * so it doesn't fit ReportView's generic column-table rendering. This
 * component is its own view, reusing ReportView's From/To/Branch filter
 * chrome (same DatePicker/SearchableSelect widgets, same layout) rather
 * than duplicating that plumbing, but rendering the sectioned statement
 * below instead of a <table> of rows.
 *
 * Section 3 (deposits) and the assets/liabilities lines of Section 4 have
 * no source ledger in this system (see backend/internal/reports/formg.go's
 * FormGOverrides doc comment) — they're rendered here as plain editable
 * number inputs, seeded at 0, and sent to the export endpoint as query-
 * string overrides only when the user clicks Export. They are NOT saved
 * anywhere; reloading this view (or changing the date/branch filter) resets
 * them back to 0, since there is nowhere to persist them yet.
 */
export function FormGReportView({ onBack }: { onBack: () => void }) {
  const toast = useToast();
  const [branches, setBranches] = useState<BranchView[]>([]);
  const [branchId, setBranchId] = useState<number>(0);
  const [branchLabel, setBranchLabel] = useState("All branches");
  // Default range is the LAST 3 MONTHS, not the firstOfMonth()/today() every
  // other report defaults to — per the client's requirement for this one
  // report only (see subMonths below).
  const [from, setFrom] = useState(subMonths(today(), 3));
  const [to, setTo] = useState(today());

  const [stmt, setStmt] = useState<FormGStatement | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [exporting, setExporting] = useState<"xlsx" | "pdf" | null>(null);

  const [overrides, setOverrides] = useState<FormGOverrides>({});

  useEffect(() => {
    listActiveBranches().then(setBranches).catch(() => { });
  }, []);

  const filters: ReportFilters = useMemo(() => {
    const f: ReportFilters = { from, to };
    if (branchId) f.branchId = branchId;
    return f;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [from, to, branchId]);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    getFormG(filters)
      .then((r) => { if (!cancelled) { setStmt(r); setError(""); setOverrides({}); } })
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
      await exportFormG(format, filters, overrides);
    } catch (e) {
      toast(e instanceof ApiError ? e.message : "Export failed.");
    } finally {
      setExporting(null);
    }
  }

  function setOverride(key: keyof FormGOverrides, value: string) {
    const n = value === "" ? undefined : Number(value);
    setOverrides((prev) => ({ ...prev, [key]: n }));
  }

  // Live-recomputed excess assets/liabilities off whatever the user has
  // typed so far, purely for on-screen display — the export endpoint does
  // this same computation server-side once it has the overrides.
  const assets = overrides.assetsValue ?? 0;
  const liabilities = overrides.liabilitiesValue ?? 0;
  const excessAssets = Math.max(0, assets - liabilities);
  const excessLiabilities = Math.max(0, liabilities - assets);

  return (
    <div>
      <div className="page-h">
        <div>
          <button className="btn plain sm" style={{ marginBottom: 6 }} onClick={onBack}>
            ← Back to Reports
          </button>
          <h1>Form G — Statement of Accounts</h1>
          <p>Kerala Money-Lenders Rules, 1964 — Rule 15(3)</p>
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

      {/* report-filter-row is what actually narrows DatePicker down to
       * 150px — its own root otherwise carries a global `.dp-date{width:
       * 230px}` that ignores this wrapper's width, same as ReportView.tsx's
       * own filter row (see that file's comment on the same class). */}
      <div className="report-filter-row" style={{ display: "flex", flexWrap: "wrap", gap: 50, marginBottom: 18, justifyContent: "flex-end", alignItems: "flex-end" }}>
        <div style={{ width: 170 }}>
          <label style={{ fontSize: 11.5, color: "var(--muted)", display: "block", marginBottom: 4 }}>Quick Range</label>
          {/* Sets From/To below and resets back to the placeholder — this is
           * a one-shot action, not a persisted filter value of its own, so
           * the date range it just set (visible in From/To) is what stays
           * on screen, not this dropdown's own selection. Current Quarter
           * runs from that calendar quarter's start up to TODAY (not the
           * quarter's end) since a statement can't show activity that
           * hasn't happened yet; Next Quarter, being entirely in the
           * future, uses its own full start-to-end range. */}
          <Select
            value=""
            onChange={(v) => {
              const now = new Date();
              if (v === "last3") {
                setFrom(subMonths(today(), 3));
                setTo(today());
              } else if (v === "current") {
                setFrom(toISO(quarterStart(now)));
                setTo(today());
              } else if (v === "next") {
                const nextStart = new Date(quarterStart(now).getFullYear(), quarterStart(now).getMonth() + 3, 1);
                setFrom(toISO(nextStart));
                setTo(toISO(quarterEnd(nextStart)));
              }
            }}
            placeholder="Choose a range…"
            options={[
              { value: "last3", label: "Last 3 Months" },
              { value: "current", label: "Current Quarter" },
              { value: "next", label: "Next Quarter" },
            ]}
          />
        </div>
        <div style={{ width: 150 }}>
          <label style={{ fontSize: 11.5, color: "var(--muted)", display: "block", marginBottom: 4 }}>From</label>
          <DatePicker value={from} onChange={setFrom} max={to} />
        </div>
        <div style={{ width: 150 }}>
          <label style={{ fontSize: 11.5, color: "var(--muted)", display: "block", marginBottom: 4 }}>To</label>
          <DatePicker value={to} onChange={setTo} min={from} />
        </div>
        <div style={{ width: 150 }}>
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
      </div>

      {error && <div className="notice" style={{ marginBottom: 14 }}>{error}</div>}
      {loading && <div className="card"><div style={{ padding: 20 }}>Loading statement…</div></div>}

      {!loading && stmt && (
        <div className="card" style={{ padding: 20, display: "flex", flexDirection: "column", gap: 22 }}>
          {/* Header particulars */}
          <div>
            <div><b>Reporting period:</b> {stmt.periodLabel}</div>
            <div><b>Name of money-lender:</b> {stmt.lenderName}</div>
            <div><b>Postal address:</b> {stmt.lenderAddress}</div>
            {stmt.branches.map((b) => (
              <div key={b.name}><b>Branch:</b> {b.name} — {b.address}</div>
            ))}
          </div>

          <LoanTable title="Section 1 — Particulars of Loans Advanced" rows={stmt.section1Advanced} />
          <LoanTable title="Section 2 — Particulars of Loans Redeemed / Received Back" rows={stmt.section2Redeemed} />

          {/* Section 3 — no deposit ledger exists in this system; every
           * field is a plain editable input, seeded at 0, sent to the
           * export endpoint only (see this file's top comment). */}
          <div>
            <h3 style={{ marginBottom: 8 }}>Section 3 — Particulars of Deposits Received</h3>
            <p style={{ fontSize: 12, color: "var(--muted)", marginBottom: 8 }}>
              This business takes no public deposits and there is no deposit ledger to auto-populate this
              section from — enter figures manually if applicable; they apply to the exported file only.
            </p>
            <div className="tbl-wrap">
              <table className="tbl">
                <thead><tr><th></th><th className="num">Count</th><th className="num">Amount (Rs.)</th></tr></thead>
                <tbody>
                  <OverrideRow label="Outstanding at beginning of period" countKey="depositOpeningCount" amountKey="depositOpeningAmount" overrides={overrides} setOverride={setOverride} />
                  <OverrideRow label="Received during period" countKey="depositDuringCount" amountKey="depositDuringAmount" overrides={overrides} setOverride={setOverride} />
                  <OverrideRow label="Repaid during period" countKey="depositRepaidCount" amountKey="depositRepaidAmount" overrides={overrides} setOverride={setOverride} />
                  <OverrideRow label="Outstanding at end of period" countKey="depositClosingCount" amountKey="depositClosingAmount" overrides={overrides} setOverride={setOverride} />
                </tbody>
              </table>
            </div>
          </div>

          {/* Section 4 — MaxOutstanding/date are computed server-side (see
           * formg.go); assets/liabilities have no balance-sheet source and
           * are the same kind of editable override as Section 3. */}
          <div>
            <h3 style={{ marginBottom: 8 }}>Section 4 — Financial Position</h3>
            <div className="tbl-wrap">
              <table className="tbl">
                <tbody>
                  <tr><td>Maximum amount outstanding on any day</td><td className="num">{fmt(stmt.section4FinancialPosition.maxOutstanding)}</td></tr>
                  <tr><td>Date on which maximum amount was outstanding</td><td className="num">{dt(stmt.section4FinancialPosition.maxOutstandingDate)}</td></tr>
                  <tr>
                    <td>Value of assets at end of period (manually entered)</td>
                    <td className="num"><NumInput value={overrides.assetsValue} onChange={(v) => setOverride("assetsValue", v)} /></td>
                  </tr>
                  <tr>
                    <td>Total liabilities outstanding at end of period (manually entered)</td>
                    <td className="num"><NumInput value={overrides.liabilitiesValue} onChange={(v) => setOverride("liabilitiesValue", v)} /></td>
                  </tr>
                  <tr><td>Excess of assets over liabilities</td><td className="num">{fmt(excessAssets)}</td></tr>
                  <tr><td>Excess of liabilities over assets</td><td className="num">{fmt(excessLiabilities)}</td></tr>
                </tbody>
              </table>
            </div>
          </div>

          {/* Declaration — static boilerplate + blank signature lines, left
           * for manual completion in both the on-screen view and every
           * export, matching internal/loan/indemnitybond.go's own blank
           * Place/Date/Signature block. */}
          <div>
            <h3 style={{ marginBottom: 8 }}>Declaration</h3>
            <p style={{ fontSize: 13 }}>
              I hereby declare that the information furnished in the above statement is true and correct to the
              best of my knowledge and belief.
            </p>
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill,minmax(200px,1fr))", gap: 12, marginTop: 10, fontSize: 13 }}>
              <div>Place: ____________________</div>
              <div>Date: ____________________</div>
              <div>Name: ____________________</div>
              <div>Signature: ____________________</div>
              <div>Status (Proprietor/Partner/Manager): ____________________</div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function LoanTable({ title, rows }: { title: string; rows: FormGStatement["section1Advanced"] }) {
  return (
    <div>
      <h3 style={{ marginBottom: 8 }}>{title}</h3>
      <div className="tbl-wrap">
        <table className="tbl">
          <thead>
            <tr>
              <th>Nature/Name of Loan</th>
              <th className="num">No. of persons advanced to</th>
              <th className="num">Amount (Rs.)</th>
              <th>Remarks</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.label}>
                <td>{r.label}</td>
                <td className="num">{r.persons}</td>
                <td className="num">{fmt(r.amount)}</td>
                <td>{r.remarks || "—"}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function OverrideRow({
  label, countKey, amountKey, overrides, setOverride,
}: {
  label: string;
  countKey: keyof FormGOverrides;
  amountKey: keyof FormGOverrides;
  overrides: FormGOverrides;
  setOverride: (key: keyof FormGOverrides, value: string) => void;
}) {
  return (
    <tr>
      <td>{label}</td>
      <td className="num"><NumInput value={overrides[countKey]} onChange={(v) => setOverride(countKey, v)} /></td>
      <td className="num"><NumInput value={overrides[amountKey]} onChange={(v) => setOverride(amountKey, v)} /></td>
    </tr>
  );
}

// Section 3/4's figures are the only editable cells on this whole
// statement — everything else is a computed, read-only value straight
// from the ledger. A plain border matching the rest of the table's
// borders made an editable amount indistinguishable from a static one at
// a glance; the gold fill/border (the same accent this app already uses
// for focus/interactive affordances) marks it as "you can type here"
// without needing a separate legend.
function NumInput({ value, onChange }: { value?: number; onChange: (v: string) => void }) {
  return (
    <input
      type="number"
      value={value ?? ""}
      placeholder="0"
      onChange={(e) => onChange(e.target.value)}
      style={{
        width: 110,
        textAlign: "right",
        padding: "4px 6px",
        border: "1.5px solid var(--gold)",
        borderRadius: 4,
        background: "var(--gold-pale)",
        fontWeight: 600,
      }}
    />
  );
}

function today(): string {
  return new Date().toISOString().slice(0, 10);
}

/* subMonths(today(), 3) is Form G's own default "From" — the ONLY report
 * whose default range isn't firstOfMonth()/today() (see this file's top
 * comment); implemented locally rather than in Reports.tsx/ReportView.tsx
 * since this view doesn't go through ReportView's generic filter state. */
function subMonths(dateStr: string, months: number): string {
  const d = new Date(dateStr + "T00:00:00");
  d.setMonth(d.getMonth() - months);
  return d.toISOString().slice(0, 10);
}

function toISO(d: Date): string {
  return d.toISOString().slice(0, 10);
}

/* Calendar-quarter boundaries (Jan–Mar / Apr–Jun / Jul–Sep / Oct–Dec),
 * backing the Quick Range dropdown's "Current Quarter"/"Next Quarter"
 * presets. quarterStart floors to the quarter containing `d`; quarterEnd is
 * that quarter's last calendar day (day 0 of the month after it ends). */
function quarterStart(d: Date): Date {
  return new Date(d.getFullYear(), Math.floor(d.getMonth() / 3) * 3, 1);
}
function quarterEnd(d: Date): Date {
  const start = quarterStart(d);
  return new Date(start.getFullYear(), start.getMonth() + 3, 0);
}
