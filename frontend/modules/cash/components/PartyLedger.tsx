"use client";

import { useCallback, useEffect, useState } from "react";
import { fmt } from "@/common/utils/format";
import { ApiError } from "@/common/services/httpClient";
import { DatePicker } from "@/common/components/ui/DatePicker";
import {
  listCashMovementsByBank,
  listCashMovementsByCustomer,
  exportPartyStatementByBank,
  exportPartyStatementByCustomer,
  PARTY_PAGE_SIZE,
  type CashMovementView,
  type PartyTotals,
} from "@/modules/cash/services/cashService";
import { getBank, type BackendBank } from "@/modules/banks/services/bankService";
import { getCustomer, type CustomerView } from "@/modules/customers/services/customerService";

const ZERO_TOTALS: PartyTotals = { totalIn: 0, totalOut: 0, net: 0, inCount: 0, outCount: 0 };

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

/* One bank's or one customer's full cash-movement history — drilled into
 * from a Cash & Expenses row (Cash.tsx's clickable bank/customer cells) or
 * reachable directly via #party-bank/:id / #party-customer/:id. Same
 * underlying query (ListCashMovementsByBank/Customer) also backs
 * CustomerDetail.tsx's own "Transactions" tab — one query, two entry
 * points, per the plan's design. */
export function PartyLedger({ kind, id }: { kind: "bank" | "customer"; id?: string }) {
  const numericId = Number(id);
  const [label, setLabel] = useState("");
  const [labelError, setLabelError] = useState("");
  const [items, setItems] = useState<CashMovementView[]>([]);
  const [total, setTotal] = useState(0);
  const [totals, setTotals] = useState<PartyTotals>(ZERO_TOTALS);
  const [page, setPage] = useState(1);
  const [fromDate, setFromDate] = useState("");
  const [toDate, setToDate] = useState("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [exporting, setExporting] = useState(false);

  useEffect(() => {
    if (!numericId) return;
    setLabel("");
    setLabelError("");
    if (kind === "bank") {
      getBank(numericId)
        .then((b: BackendBank) => setLabel(b.branch ? `${b.name} — ${b.branch}` : b.name))
        .catch(() => setLabelError("Bank not found."));
    } else {
      getCustomer(String(numericId))
        .then((c: CustomerView) => setLabel(`${c.name} (${c.code})`))
        .catch(() => setLabelError("Customer not found."));
    }
  }, [kind, numericId]);

  // Any filter change resets back to page 1.
  useEffect(() => { setPage(1); }, [fromDate, toDate]);

  const refresh = useCallback(() => {
    if (!numericId) return;
    setLoading(true);
    const range = { fromDate: fromDate || undefined, toDate: toDate || undefined };
    const call = kind === "bank" ? listCashMovementsByBank(numericId, page, range) : listCashMovementsByCustomer(numericId, page, range);
    call
      .then(({ items, total, totals }) => {
        setItems(items);
        setTotal(total);
        setTotals(totals);
        setError("");
      })
      .catch((e) => {
        setItems([]);
        setError(e instanceof ApiError ? e.message : "Could not load this ledger.");
      })
      .finally(() => setLoading(false));
  }, [kind, numericId, page, fromDate, toDate]);

  useEffect(() => { refresh(); }, [refresh]);

  async function onExport() {
    setExporting(true);
    try {
      const range = { fromDate: fromDate || undefined, toDate: toDate || undefined };
      if (kind === "bank") await exportPartyStatementByBank(numericId, range);
      else await exportPartyStatementByCustomer(numericId, range);
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "Could not export the statement.");
    } finally {
      setExporting(false);
    }
  }

  if (labelError) return <div className="notice">{labelError}</div>;

  return (
    <>
      <div className="page-h">
        <div>
          <a href="#cash" style={{ fontSize: 13 }}>← Back</a>
          <h1>{label || "Loading…"}</h1>
          <p>Every transaction ever recorded against this {kind === "bank" ? "bank" : "customer"}</p>
        </div>
        <div className="sp" />
        <button className="btn ghost" disabled={exporting} onClick={onExport}>{exporting ? "Exporting…" : "Export Statement"}</button>
      </div>
      <hr className="gold-rule" />

      <div className="kpis" style={{ marginBottom: 16 }}>
        <div className="kpi"><div className="l">Total In</div><div className="v">{fmt(totals.totalIn)}</div><div className="s">across {totals.inCount} txns</div></div>
        <div className="kpi"><div className="l">Total Out</div><div className="v">{fmt(totals.totalOut)}</div><div className="s">across {totals.outCount} txns</div></div>
        <div className="kpi"><div className="l">Net</div><div className="v">{fmt(totals.net)}</div></div>
      </div>

      {error && <div className="notice" style={{ marginBottom: 14 }}>{error}</div>}

      <div className="card tbl-card">
        <div className="hd" style={{ flexWrap: "wrap", rowGap: 10 }}>
          <h3>Transactions</h3>
          <div className="sp" />
          <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
            <DatePicker value={fromDate} onChange={setFromDate} placeholder="From…" max={toDate || undefined} />
            <DatePicker value={toDate} onChange={setToDate} placeholder="To…" min={fromDate || undefined} />
            {(fromDate || toDate) && (
              <button className="btn ghost sm" onClick={() => { setFromDate(""); setToDate(""); }}>Clear</button>
            )}
          </div>
        </div>
        <div className="tbl-wrap tbl-scroll">
          <table className="tbl">
            <thead>
              <tr><th>Date</th><th>Type</th><th>Mode</th><th>Purpose</th><th className="num">Amount</th><th>Branch</th></tr>
            </thead>
            <tbody>
              {loading ? (
                <tr><td colSpan={6} className="empty compact">Loading…</td></tr>
              ) : items.length === 0 ? (
                <tr><td colSpan={6} className="empty compact">No transactions found.</td></tr>
              ) : items.map((m) => (
                <tr key={m.id}>
                  <td>{m.d}</td>
                  <td>{m.type === "in" ? "In" : "Out"}</td>
                  <td>{m.mode || "—"}</td>
                  <td>{m.purpose || m.source || "—"}</td>
                  <td className="num">{fmt(m.amount)}</td>
                  <td>{m.branchName || "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <Pager page={page} total={total} pageSize={PARTY_PAGE_SIZE} onChange={setPage} />
      </div>
    </>
  );
}
