"use client";

import { usePersistedState } from "@/common/hooks/use-persisted-state";
import { BackLink } from "@/common/components/ui/BackLink";
import { useEffect, useState } from "react";
import { fmt, fmtDate } from "@/common/utils/format";
import { useToast } from "@/common/components/ToastProvider";
import { Icon } from "@/common/components/Icon";
import { useAuth } from "@/common/providers/AuthProvider";
import { ApiError } from "@/common/services/httpClient";
import { listCashMovementsPage, exportCashMovements } from "@/modules/cash/services/cashService";
import { type CashMovementCategory, type CashMovementView } from "@/modules/cash/types/cash-types";
import { listCustomersPage } from "@/modules/customers/services/customerService";
import { listActiveBranches } from "@/modules/branches/services/branchService";
import { type BranchView } from "@/modules/branches/types/branch-types";
import { useShowBranch, useShowBranchFilter } from "@/common/hooks/use-branch-switch";
import { FilterPanel, type FilterCategory, type FilterValue } from "@/common/components/ui/FilterPanel";
import { useExpenseCategoryIds } from "@/common/hooks/use-expense-category-ids";
import { particularsFor, refTitleFor, refCellFor, modeCellFor } from "@/modules/cash/utils/ledgerCells";
import { BillLink } from "@/modules/cash/components/BillLink";
import { singleFlight } from "@/common/utils/singleFlight";

// Mirrors backend/internal/cash/repository.go's Category* constants.
const TRANSACTION_TYPE_OPTIONS = [
  { value: "loan", label: "Loan" },
  { value: "auction", label: "Auction" },
  { value: "collection", label: "Collection" },
  { value: "personal loan", label: "Personal Loan" },
  { value: "investment", label: "Investment" },
  { value: "expenses", label: "Expenses" },
];

const PAGE_SIZE = 15;

type PagerProps = { page: number; total: number; pageSize: number; onChange: (p: number) => void };

function Pager({ page, total, pageSize, onChange }: PagerProps) {
  const totalPages = Math.max(1, Math.ceil(total / pageSize));
  return (
    <div className="ft ft-static" style={{ display: "flex", alignItems: "center", gap: 12, padding: "12px 14px" }}>
      <button className="btn plain" disabled={page <= 1} onClick={() => onChange(Math.max(1, page - 1))}>‹ Prev</button>
      <span style={{ fontSize: 13 }}>Page {page} of {totalPages}</span>
      <button className="btn plain" disabled={page >= totalPages} onClick={() => onChange(Math.min(totalPages, page + 1))}>Next ›</button>
    </div>
  );
}

function withRunningBalance(items: CashMovementView[], topBalance: number): { m: CashMovementView; balance: number }[] {
  // Newest first; topBalance (from the server) is the balance after the first row.
  let running = topBalance;
  return items.map((m) => {
    const balance = running;
    running -= m.type === "out" ? -m.amount : m.amount;
    return { m, balance };
  });
}

type LedgerExportViewProps = { onBack: () => void };

/* Reports tile for previewing + downloading the ledger — Branch, Customer,
 * Type and Date are 4 independent, always-visible multi-select filter
 * sections (none gate one another the way the old single "Report Category"
 * did) driving one live paginated preview table, same shape/filters as
 * Cash.tsx's Ledger tab; Download always exports exactly what the preview
 * currently shows. With no filters selected the preview shows every entry —
 * that default view can't be closed away, only narrowed. */
export function LedgerExportView({ onBack }: LedgerExportViewProps) {
  const { can } = useAuth();
  const canExport = can("Ledger_Export", "can_export_ledger");
  const toast = useToast();
  const [branches, setBranches] = useState<BranchView[]>([]);
  // No branch filter in a single-branch business (every row is its one
  // branch) or while the global branch selector already scopes the page.
  const showBranchFilter = useShowBranchFilter();
  const showBranch = useShowBranch();
  const [filters, setFilters] = usePersistedState<FilterValue>("reports:ledger-filters", {});
  const [page, setPage] = useState(1);
  const [items, setItems] = useState<CashMovementView[]>([]);
  const [total, setTotal] = useState(0);
  const [pageBalance, setPageBalance] = useState(0);
  const [sums, setSums] = useState({ debit: 0, credit: 0 });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [exporting, setExporting] = useState(false);
  // Category name -> id, for the category-ledger links on expense rows.
  const categoryIds = useExpenseCategoryIds();

  useEffect(() => { listActiveBranches().then(setBranches).catch(() => {}); }, []);

  // Ignored while the Branch filter is hidden — a stale saved selection
  // would otherwise intersect the global branch to an empty page.
  const branchIds = showBranchFilter && Array.isArray(filters.branch) ? filters.branch : [];
  const customerIds = Array.isArray(filters.customer) ? filters.customer : [];
  const types = (Array.isArray(filters.type) ? filters.type : []) as CashMovementCategory[];
  const fromDate = filters.__dateFrom;
  const toDate = filters.__dateTo;

  useEffect(() => { setPage(1); }, [JSON.stringify(branchIds), JSON.stringify(customerIds), JSON.stringify(types), fromDate, toDate]);

  // Selecting one or more Branches narrows the Customer picker to customers
  // whose home branch is one of those (a customer belongs to exactly one
  // branch); a Customer already picked whose home branch isn't among the
  // selected Branches then matches no rows server-side — same
  // "customer has no account in that branch → nothing shown" rule this
  // filter is spec'd to enforce.
  const categories: FilterCategory[] = [
    ...(!showBranchFilter ? [] : [{ key: "branch", label: "Branch", kind: "static" as const, searchHint: "Searches: branch name", options: branches.map((b) => ({ value: String(b.id), label: b.name })) }]),
    {
      key: "customer", label: "Customer", kind: "async", searchHint: "Searches: customer name, customer code, phone",
      fetchOptions: (search, p) =>
        listCustomersPage(search, p, { branchIds: branchIds.length ? branchIds : undefined }, 20).then((res) => ({
          items: res.items.map((c) => ({ value: String(c.id), label: `${c.name} (${c.code})` })),
          hasMore: res.hasMore,
        })),
    },
    { key: "type", label: "Type", kind: "static", searchHint: "Searches: transaction type", options: TRANSACTION_TYPE_OPTIONS },
    { key: "__date", label: "Date", kind: "date" },
  ];

  useEffect(() => {
    setLoading(true);
    listCashMovementsPage(page, PAGE_SIZE, {
      fromDate,
      toDate,
      branchIds: branchIds.length ? branchIds : undefined,
      customerIds: customerIds.length ? customerIds : undefined,
      types: types.length ? types : undefined,
    })
      .then((r) => {
        setItems(r.items);
        setTotal(r.total);
        setPageBalance(r.pageBalance);
        setSums({ debit: r.totalDebit, credit: r.totalCredit });
        setError("");
      })
      .catch((e) => {
        setItems([]);
        setError(e instanceof ApiError ? e.message : "Could not load the ledger.");
      })
      .finally(() => setLoading(false));
  }, [JSON.stringify(branchIds), JSON.stringify(customerIds), JSON.stringify(types), fromDate, toDate, page]);

  async function onDownload(format: "pdf" | "xlsx") { return singleFlight("reports:ledger-export:"+format, async () => {
    setExporting(true);
    try {
      await exportCashMovements({
        fromDate,
        toDate,
        branchIds: branchIds.length ? branchIds : undefined,
        customerIds: customerIds.length ? customerIds : undefined,
        types: types.length ? types : undefined,
        format,
      });
    } catch (e) {
      toast(e instanceof ApiError ? e.message : "Export failed.");
    } finally {
      setExporting(false);
    }
  }); }

  const rows = withRunningBalance(items, pageBalance);

  return (
    <>
      <div className="page-h">
        <div>
          <BackLink onClick={onBack} label="Back to Reports" />
          <h1>Ledger Report</h1>
          <p>Preview and download the ledger — narrow it by {showBranch ? "branch, customer" : "customer"}, type or date</p>
        </div>
      </div>
      <hr className="gold-rule" />

      {error && <div className="notice" style={{ marginBottom: 14 }}>{error}</div>}

      <div className="kpis" style={{ marginBottom: 16 }}>
        <div className="kpi"><div className="l">Net</div><div className="v">{fmt(sums.credit - sums.debit)}</div></div>
        <div className="kpi"><div className="l">Total Credit</div><div className="v">{fmt(sums.credit)}</div></div>
        <div className="kpi"><div className="l">Total Debit</div><div className="v">{fmt(sums.debit)}</div></div>
      </div>

      <div className="card tbl-card tbl-card-fill">
        <div className="hd" style={{ flexWrap: "wrap", rowGap: 10 }}>
          <h3>Transactions</h3>
          <div className="sp" />
          <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
            <FilterPanel categories={categories} value={filters} onChange={setFilters} hideChips hideClearAll />
            {canExport && (
              <>
                <button className="btn ghost sm" disabled={exporting} onClick={() => onDownload("pdf")}>
                  <Icon name="download" /> {exporting ? "Exporting…" : "Export PDF"}
                </button>
                <button className="btn sm" disabled={exporting} onClick={() => onDownload("xlsx")}>
                  <Icon name="download" /> {exporting ? "Exporting…" : "Export Excel"}
                </button>
              </>
            )}
          </div>
        </div>
        <div className="tbl-wrap tbl-scroll">
          <table className="tbl tbl-center">
            <thead>
              <tr><th>Date</th><th>Ref No</th><th style={{ textAlign: "center" }}>Particulars</th><th>Mode</th><th className="num">Debit</th><th className="num">Credit</th><th className="num">Balance</th></tr>
            </thead>
            <tbody>
              {loading ? (
                <tr><td colSpan={7} className="empty compact">Loading…</td></tr>
              ) : rows.length === 0 ? (
                <tr><td colSpan={7} className="empty compact">No ledger entries found.</td></tr>
              ) : rows.map(({ m, balance }) => (
                <tr key={m.id}>
                  <td>{fmtDate(m.d)}</td>
                  {/* Same clickable cells as Cash.tsx's Ledger tab (ledgerCells.tsx). */}
                  <td className="ledger-ref" title={refTitleFor(m)}>{refCellFor(m, categoryIds)}</td>
                  <td style={{ textAlign: "center" }}>{particularsFor(m, categoryIds)}<BillLink url={m.receiptImage} title={m.purpose || m.source || "Entry"} /></td>
                  <td>{modeCellFor(m.mode)}</td>
                  <td className="num" style={{ color: m.type === "out" ? "var(--red)" : undefined }}>{m.type === "out" ? fmt(m.amount) : "—"}</td>
                  <td className="num" style={{ color: m.type === "in" ? "var(--green)" : undefined }}>{m.type === "in" ? fmt(m.amount) : "—"}</td>
                  <td className="num">{fmt(balance)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <Pager page={page} total={total} pageSize={PAGE_SIZE} onChange={setPage} />
      </div>
    </>
  );
}
