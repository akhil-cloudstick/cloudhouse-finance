"use client";

import { useEffect, useState } from "react";
import { fmt } from "@/product/utils/format";
import { useToast } from "@/product/components/Toast";
import { Icon } from "@/product/components/Icon";
import { ApiError } from "@/product/services/httpClient";
import {
  listCashMovementsPage,
  exportCashMovements,
  type CashMovementCategory,
  type CashMovementView,
} from "@/product/pages/cash/services/cashService";
import { listCustomersPage } from "@/product/pages/customers/services/customerService";
import { listActiveBranches, type BranchView } from "@/product/pages/branches/services/branchService";
import { FilterPanel, type FilterCategory, type FilterValue } from "@/product/components/ui/FilterPanel";
import { useExpenseCategoryIds } from "@/product/hooks/useExpenseCategoryIds";
import { particularsFor, loanNumberFor, refCellFor, modeCellFor } from "@/product/pages/cash/components/ledgerCells";

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

function Pager({ page, total, pageSize, onChange }: { page: number; total: number; pageSize: number; onChange: (p: number) => void }) {
  const totalPages = Math.max(1, Math.ceil(total / pageSize));
  return (
    <div className="ft ft-static" style={{ display: "flex", alignItems: "center", gap: 12, padding: "12px 14px" }}>
      <button className="btn plain" disabled={page <= 1} onClick={() => onChange(Math.max(1, page - 1))}>‹ Prev</button>
      <span style={{ fontSize: 13 }}>Page {page} of {totalPages}</span>
      <button className="btn plain" disabled={page >= totalPages} onClick={() => onChange(Math.min(totalPages, page + 1))}>Next ›</button>
    </div>
  );
}

function withRunningBalance(items: CashMovementView[]): { m: CashMovementView; balance: number }[] {
  const chronological = [...items].reverse();
  let running = 0;
  const withBalance = chronological.map((m) => {
    running += m.type === "out" ? m.amount : -m.amount;
    return { m, balance: running };
  });
  return withBalance.reverse();
}

/* Reports tile for previewing + downloading the ledger — Branch, Customer,
 * Type and Date are 4 independent, always-visible multi-select filter
 * sections (none gate one another the way the old single "Report Category"
 * did) driving one live paginated preview table, same shape/filters as
 * Cash.tsx's Ledger tab; Download always exports exactly what the preview
 * currently shows. With no filters selected the preview shows every entry —
 * that default view can't be closed away, only narrowed. */
export function LedgerExportView({ onBack }: { onBack: () => void }) {
  const toast = useToast();
  const [branches, setBranches] = useState<BranchView[]>([]);
  const [filters, setFilters] = useState<FilterValue>({});
  const [page, setPage] = useState(1);
  const [items, setItems] = useState<CashMovementView[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [exporting, setExporting] = useState(false);
  // Category name -> id, for the category-ledger links on expense rows.
  const categoryIds = useExpenseCategoryIds();

  useEffect(() => { listActiveBranches().then(setBranches).catch(() => {}); }, []);

  const branchIds = Array.isArray(filters.branch) ? filters.branch : [];
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
    { key: "branch", label: "Branch", kind: "static", options: branches.map((b) => ({ value: String(b.id), label: b.name })) },
    {
      key: "customer", label: "Customer", kind: "async",
      fetchOptions: (search, p) =>
        listCustomersPage(search, p, { branchIds: branchIds.length ? branchIds : undefined }, 20).then((res) => ({
          items: res.items.map((c) => ({ value: String(c.id), label: `${c.name} (${c.code})` })),
          hasMore: res.hasMore,
        })),
    },
    { key: "type", label: "Type", kind: "static", options: TRANSACTION_TYPE_OPTIONS },
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
        setError("");
      })
      .catch((e) => {
        setItems([]);
        setError(e instanceof ApiError ? e.message : "Could not load the ledger.");
      })
      .finally(() => setLoading(false));
  }, [JSON.stringify(branchIds), JSON.stringify(customerIds), JSON.stringify(types), fromDate, toDate, page]);

  async function onDownload(format: "pdf" | "xlsx") {
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
  }

  const rows = withRunningBalance(items);

  return (
    <>
      <div className="page-h">
        <div>
          <button className="btn plain sm" style={{ marginBottom: 6 }} onClick={onBack}>← Back to Reports</button>
          <h1>Ledger / Statement Export</h1>
          <p>Preview and download the ledger — narrow it by branch, customer, type or date</p>
        </div>
        <div className="sp" />
        <FilterPanel categories={categories} value={filters} onChange={setFilters} hideChips size="md" />
        <button className="btn ghost" disabled={exporting} onClick={() => onDownload("pdf")}>
          <Icon name="download" /> {exporting ? "Exporting…" : "Export PDF"}
        </button>
        <button className="btn" disabled={exporting} onClick={() => onDownload("xlsx")}>
          <Icon name="download" /> {exporting ? "Exporting…" : "Export Excel"}
        </button>
      </div>
      <hr className="gold-rule" />

      {error && <div className="notice" style={{ marginBottom: 14 }}>{error}</div>}

      <div className="card tbl-card tbl-card-fill">
        <div className="tbl-wrap tbl-scroll">
          <table className="tbl">
            <thead>
              <tr><th>Date</th><th>Ref No</th><th>Particulars</th><th>Mode</th><th className="num">Debit</th><th className="num">Credit</th><th className="num">Balance</th></tr>
            </thead>
            <tbody>
              {loading ? (
                <tr><td colSpan={7} className="empty compact">Loading…</td></tr>
              ) : rows.length === 0 ? (
                <tr><td colSpan={7} className="empty compact">No ledger entries found.</td></tr>
              ) : rows.map(({ m, balance }) => (
                <tr key={m.id}>
                  <td>{m.d}</td>
                  {/* Same clickable cells as Cash.tsx's Ledger tab (ledgerCells.tsx). */}
                  <td className="ledger-ref" title={loanNumberFor(m)}>{refCellFor(m)}</td>
                  <td>{particularsFor(m, categoryIds)}</td>
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
