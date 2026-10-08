"use client";

import { usePersistedState } from "@/product/hooks/usePersistedState";
import { BackLink } from "@/product/components/ui/BackLink";
import { useCallback, useEffect, useRef, useState } from "react";
import { fmt, fmtDate } from "@/product/utils/format";
import { Icon } from "@/product/components/Icon";
import { useAuth } from "@/product/providers/auth-context";
import { ApiError } from "@/product/services/httpClient";
import { LedgerRefLink, CategoryChip } from "@/product/components/ui/LedgerRefLink";
import { loanCatRef, BillLink } from "@/product/pages/cash/components/ledgerCells";
import { useExpenseCategoryIds } from "@/product/hooks/useExpenseCategoryIds";
import { rememberedLedgerPage, saveLedgerPosition, useLedgerFocus } from "@/product/hooks/useLedgerFocus";
import { goBack, routeHref } from "@/product/services/appRoutes";
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

import { getExpenseCategoryLedger, EXPENSE_CATEGORY_LEDGER_PAGE_SIZE, type LoanLedgerSummary } from "@/product/pages/cash/services/expenseCategoryService";
import { FilterPanel, type FilterCategory, type FilterValue } from "@/product/components/ui/FilterPanel";
import { FooterTotals } from "@/product/components/ui/FooterTotals";
import { singleFlight } from "@/product/utils/singleFlight";

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
  const { can } = useAuth();
  const canExport = can("Ledger_Export", "can_export_ledger");
  const numericId = Number(id);
  const categoryIds = useExpenseCategoryIds();
  const [label, setLabel] = useState("");
  const [labelError, setLabelError] = useState("");
  const [items, setItems] = useState<LedgerRowView[]>([]);
  const [total, setTotal] = useState(0);
  // Back from a drill-down, this ledger reopens on the page the user left.
  const [page, setPage] = useState(() => rememberedLedgerPage("party") ?? 1);
  useEffect(() => { saveLedgerPosition({ party: page }); }, [page]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [exporting, setExporting] = useState(false);
  const [totals, setTotals] = useState({ debit: 0, credit: 0 });
  // Set when this category is a loan source — the ledger is then the loan's
  // own, with a principal-based running balance.
  const [loan, setLoan] = useState<LoanLedgerSummary | undefined>();
  // Mode filter — only offered on a bank's own ledger (UPI/Bank
  // Transfer/Cheque/Cash all pass through a bank); customer/category ledgers
  // don't get this, same "meaningless outside a bank ledger" reasoning as
  // ModeLedgerPage's own Bank filter being Cash-only-excluded.
  const [modeFilters, setModeFilters] = usePersistedState<FilterValue>("party:filters", {});
  const modeValues = (Array.isArray(modeFilters.mode) ? modeFilters.mode : []) as LedgerMode[];
  const fromDate = modeFilters.__dateFrom || "";
  const toDate = modeFilters.__dateTo || "";
  // One grouped filter: Mode (bank ledgers only) and Date.
  const modeFilterCategories: FilterCategory[] = [
    ...(kind === "bank" ? [{ key: "mode", label: "Mode", kind: "static" as const, options: LEDGER_MODES.map((m) => ({ value: m, label: m })) }] : []),
    { key: "__date", label: "Date", kind: "date" as const },
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

  // Any filter change resets back to page 1; moving to another ledger (this
  // component stays mounted across bank/customer/category ids) starts on its
  // remembered page. Compared against the previous key so neither fires on
  // mount, where the initial page state already applies.
  const filterKey = `${fromDate}|${toDate}|${JSON.stringify(modeValues)}`;
  const prevFilterKey = useRef(filterKey);
  useEffect(() => {
    if (prevFilterKey.current === filterKey) return;
    prevFilterKey.current = filterKey;
    setPage(1);
  }, [filterKey]);
  const ledgerKey = `${kind}/${numericId}`;
  const prevLedgerKey = useRef(ledgerKey);
  useEffect(() => {
    if (prevLedgerKey.current === ledgerKey) return;
    prevLedgerKey.current = ledgerKey;
    setPage(rememberedLedgerPage("party") ?? 1);
  }, [ledgerKey]);


  // Only the latest request may land — switching ledger/page fires a new
  // one before the previous has answered.
  const requestIdRef = useRef(0);
  const refresh = useCallback(() => {
    if (!numericId) return;
    const reqId = ++requestIdRef.current;
    setLoading(true);
    const range = { fromDate: fromDate || undefined, toDate: toDate || undefined };
    const call =
      kind === "bank" ? getBankLedger(numericId, page, { ...range, modes: modeValues }, PARTY_PAGE_SIZE)
      : kind === "category" ? getExpenseCategoryLedger(numericId, page, range, EXPENSE_CATEGORY_LEDGER_PAGE_SIZE)
      : listCashMovementsByCustomer(numericId, page, range, PARTY_PAGE_SIZE);
    call
      .then((res) => {
        if (reqId !== requestIdRef.current) return;
        setItems(res.items);
        setTotal(res.total);
        setTotals({ debit: res.totalDebit, credit: res.totalCredit });
        if (kind === "category" && "categoryName" in res) setLabel(res.categoryName as string);
        setLoan(kind === "category" && "loan" in res ? (res.loan as LoanLedgerSummary | undefined) : undefined);
        setError("");
      })
      .catch((e) => {
        if (reqId !== requestIdRef.current) return;
        setItems([]);
        setError(e instanceof ApiError ? e.message : "Could not load this ledger.");
      })
      .finally(() => { if (reqId === requestIdRef.current) setLoading(false); });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [kind, numericId, page, fromDate, toDate, JSON.stringify(modeValues)]);

  // Server-side sums over every row matching the filters, not just this page.
  const totalDebit = totals.debit;
  const totalCredit = totals.credit;

  useEffect(() => { refresh(); }, [refresh]);
  useLedgerFocus("party", !loading, [items]);

  async function onExport() { return singleFlight("cash:party-ledger-export", async () => {
    setExporting(true);
    try {
      const range = { fromDate: fromDate || undefined, toDate: toDate || undefined };
      await downloadLedger(kind, numericId, kind === "bank" ? { ...range, modes: modeValues } : range);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not download the ledger.");
    } finally {
      setExporting(false);
    }
  }); }

  if (labelError) return <div className="notice">{labelError}</div>;
  // /ledger-bank with no id (or a non-numeric one) names no ledger — say so
  // rather than sitting on "Loading…" forever.
  if (!numericId) {
    return (
      <div className="notice">
        No {kind} selected. <a href={routeHref("ledger")} onClick={(e) => { e.preventDefault(); goBack("ledger"); }}>Back to the Ledger</a>
      </div>
    );
  }

  return (
    <>
      <div className="page-h">
        <div>
          <BackLink href={routeHref("ledger")} onClick={() => goBack("ledger")} />
          <h1>{label || "Loading…"}</h1>
          {!loan && <p>{`Every ${kind === "category" ? "expense recorded under this category" : `transaction ever recorded against this ${kind}`}`}</p>}
        </div>
      </div>
      <hr className="gold-rule" />

      <div className="kpis" style={{ marginBottom: 16 }}>
        <div className="kpi"><div className="l">Net</div><div className="v">{fmt(totalCredit - totalDebit)}</div></div>
        <div className="kpi"><div className="l">Total Credit</div><div className="v">{fmt(totalCredit)}</div></div>
        <div className="kpi"><div className="l">Total Debit</div><div className="v">{fmt(totalDebit)}</div></div>
      </div>

      {error && <div className="notice" style={{ marginBottom: 14 }}>{error}</div>}

      <div className="card tbl-card tbl-card-fill">
        <div className="hd" style={{ flexWrap: "wrap", rowGap: 10 }}>
          <h3>Transactions</h3>
          <div className="sp" />
          <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
            <FilterPanel categories={modeFilterCategories} value={modeFilters} onChange={setModeFilters} hideChips hideClearAll />
            {canExport && (
              <button className="btn ghost sm" disabled={exporting} onClick={onExport} title="PDF of every transaction in the selected date range">
                <Icon name="download" /> {exporting ? "Preparing…" : "Download"}
              </button>
            )}
          </div>
        </div>
        <div className="tbl-wrap tbl-scroll">
          <table className="tbl tbl-center ledger-amt" data-ledger-scope="party" data-ledger-page={page}>
            <thead>
              <tr><th>Date</th><th>Ref No</th><th style={{ textAlign: "center" }}>Particulars</th><th>{loan ? "Mode" : "Method"}</th>{loan && <th>Bank</th>}<th className="num">Debit</th><th className="num">Credit</th><th className="num">Balance</th></tr>
            </thead>
            <tbody>
              {loading ? (
                <tr><td colSpan={loan ? 8 : 7} className="empty compact">Loading…</td></tr>
              ) : items.length === 0 ? (
                <tr><td colSpan={loan ? 8 : 7} className="empty compact">No transactions found.</td></tr>
              ) : items.map((r, i) => {
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
                // And a personal-loan payment ("PL-00003").
                const plRef =
                  (r.reference && r.reference.match(/^PL-\d+/i)?.[0]) ||
                  r.description.match(/—\s*(PL-\S+)\s*$/i)?.[1] ||
                  null;
                return (
                // A loan ledger mixes movement and expense ids (plus the
                // id-less opening row), so key by position there.
                <tr key={loan ? `${i}-${r.id}` : `${r.type}-${r.id}-${r.method}`} data-ledger-key={`${r.id}-${r.d}-${r.amount}-${r.debitOrCredit}-${r.method}`} data-ledger-date={r.d} data-ledger-amount={r.amount}>
                  <td>{fmtDate(r.d)}</td>
                  <td>
                    {loanRef ? (
                      <LedgerRefLink kind="loan" id={loanRef} label={r.reference || loanRef} />
                    ) : invRef ? (
                      <LedgerRefLink kind="investment" id={invRef} label={invRef} />
                    ) : plRef ? (
                      <LedgerRefLink kind="personalloan" id={plRef} label={plRef} />
                    ) : (
                      loanCatRef(r, categoryIds)
                    )}
                  </td>
                  <td style={{ textAlign: "center" }}>
                    {r.description || r.type}<BillLink url={r.receiptImage} title={r.description || r.type} />
                    <div style={{ display: "flex", flexWrap: "wrap", justifyContent: "center", gap: 4, marginTop: 4 }}>
                      {kind !== "customer" && r.customerId ? (
                        <LedgerRefLink kind="customer" id={r.customerId} label={r.customerName || "Customer"} />
                      ) : null}
                      {!loan && kind !== "bank" && r.bankId ? (
                        <LedgerRefLink kind="bank" id={r.bankId} label={r.bankName || "Bank"} />
                      ) : null}
                      {kind !== "category" ? <CategoryChip text={r.description} categoryIds={categoryIds} /> : null}
                    </div>
                  </td>
                  <td>
                    {!r.method ? "—"
                      : MODE_LEDGER_ROUTE[r.method] ? <a href={routeHref(MODE_LEDGER_ROUTE[r.method])}>{r.method}</a>
                      : r.method}
                  </td>
                  {loan && (
                    <td>{r.bankId ? <LedgerRefLink kind="bank" id={r.bankId} label={r.bankName || "Bank"} /> : "—"}</td>
                  )}
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
          <FooterTotals aligned items={[
            { value: totalDebit, color: "var(--red)" },
            { value: totalCredit, color: "var(--green)" },
          ]} />
        </Pager>
      </div>
    </>
  );
}
