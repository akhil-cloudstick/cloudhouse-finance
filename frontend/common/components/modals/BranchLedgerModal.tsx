"use client";

import { useCallback, useEffect, useState } from "react";
import { useModal } from "@/common/components/Modal";
import { fmt } from "@/common/utils/format";
import { ApiError } from "@/common/services/httpClient";
import {
  listCashMovementsByBranch,
  exportPartyStatementByBranch,
  type CashMovementView,
  type PartyTotals,
} from "@/modules/cash/services/cashService";
import { type BranchView } from "@/modules/branches/services/branchService";
import { listCustomersPage, type CustomerView } from "@/modules/customers/services/customerService";
import { FilterPanel, type FilterCategory, type FilterValue } from "@/common/components/ui/FilterPanel";

const ZERO_TOTALS: PartyTotals = { totalIn: 0, totalOut: 0, net: 0, inCount: 0, outCount: 0 };
const PAGE_SIZE = 12;

const TRANSACTION_TYPE_OPTIONS = [
  { value: "loans", label: "Loans" },
  { value: "auction", label: "Auction" },
  { value: "personal loan", label: "Personal Loan" },
  { value: "investments", label: "Investments" },
  { value: "expenses", label: "Expenses" },
];

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

/* Branch details + its full cash-movement ledger, opened as a modal from a
 * row on the Branches list — mirrors PartyLedger.tsx's bank/customer
 * drilldown but scoped by branch and rendered in-modal instead of as its own
 * routed page, per this feature's plan. */
export function BranchLedgerModalContent({ branch }: { branch: BranchView }) {
  const { closeModal } = useModal();
  const [items, setItems] = useState<CashMovementView[]>([]);
  const [total, setTotal] = useState(0);
  const [totals, setTotals] = useState<PartyTotals>(ZERO_TOTALS);
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [exporting, setExporting] = useState(false);
  const [filters, setFilters] = useState<FilterValue>({});

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
      fetchOptions: (search, p) =>
        listCustomersPage(search, p, undefined, 20).then((res) => ({
          items: res.items.map((c: CustomerView) => ({ value: String(c.id), label: `${c.name} (${c.code})` })),
          hasMore: res.hasMore,
        })),
    },
    { key: "__date", label: "Date", kind: "date" },
  ];

  const refresh = useCallback(() => {
    setLoading(true);
    const range = { fromDate, toDate };
    listCashMovementsByBranch(branch.id, page, range, PAGE_SIZE)
      .then(({ items, total, totals }) => {
        // Type/Customer are applied client-side over the branch's page —
        // the backend branch-ledger endpoint filters by date server-side;
        // narrowing further by purpose/customer here keeps this modal
        // working even before those two dimensions are backend query
        // params, at the cost of a page occasionally reading lighter than
        // its own count once both filters are active.
        const filtered = items.filter((m) => {
          if (typeValues.length && !typeValues.some((t) => (m.purpose || "").toLowerCase().includes(t))) return false;
          if (customerValues.length && !(m.partyCustomerId && customerValues.includes(String(m.partyCustomerId)))) return false;
          return true;
        });
        setItems(filtered);
        setTotal(total);
        setTotals(totals);
        setError("");
      })
      .catch((e) => {
        setItems([]);
        setError(e instanceof ApiError ? e.message : "Could not load this branch's ledger.");
      })
      .finally(() => setLoading(false));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [branch.id, page, fromDate, toDate, JSON.stringify(typeValues), JSON.stringify(customerValues)]);

  useEffect(() => { refresh(); }, [refresh]);

  async function onExport() {
    setExporting(true);
    try {
      await exportPartyStatementByBranch(branch.id, { fromDate, toDate });
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "Could not export the ledger.");
    } finally {
      setExporting(false);
    }
  }

  return (
    <>
      <div className="hd"><h3>{branch.name} — Ledger</h3><button className="x" onClick={closeModal}>×</button></div>
      <div className="bd bd-scroll">
        <div className="kv" style={{ gridTemplateColumns: "1fr 1fr", marginBottom: 14 }}>
          <div className="i"><div className="k">Branch Code</div><div className="v">{branch.code || "—"}</div></div>
          <div className="i"><div className="k">Status</div><div className="v">{branch.isActive ? <span className="chip green">Active</span> : <span className="chip gray">Inactive</span>}</div></div>
          <div className="i"><div className="k">Address</div><div className="v">{branch.address || "—"}</div></div>
          <div className="i"><div className="k">Phone</div><div className="v">{branch.phone || "—"}</div></div>
        </div>

        {error && <div className="notice" style={{ marginBottom: 14 }}>{error}</div>}

        <div className="hd" style={{ flexWrap: "wrap", rowGap: 10, columnGap: 16, padding: "0 0 14px", justifyContent: "flex-end" }}>
          <FilterPanel categories={categories} value={filters} onChange={setFilters} />
          <button className="btn ghost sm" disabled={exporting} onClick={onExport}>{exporting ? "Exporting…" : "Download"}</button>
        </div>

        <div className="tbl-wrap tbl-scroll">
          <table className="tbl">
            <thead>
              <tr><th>Date</th><th>Ref No</th><th>Particulars</th><th className="num">Debit</th><th className="num">Credit</th><th className="num">Balance</th></tr>
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
                  if (m.type === "out") running += m.amount; else running -= m.amount;
                  return { m, balance: running };
                });
                return withBalance.reverse().map(({ m, balance }) => (
                  <tr key={m.id}>
                    <td>{m.d}</td>
                    <td className="ledger-ref" title={String(m.transactionGroupId || m.id)}>{m.transactionGroupId || m.id}</td>
                    <td>{m.purpose || m.source || "—"}</td>
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
        <div style={{ height: 10 }} />
      </div>
    </>
  );
}
