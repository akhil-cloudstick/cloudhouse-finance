"use client";

import { usePersistedState } from "@/common/hooks/use-persisted-state";
import { BackLink } from "@/common/components/ui/BackLink";
import { useCallback, useEffect, useRef, useState } from "react";
import { fmt, fmtDate } from "@/common/utils/format";
import { Icon } from "@/common/components/Icon";
import { useAuth } from "@/common/providers/AuthProvider";
import { ApiError } from "@/common/services/httpClient";
import { LedgerRefLink } from "@/common/components/LedgerRefLink";
import { CategoryChip } from "@/common/components/CategoryChip";
import { loanCatRef } from "@/modules/cash/utils/ledgerCells";
import { LedgerEntryActions } from "@/modules/cash/components/LedgerEntryActions";
import { useExpenseCategoryIdsState } from "@/common/hooks/use-expense-category-ids";
import { ledgerFocusTarget, rememberedLedgerPage, saveLedgerPosition, useLedgerFocus } from "@/common/hooks/use-ledger-focus";
import { goBack, routeHref } from "@/common/services/appRoutes";
import { listCashMovementsByCustomer, getBankLedger, getModeLedger, downloadLedger, PARTY_PAGE_SIZE, MODE_LEDGER_ROUTE, LEDGER_MODES } from "@/modules/cash/services/cashService";
import { type LedgerMode, type LedgerRowView } from "@/modules/cash/types/cash-types";
import { getBank } from "@/modules/banks/services/bankService";
import { type BackendBank } from "@/modules/banks/types/bank-types";
import { getCustomer } from "@/modules/customers/services/customerService";
import { type CustomerView } from "@/modules/customers/types/customer-types";

import { getExpenseCategoryLedger, EXPENSE_CATEGORY_LEDGER_PAGE_SIZE } from "@/modules/cash/services/expenseCategoryService";
import { type LoanLedgerSummary } from "@/modules/cash/types/expense-category-types";
import { FilterPanel, type FilterCategory, type FilterValue } from "@/common/components/ui/FilterPanel";
import { FooterTotals } from "@/common/components/ui/FooterTotals";
import { singleFlight } from "@/common/utils/singleFlight";
import { useScrollPageSize, STACK_MODE_MAX_WIDTH } from "@/common/utils/responsive";
import { ScrollSentinel } from "@/common/components/ui/ScrollSentinel";

// In card mode (<=1279px) the Prev/Next controls give way to scroll-to-load; the footer totals stay.
type PagerProps = { page: number; total: number; pageSize: number; onChange: (p: number) => void; cards?: boolean; children?: React.ReactNode };

function Pager({ page, total, pageSize, onChange, cards, children }: PagerProps) {
  const totalPages = Math.max(1, Math.ceil(total / pageSize));
  return (
    <div className="ft ft-static" style={{ display: "flex", alignItems: "center", gap: 12, padding: "12px 14px" }}>
      {!cards && <button className="btn plain" disabled={page <= 1} onClick={() => onChange(Math.max(1, page - 1))}>‹ Prev</button>}
      {!cards && <span style={{ fontSize: 13 }}>Page {page} of {totalPages}</span>}
      {!cards && <button className="btn plain" disabled={page >= totalPages} onClick={() => onChange(Math.min(totalPages, page + 1))}>Next ›</button>}
      {children}
    </div>
  );
}

type PartyLedgerPageProps = { kind: "bank" | "customer" | "category"; id?: string };

export function PartyLedgerPage({ kind, id }: PartyLedgerPageProps) {
  const { can } = useAuth();
  const canExport = can("Ledger_Export", "can_export_ledger");
  const numericId = Number(id);
  const { ids: categoryIds, ready: idsReady } = useExpenseCategoryIdsState();
  const [label, setLabel] = useState("");
  const [labelError, setLabelError] = useState("");
  const [items, setItems] = useState<LedgerRowView[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(() => rememberedLedgerPage("party") ?? 1);
  useEffect(() => { saveLedgerPosition({ party: page }); }, [page]);
  const { cards, size: pageSize, more } = useScrollPageSize(kind === "category" ? EXPENSE_CATEGORY_LEDGER_PAGE_SIZE : PARTY_PAGE_SIZE, STACK_MODE_MAX_WIDTH);
  useEffect(() => { if (cards) setPage(1); }, [cards]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [exporting, setExporting] = useState(false);
  const [totals, setTotals] = useState({ debit: 0, credit: 0 });
  // Set when this category is a loan source — the ledger is then the loan's own, principal-based balance.
  const [loan, setLoan] = useState<LoanLedgerSummary | undefined>();
  // Mode filter only makes sense on a bank's own ledger.
  const [modeFilters, setModeFilters] = usePersistedState<FilterValue>("party:filters", {});
  const modeValues = (Array.isArray(modeFilters.mode) ? modeFilters.mode : []) as LedgerMode[];
  const fromDate = modeFilters.__dateFrom || "";
  const toDate = modeFilters.__dateTo || "";
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
    // Category has no separate "get one" endpoint; its name comes back with the first ledger page.
  }, [kind, numericId]);

  const filterKey = `${fromDate}|${toDate}|${JSON.stringify(modeValues)}`;
  const prevFilterKey = useRef(filterKey);
  useEffect(() => {
    if (prevFilterKey.current === filterKey) return;
    prevFilterKey.current = filterKey;
    setPage(1);
  }, [filterKey]);
  const ledgerKey = `${kind}/${numericId}`;
  const prevLedgerKey = useRef(ledgerKey);
  const focusPending = useRef(true);
  useEffect(() => {
    if (prevLedgerKey.current === ledgerKey) return;
    prevLedgerKey.current = ledgerKey;
    focusPending.current = true;
    setPage(rememberedLedgerPage("party") ?? 1);
  }, [ledgerKey]);


  const requestIdRef = useRef(0);
  const itemsRef = useRef(items);
  itemsRef.current = items;
  const refresh = useCallback(() => {
    if (!numericId) return;
    const reqId = ++requestIdRef.current;
    if (!(cards && itemsRef.current.length)) setLoading(true);
    const target = focusPending.current ? ledgerFocusTarget("party") : null;
    const range = {
      fromDate: fromDate || undefined, toDate: toDate || undefined,
      ...(target && "date" in target ? { focusDate: target.date, focusAmount: target.amount } : {}),
    };
    const call =
      kind === "bank" ? getBankLedger(numericId, page, { ...range, modes: modeValues }, pageSize)
      : kind === "category" ? getExpenseCategoryLedger(numericId, page, range, pageSize)
      : listCashMovementsByCustomer(numericId, page, range, pageSize);
    call
      .then((res) => {
        if (reqId !== requestIdRef.current) return;
        focusPending.current = false;
        if (res.focusPage && res.focusPage !== page && !cards) setPage(res.focusPage);
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
  }, [kind, numericId, page, pageSize, cards, fromDate, toDate, JSON.stringify(modeValues)]);

  const totalDebit = totals.debit;
  const totalCredit = totals.credit;

  useEffect(() => { refresh(); }, [refresh]);
  useLedgerFocus("party", !loading && idsReady, [items]);

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
          <table className="tbl tbl-center tbl-stack ledger-amt" data-ledger-scope="party" data-ledger-page={page}>
            <thead>
              <tr><th>Date</th><th>Ref No</th><th style={{ textAlign: "center" }}>Particulars</th><th>{loan ? "Mode" : "Method"}</th>{loan && <th>Bank</th>}<th className="num">Debit</th><th className="num">Credit</th><th className="num">Balance</th></tr>
            </thead>
            <tbody>
              {loading || !idsReady ? (
                <tr><td colSpan={loan ? 8 : 7} className="empty compact">Loading…</td></tr>
              ) : items.length === 0 ? (
                <tr><td colSpan={loan ? 8 : 7} className="empty compact">No transactions found.</td></tr>
              ) : items.map((r, i) => {
                // A loan/personal-loan/investment reference may sit in `reference` or trail the description.
                const loanRef =
                  (r.reference && r.reference.match(/^LN-\d+/i)?.[0]) ||
                  r.description.match(/—\s*(LN-\S+)\s*$/i)?.[1] ||
                  null;
                const invRef =
                  (r.reference && r.reference.match(/^INV-\d+/i)?.[0]) ||
                  r.description.match(/—\s*(INV-\S+)\s*$/i)?.[1] ||
                  null;
                const plRef =
                  (r.reference && r.reference.match(/^PL-\d+/i)?.[0]) ||
                  r.description.match(/—\s*(PL-\S+)\s*$/i)?.[1] ||
                  null;
                return (
                // A loan ledger mixes movement/expense ids plus an id-less opening row; key by position.
                <tr key={loan ? `${i}-${r.id}` : `${r.type}-${r.id}-${r.method}`} data-ledger-key={`${r.id}-${r.d}-${r.amount}-${r.debitOrCredit}-${r.method}`} data-ledger-date={r.d} data-ledger-amount={r.amount}>
                  <td data-label="Date">{fmtDate(r.d)}</td>
                  <td data-label="Ref No">
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
                  <td data-label="Particulars" style={{ textAlign: "center" }}>
                    {r.description || r.type}
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
                  <td data-label={loan ? "Mode" : "Method"}>
                    {!r.method ? "—"
                      : MODE_LEDGER_ROUTE[r.method] ? <a href={routeHref(MODE_LEDGER_ROUTE[r.method])}>{r.method}</a>
                      : r.method}
                  </td>
                  {loan && (
                    <td data-label="Bank">{r.bankId ? <LedgerRefLink kind="bank" id={r.bankId} label={r.bankName || "Bank"} /> : "—"}</td>
                  )}
                  <td className="num" data-label="Debit" style={{ color: r.debitOrCredit === "debit" ? "var(--red)" : undefined }}>{r.debitOrCredit === "debit" ? fmt(r.amount) : "—"}</td>
                  <td className="num" data-label="Credit" style={r.memo ? { color: "var(--muted)", fontStyle: "italic" } : { color: r.debitOrCredit === "credit" ? "var(--green)" : undefined }}>{r.debitOrCredit === "credit" ? fmt(r.amount) : "—"}</td>
                  <td className="num" data-label="Balance">{fmt(r.runningBalance)}<LedgerEntryActions entryId={r.entryId} row={r} editable={r.editable} onChanged={refresh} /></td>
                </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        <ScrollSentinel enabled={cards && items.length < total} onVisible={more} watch={items.length} />
        <Pager page={page} total={total} pageSize={pageSize} onChange={setPage} cards={cards}>
          <FooterTotals aligned items={[
            { value: totalDebit, color: "var(--red)" },
            { value: totalCredit, color: "var(--green)" },
          ]} />
        </Pager>
      </div>
    </>
  );
}
