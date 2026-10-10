"use client";

import { usePersistedState } from "@/common/hooks/use-persisted-state";
import { BackLink } from "@/common/components/ui/BackLink";
import { useCallback, useEffect, useState } from "react";
import { Icon } from "@/common/components/Icon";
import { useAuth } from "@/common/providers/AuthProvider";
import { fmt, fmtDate } from "@/common/utils/format";
import { ApiError } from "@/common/services/httpClient";
import { listCashMovementsPage, exportCashMovements } from "@/modules/cash/services/cashService";
import { type CashMovementCategory, type CashMovementView, type PartyTotals } from "@/modules/cash/types/cash-types";
import { getBranch } from "@/modules/branches/services/branchService";
import { type BranchView } from "@/modules/branches/types/branch-types";
import { goBack, routeHref } from "@/common/services/appRoutes";
import { listCustomersPage } from "@/modules/customers/services/customerService";
import { type CustomerView } from "@/modules/customers/types/customer-types";
import { FilterPanel, type FilterCategory, type FilterValue } from "@/common/components/ui/FilterPanel";
import { singleFlight } from "@/common/utils/singleFlight";
import { refTitleFor, refCellFor } from "@/modules/cash/utils/ledgerCells";
import { BillLink } from "@/modules/cash/components/BillLink";

const ZERO_TOTALS: PartyTotals = { totalIn: 0, totalOut: 0, net: 0, inCount: 0, outCount: 0 };
const PAGE_SIZE = 12;

const TRANSACTION_TYPE_OPTIONS = [
  { value: "loan", label: "Loan" },
  { value: "auction", label: "Auction" },
  { value: "collection", label: "Collection" },
  { value: "personal loan", label: "Personal Loan" },
  { value: "investment", label: "Investment" },
  { value: "expenses", label: "Expenses" },
];

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

type BranchLedgerPageProps = { id?: string };

/* Branch details + its full cash-movement ledger — its own routed page
 * (/ledger-branch/:id), opened from the Ledger link on a Branch Management row.
 * Mirrors PartyLedger.tsx's bank/customer drilldown, scoped by branch. */
export function BranchLedgerPage({ id }: BranchLedgerPageProps) {
  const { can } = useAuth();
  const canExport = can("Ledger_Export", "can_export_ledger");
  const branchId = Number(id);
  const [branch, setBranch] = useState<BranchView | null>(null);
  const [branchError, setBranchError] = useState("");
  useEffect(() => {
    if (!branchId) return;
    setBranch(null);
    setBranchError("");
    getBranch(branchId).then(setBranch).catch(() => setBranchError("Branch not found."));
  }, [branchId]);
  const [items, setItems] = useState<CashMovementView[]>([]);
  const [total, setTotal] = useState(0);
  const [totals, setTotals] = useState<PartyTotals>(ZERO_TOTALS);
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [exporting, setExporting] = useState(false);
  const [filters, setFilters] = usePersistedState<FilterValue>("branchledger:filters", {});

  const fromDate = filters.__dateFrom;
  const toDate = filters.__dateTo;
  const typeValues = Array.isArray(filters.type) ? filters.type : [];
  const customerValues = Array.isArray(filters.customer) ? filters.customer : [];

  useEffect(() => { setPage(1); }, [fromDate, toDate, filters.type, filters.customer]);

  const categories: FilterCategory[] = [
    { key: "type", label: "Transaction Type", kind: "static", options: TRANSACTION_TYPE_OPTIONS },
    {
      key: "customer",
      label: "Customer",
      kind: "async",
      searchHint: "Searches: customer name, customer code, phone",
      fetchOptions: (search, p) =>
        listCustomersPage(search, p, undefined, 20).then((res) => ({
          items: res.items.map((c: CustomerView) => ({ value: String(c.id), label: `${c.name} (${c.code})` })),
          hasMore: res.hasMore,
        })),
    },
    { key: "__date", label: "Date", kind: "date" },
  ];

  // Type and Customer (any number of each) are narrowed server-side, together
  // with the date range, over this branch's movements — the same filtered
  // query the main Ledger uses with this branch fixed.
  const refresh = useCallback(() => {
    if (!branchId) return;
    setLoading(true);
    listCashMovementsPage(page, PAGE_SIZE, {
      fromDate, toDate,
      branchIds: [String(branchId)],
      customerIds: customerValues.length ? customerValues : undefined,
      types: typeValues.length ? (typeValues as CashMovementCategory[]) : undefined,
    })
      .then(({ items, total, totalDebit, totalCredit }) => {
        setItems(items);
        setTotal(total);
        setTotals({ totalIn: totalCredit, totalOut: totalDebit, net: totalCredit - totalDebit, inCount: 0, outCount: 0 });
        setError("");
      })
      .catch((e) => {
        setItems([]);
        setError(e instanceof ApiError ? e.message : "Could not load this branch's ledger.");
      })
      .finally(() => setLoading(false));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [branchId, page, fromDate, toDate, JSON.stringify(typeValues), JSON.stringify(customerValues)]);

  useEffect(() => { refresh(); }, [refresh]);

  async function onExport() { return singleFlight("branch-ledger:export", async () => {
    setExporting(true);
    try {
      await exportCashMovements({
        fromDate, toDate,
        branchIds: [String(branchId)],
        customerIds: customerValues.length ? customerValues : undefined,
        types: typeValues.length ? (typeValues as CashMovementCategory[]) : undefined,
      });
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "Could not export the ledger.");
    } finally {
      setExporting(false);
    }
  }); }

  if (branchError) return <div className="notice">{branchError}</div>;
  if (!branchId) {
    return (
      <div className="notice">
        No branch selected. <a href={routeHref("branches")} onClick={(e) => { e.preventDefault(); goBack("branches"); }}>Back to Branch Management</a>
      </div>
    );
  }

  return (
    <>
      <div className="page-h">
        <div>
          <BackLink href={routeHref("branches")} onClick={() => goBack("branches")} />
          <h1>{branch ? `${branch.name} — Ledger` : "Loading…"}</h1>
          <p>Every cash movement recorded against this branch</p>
        </div>
      </div>
      <hr className="gold-rule" />

      {branch && (
        <div className="kpis" style={{ marginBottom: 16 }}>
          <div className="kpi"><div className="l">Net</div><div className="v">{fmt(totals.totalIn - totals.totalOut)}</div></div>
          <div className="kpi"><div className="l">Total Credit</div><div className="v">{fmt(totals.totalIn)}</div></div>
          <div className="kpi"><div className="l">Total Debit</div><div className="v">{fmt(totals.totalOut)}</div></div>
        </div>
      )}

      {error && <div className="notice" style={{ marginBottom: 14 }}>{error}</div>}

      <div className="card tbl-card tbl-card-fill">
        <div className="hd" style={{ flexWrap: "wrap", rowGap: 10 }}>
          <h3>Transactions</h3>
          <div className="sp" />
          <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
            <FilterPanel categories={categories} value={filters} onChange={setFilters} hideChips hideClearAll />
            {canExport && <button className="btn ghost sm" disabled={exporting} onClick={onExport}><Icon name="download" /> {exporting ? "Exporting…" : "Download"}</button>}
          </div>
        </div>
        <div className="tbl-wrap tbl-scroll">
          <table className="tbl tbl-center">
            <thead>
              <tr><th>Date</th><th>Ref No</th><th style={{ textAlign: "center" }}>Particulars</th><th className="num">Debit</th><th className="num">Credit</th><th className="num">Balance</th></tr>
            </thead>
            <tbody>
              {loading ? (
                <tr><td colSpan={6} className="empty compact">Loading…</td></tr>
              ) : items.length === 0 ? (
                <tr><td colSpan={6} className="empty compact">No ledger entries found.</td></tr>
              ) : (() => {
                const chronological = [...items].reverse();
                let running = 0;
                const withBalance = chronological.map((m) => {
                  if (m.type === "out") running -= m.amount; else running += m.amount;
                  return { m, balance: running };
                });
                return withBalance.reverse().map(({ m, balance }) => (
                  <tr key={m.id}>
                    <td>{fmtDate(m.d)}</td>
                    <td className="ledger-ref" title={refTitleFor(m)}>{refCellFor(m)}</td>
                    <td style={{ textAlign: "center" }}>{m.purpose || m.source || "—"}<BillLink url={m.receiptImage} title={m.purpose || m.source || "Entry"} /></td>
                    <td className="num" style={{ color: m.type === "out" ? "var(--red)" : undefined }}>{m.type === "out" ? fmt(m.amount) : "—"}</td>
                    <td className="num" style={{ color: m.type === "in" ? "var(--green)" : undefined }}>{m.type === "in" ? fmt(m.amount) : "—"}</td>
                    <td className="num">{fmt(balance)}</td>
                  </tr>
                ));
              })()}
            </tbody>
          </table>
        </div>
        <Pager page={page} total={total} pageSize={PAGE_SIZE} onChange={setPage} />
      </div>
    </>
  );
}
