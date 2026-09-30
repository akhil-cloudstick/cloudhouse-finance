"use client";

import { useCallback, useEffect, useState } from "react";
import { fmt } from "@/product/utils/format";
import { Icon } from "@/product/components/Icon";
import { FooterTotals } from "@/product/components/ui/FooterTotals";
import { ApiError } from "@/product/services/httpClient";
import { DatePicker } from "@/product/components/ui/DatePicker";
import { LedgerRefLink, CategoryChip } from "@/product/components/ui/LedgerRefLink";
import { useExpenseCategoryIds } from "@/product/hooks/useExpenseCategoryIds";
import { routeHref } from "@/product/services/appRoutes";
import {
  listCashMovementsByCustomer,
  getBankLedger,
  getModeLedger,
  downloadLedger,
  PARTY_PAGE_SIZE,
  MODE_LEDGER_ROUTE,
  LEDGER_MODES,
  type LedgerMode,
  type LedgerRowView,
} from "@/product/pages/cash/services/cashService";
import { getBank, type BackendBank } from "@/product/pages/banks/services/bankService";
import { getCustomer, type CustomerView } from "@/product/pages/customers/services/customerService";

import { getExpenseCategoryLedger, EXPENSE_CATEGORY_LEDGER_PAGE_SIZE } from "@/product/pages/cash/services/expenseCategoryService";
import { FilterPanel, type FilterCategory, type FilterValue } from "@/product/components/ui/FilterPanel";

function Pager({ page, total, pageSize, onChange, children }: { page: number; total: number; pageSize: number; onChange: (p: number) => void; children?: React.ReactNode }) {
  const totalPages = Math.max(1, Math.ceil(total / pageSize));
  return (
    <div className="ft ft-static" style={{ display: "flex", alignItems: "center", gap: 12, padding: "12px 14px" }}>
      <button className="btn plain" disabled={page <= 1} onClick={() => onChange(Math.max(1, page - 1))}>‹ Prev</button>
      <span style={{ fontSize: 13 }}>Page {page} of {totalPages}</span>
      <button className="btn plain" disabled={page >= totalPages} onClick={() => onChange(Math.min(totalPages, page + 1))}>Next ›</button>
      {children}
    </div>
  );
}

/* One bank's or one customer's full cash-movement history — drilled into
 * from a Cash & Expenses row (Cash.tsx's clickable bank/customer cells) or
 * reachable directly via /ledger-bank/:id / /ledger-customer/:id. Same
 * underlying query (ListCashMovementsByBank/Customer) also backs
 * CustomerDetail.tsx's own "Transactions" tab — one query, two entry
 * points, per the plan's design. */
export function PartyLedger({ kind, id }: { kind: "bank" | "customer" | "category"; id?: string }) {
  const numericId = Number(id);
  const categoryIds = useExpenseCategoryIds();
  const [label, setLabel] = useState("");
  const [labelError, setLabelError] = useState("");
  const [items, setItems] = useState<LedgerRowView[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [fromDate, setFromDate] = useState("");
  const [toDate, setToDate] = useState("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [exporting, setExporting] = useState(false);
  const [totals, setTotals] = useState({ debit: 0, credit: 0 });
  // Mode filter — only offered on a bank's own ledger (UPI/Bank
  // Transfer/Cheque/Cash all pass through a bank); customer/category ledgers
  // don't get this, same "meaningless outside a bank ledger" reasoning as
  // ModeLedgerPage's own Bank filter being Cash-only-excluded.
  const [modeFilters, setModeFilters] = useState<FilterValue>({});
  const modeValues = (Array.isArray(modeFilters.mode) ? modeFilters.mode : []) as LedgerMode[];
  const modeFilterCategories: FilterCategory[] = [
    { key: "mode", label: "Mode", kind: "static", options: LEDGER_MODES.map((m) => ({ value: m, label: m })) },
  ];

  useEffect(() => {
    if (!numericId) return;
    setLabel("");
    setLabelError("");
    if (kind === "bank") {
      getBank(numericId)
        .then((b: BackendBank) => setLabel(b.branch ? `${b.name} — ${b.branch}` : b.name))
        .catch(() => setLabelError("Bank not found."));
    } else if (kind === "customer") {
      getCustomer(String(numericId))
        .then((c: CustomerView) => setLabel(`${c.name} (${c.code})`))
        .catch(() => setLabelError("Customer not found."));
    }
    // Category has no separate "get one" endpoint — its name comes back
    // alongside the first ledger page itself (see refresh()'s categoryName
    // handling below), so nothing to fetch here.
  }, [kind, numericId]);

  // Any filter change resets back to page 1.
  useEffect(() => { setPage(1); }, [fromDate, toDate, JSON.stringify(modeValues)]);

  // Only one Mode can meaningfully narrow a bank ledger to a single-source
  // query (getModeLedger) — with none or several checked, the ledger falls
  // back to the combined all-modes view (getBankLedger).
  const singleMode = kind === "bank" && modeValues.length === 1 ? modeValues[0] : undefined;

  const refresh = useCallback(() => {
    if (!numericId) return;
    setLoading(true);
    const range = { fromDate: fromDate || undefined, toDate: toDate || undefined };
    const call =
      singleMode ? getModeLedger(singleMode, page, { ...range, bankId: numericId }, PARTY_PAGE_SIZE)
      : kind === "bank" ? getBankLedger(numericId, page, range, PARTY_PAGE_SIZE)
      : kind === "category" ? getExpenseCategoryLedger(numericId, page, range, EXPENSE_CATEGORY_LEDGER_PAGE_SIZE)
      : listCashMovementsByCustomer(numericId, page, range, PARTY_PAGE_SIZE);
    call
      .then((res) => {
        setItems(res.items);
        setTotal(res.total);
        setTotals({ debit: res.totalDebit, credit: res.totalCredit });
        if (kind === "category" && "categoryName" in res) setLabel(res.categoryName as string);
        setError("");
      })
      .catch((e) => {
        setItems([]);
        setError(e instanceof ApiError ? e.message : "Could not load this ledger.");
      })
      .finally(() => setLoading(false));
  }, [kind, numericId, page, fromDate, toDate, singleMode]);

  // Server-side sums over every row matching the filters, not just this page.
  const totalDebit = totals.debit;
  const totalCredit = totals.credit;

  useEffect(() => { refresh(); }, [refresh]);

  async function onExport() {
    setExporting(true);
    try {
      const range = { fromDate: fromDate || undefined, toDate: toDate || undefined };
      if (singleMode) await downloadLedger("mode", singleMode, { ...range, bankId: numericId });
      else await downloadLedger(kind, numericId, range);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not download the ledger.");
    } finally {
      setExporting(false);
    }
  }

  if (labelError) return <div className="notice">{labelError}</div>;

  return (
    <>
      <div className="page-h">
        <div>
          <a href={routeHref("cash")} style={{ fontSize: 13 }}>← Back</a>
          <h1>{label || "Loading…"}</h1>
          <p>Every {kind === "category" ? "expense recorded under this category" : `transaction ever recorded against this ${kind}`}</p>
        </div>
        <div className="sp" />
        <button className="btn ghost" disabled={exporting} onClick={onExport} title="PDF of every transaction in the selected date range">
          <Icon name="download" /> {exporting ? "Preparing…" : "Download"}
        </button>
      </div>
      <hr className="gold-rule" />

      <div className="kpis" style={{ marginBottom: 16 }}>
        <div className="kpi"><div className="l">Total Debit</div><div className="v">{fmt(totalDebit)}</div></div>
        <div className="kpi"><div className="l">Total Credit</div><div className="v">{fmt(totalCredit)}</div></div>
        <div className="kpi"><div className="l">Net</div><div className="v">{fmt(totalCredit - totalDebit)}</div></div>
      </div>

      {error && <div className="notice" style={{ marginBottom: 14 }}>{error}</div>}

      <div className="card tbl-card tbl-card-fill">
        <div className="hd" style={{ flexWrap: "wrap", rowGap: 10 }}>
          <h3>Transactions</h3>
          <div className="sp" />
          <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
            <DatePicker value={fromDate} onChange={setFromDate} placeholder="From…" max={toDate || undefined} />
            <DatePicker value={toDate} onChange={setToDate} placeholder="To…" min={fromDate || undefined} />
            {(fromDate || toDate) && (
              <button className="btn ghost sm" onClick={() => { setFromDate(""); setToDate(""); }}>Clear</button>
            )}
            {kind === "bank" && (
              <FilterPanel categories={modeFilterCategories} value={modeFilters} onChange={setModeFilters} hideChips />
            )}
          </div>
        </div>
        <div className="tbl-wrap tbl-scroll">
          <table className="tbl">
            <thead>
              <tr><th>Date</th><th>Description</th><th>Method</th><th>Reference</th><th className="num">Debit</th><th className="num">Credit</th><th className="num">Balance</th></tr>
            </thead>
            <tbody>
              {loading ? (
                <tr><td colSpan={7} className="empty compact">Loading…</td></tr>
              ) : items.length === 0 ? (
                <tr><td colSpan={7} className="empty compact">No transactions found.</td></tr>
              ) : items.map((r) => {
                // A loan-number-shaped reference (e.g. "LN-00047") gets a
                // clickable ledger-ref chip like the customer/bank refs
                // beside it, instead of sitting there as dead text — same
                // "click a reference, land on its own ledger" pattern as
                // LedgerRefLink's other kinds. A plain cash_movement row
                // (e.g. a loan top-up) carries no Reference at all — its loan
                // number instead sits inside Description ("Loan top-up —
                // LN-00048"), same shape Cash.tsx's own LOAN_NUMBER_RE parses.
                const loanRef =
                  (r.reference && r.reference.match(/^LN-\d+/i)?.[0]) ||
                  r.description.match(/—\s*(LN-\S+)\s*$/i)?.[1] ||
                  null;
                // Same for an investment deposit/payout ("… — INV-00003"),
                // linking to that investment's own ledger.
                const invRef =
                  (r.reference && r.reference.match(/^INV-\d+/i)?.[0]) ||
                  r.description.match(/—\s*(INV-\S+)\s*$/i)?.[1] ||
                  null;
                return (
                <tr key={r.id}>
                  <td>{r.d}</td>
                  <td>
                    {r.description || r.type}
                    <div style={{ display: "flex", flexWrap: "wrap", gap: 4, marginTop: 4 }}>
                      {kind !== "customer" && r.customerId ? (
                        <LedgerRefLink kind="customer" id={r.customerId} label={r.customerName || "Customer"} />
                      ) : null}
                      {kind !== "bank" && r.bankId ? (
                        <LedgerRefLink kind="bank" id={r.bankId} label={r.bankName || "Bank"} />
                      ) : null}
                      {kind !== "category" ? <CategoryChip text={r.description} categoryIds={categoryIds} /> : null}                    </div>
                  </td>
                  <td>
                    {!r.method ? "—"
                      : MODE_LEDGER_ROUTE[r.method] ? <a href={routeHref(MODE_LEDGER_ROUTE[r.method])}>{r.method}</a>
                      : r.method}
                  </td>
                  <td>
                    {loanRef ? (
                      <a href={routeHref("loan", loanRef)} className="ledger-ref-chip ledger-ref-chip-loan">{r.reference || loanRef}</a>
                    ) : invRef ? (
                      <LedgerRefLink kind="investment" id={invRef} label={invRef} />
                    ) : (
                      r.reference || "—"
                    )}
                  </td>
                  <td className="num" style={{ color: r.debitOrCredit === "debit" ? "var(--red)" : undefined }}>{r.debitOrCredit === "debit" ? fmt(r.amount) : "—"}</td>
                  <td className="num" style={{ color: r.debitOrCredit === "credit" ? "var(--green)" : undefined }}>{r.debitOrCredit === "credit" ? fmt(r.amount) : "—"}</td>
                  <td className="num">{fmt(r.runningBalance)}</td>
                </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        <Pager page={page} total={total} pageSize={kind === "category" ? EXPENSE_CATEGORY_LEDGER_PAGE_SIZE : PARTY_PAGE_SIZE} onChange={setPage}>
          <FooterTotals items={[
            { label: "Total Debit", value: totalDebit, color: "var(--red)" },
            { label: "Total Credit", value: totalCredit, color: "var(--green)" },
          ]} />
        </Pager>
      </div>
    </>
  );
}
