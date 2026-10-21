"use client";

import { usePersistedState } from "@/common/hooks/use-persisted-state";
import { BackLink } from "@/common/components/ui/BackLink";
import { useCallback, useEffect, useRef, useState } from "react";
import { fmt, fmtDate } from "@/common/utils/format";
import { ApiError } from "@/common/services/httpClient";
import { LedgerRefLink } from "@/common/components/LedgerRefLink";
import { CategoryChip } from "@/common/components/CategoryChip";
import { loanCatRef } from "@/modules/cash/utils/ledgerCells";
import { LedgerEntryActions } from "@/modules/cash/components/LedgerEntryActions";
import { useExpenseCategoryIds } from "@/common/hooks/use-expense-category-ids";
import { ledgerFocusTarget, rememberedLedgerPage, saveLedgerPosition, useLedgerFocus } from "@/common/hooks/use-ledger-focus";
import { getModeLedger, downloadLedger, PARTY_PAGE_SIZE } from "@/modules/cash/services/cashService";
import { type LedgerMode, type LedgerRowView } from "@/modules/cash/types/cash-types";
import { Icon } from "@/common/components/Icon";
import { useAuth } from "@/common/providers/AuthProvider";
import { listActiveBranches } from "@/modules/branches/services/branchService";
import { type BranchView } from "@/modules/branches/types/branch-types";
import { useShowBranchFilter } from "@/common/hooks/use-branch-switch";
import { searchBanksPage } from "@/modules/banks/services/bankService";
import { type BackendBank } from "@/modules/banks/types/bank-types";
import { FilterPanel, type FilterCategory, type FilterValue } from "@/common/components/ui/FilterPanel";
import { FooterTotals } from "@/common/components/ui/FooterTotals";
import { goBack, routeHref } from "@/common/services/appRoutes";
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

const MODE_DESCRIPTION: Record<LedgerMode, string> = {
  Cash: "Every transaction recorded in Cash mode — loan/personal-loan collections, gold sales, and plain cash movements.",
  UPI: "Every transaction recorded in UPI mode — loan/personal-loan collections, gold sales, and plain cash movements.",
  "Bank Transfer": "Every transaction recorded in Bank Transfer mode — loan/personal-loan collections, gold sales, and plain cash movements.",
  Cheque: "Every transaction recorded in Cheque mode — loan/personal-loan collections, gold sales, and plain cash movements.",
};

type ModeLedgerPageProps = { mode: LedgerMode };

// Cash has no bank of record, so its own ledger never shows the Bank filter; every other mode does.
export function ModeLedgerPage({ mode }: ModeLedgerPageProps) {
  const { can } = useAuth();
  const canExport = can("Ledger_Export", "can_export_ledger");
  const categoryIds = useExpenseCategoryIds();
  const [items, setItems] = useState<LedgerRowView[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(() => rememberedLedgerPage("mode") ?? 1);
  useEffect(() => { saveLedgerPosition({ mode: page }); }, [page]);
  const { cards, size: pageSize, more } = useScrollPageSize(PARTY_PAGE_SIZE, STACK_MODE_MAX_WIDTH);
  useEffect(() => { if (cards) setPage(1); }, [cards]);
  const [branches, setBranches] = useState<BranchView[]>([]);
  const showBranchFilter = useShowBranchFilter();
  const [filters, setFilters] = usePersistedState<FilterValue>("mode:filters", {});
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [totals, setTotals] = useState({ debit: 0, credit: 0 });
  const [exporting, setExporting] = useState(false);

  const fromDate = filters.__dateFrom || "";
  const toDate = filters.__dateTo || "";
  // Ignored while the Branch filter is hidden, so a stale saved selection can't empty the page.
  const branchIds = showBranchFilter && Array.isArray(filters.branch) ? filters.branch : [];
  const typeValues = Array.isArray(filters.type) ? filters.type : [];
  const bankValues = Array.isArray(filters.bank) ? filters.bank : [];
  const bankId = bankValues.length ? Number(bankValues[0]) : undefined;

  useEffect(() => {
    listActiveBranches().then(setBranches).catch(() => {});
  }, []);

  const filterKey = `${fromDate}|${toDate}|${JSON.stringify(branchIds)}|${bankId ?? ""}|${typeValues.join(",")}`;
  const prevFilterKey = useRef(filterKey);
  useEffect(() => {
    if (prevFilterKey.current === filterKey) return;
    prevFilterKey.current = filterKey;
    setPage(1);
  }, [filterKey]);
  const prevMode = useRef(mode);
  const focusPending = useRef(true);
  useEffect(() => {
    if (prevMode.current === mode) return;
    prevMode.current = mode;
    focusPending.current = true;
    setPage(rememberedLedgerPage("mode") ?? 1);
  }, [mode]);

  const requestIdRef = useRef(0);
  const itemsRef = useRef(items);
  itemsRef.current = items;
  const refresh = useCallback(() => {
    const reqId = ++requestIdRef.current;
    if (!(cards && itemsRef.current.length)) setLoading(true);
    const target = focusPending.current ? ledgerFocusTarget("mode") : null;
    getModeLedger(
      mode,
      page,
      { ...(target && "date" in target ? { focusDate: target.date, focusAmount: target.amount } : {}), fromDate: fromDate || undefined, toDate: toDate || undefined, branchIds: branchIds.length ? branchIds.map(Number) : undefined, bankId, types: typeValues.length ? typeValues : undefined },
      pageSize
    )
      .then(({ items, total, totalDebit, totalCredit, focusPage }) => {
        if (reqId !== requestIdRef.current) return;
        focusPending.current = false;
        if (focusPage && focusPage !== page && !cards) setPage(focusPage);
        setItems(items);
        setTotal(total);
        setTotals({ debit: totalDebit, credit: totalCredit });
        setError("");
      })
      .catch((e) => {
        if (reqId !== requestIdRef.current) return;
        setItems([]);
        setError(e instanceof ApiError ? e.message : `Could not load the ${mode} ledger.`);
      })
      .finally(() => { if (reqId === requestIdRef.current) setLoading(false); });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mode, page, pageSize, cards, fromDate, toDate, JSON.stringify(branchIds), bankId, typeValues.join(",")]);

  useEffect(() => { refresh(); }, [refresh]);
  useLedgerFocus("mode", !loading, [items]);

  async function onDownload() { return singleFlight("cash:mode-ledger-download", async () => {
    setExporting(true);
    try {
      await downloadLedger("mode", mode, {
        fromDate: fromDate || undefined, toDate: toDate || undefined,
        branchIds: branchIds.length ? branchIds.map(Number) : undefined, bankId,
        types: typeValues.length ? typeValues : undefined,
      });
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not download the ledger.");
    } finally {
      setExporting(false);
    }
  }); }

  const filterCategories: FilterCategory[] = [
    ...(!showBranchFilter ? [] : [{ key: "branch", label: "Branch", kind: "static" as const, searchHint: "Searches: branch name", options: branches.map((b) => ({ value: String(b.id), label: b.name })) }]),
    ...(mode !== "Cash"
      ? [{
          key: "bank",
          label: "Bank",
          kind: "async" as const,
          searchHint: "Searches: bank name",
          singleSelect: true,
          fetchOptions: (search: string, p: number) =>
            searchBanksPage(search, p - 1).then((res) => ({
              items: res.items.map((b: BackendBank) => ({ value: String(b.id), label: b.branch ? `${b.name} — ${b.branch}` : b.name })),
              hasMore: res.hasMore,
            })),
        }]
      : []),
    {
      key: "type", label: "Type", kind: "static" as const, searchHint: "Searches: transaction type",
      options: [
        { value: "loan", label: "Loan" },
        { value: "auction", label: "Auction" },
        { value: "collection", label: "Collection" },
        { value: "personal loan", label: "Personal Loan" },
        { value: "investment", label: "Investment" },
        { value: "expenses", label: "Expenses" },
      ],
    },
    { key: "__date", label: "Date", kind: "date" as const },
  ];

  return (
    <>
      <div className="page-h">
        <div>
          <BackLink href={routeHref("ledger")} onClick={() => goBack("ledger")} />
          <h1>{mode} Ledger</h1>
          <p>{MODE_DESCRIPTION[mode]}</p>
        </div>
      </div>
      <hr className="gold-rule" />

      {/* Totals for this mode — every row matching the filters, not just the page. */}
      <div className="kpis" style={{ marginBottom: 16 }}>
        <div className="kpi"><div className="l">Net {mode}</div><div className="v">{fmt(totals.credit - totals.debit)}</div></div>
        <div className="kpi"><div className="l">Total Credit</div><div className="v">{fmt(totals.credit)}</div></div>
        <div className="kpi"><div className="l">Total Debit</div><div className="v">{fmt(totals.debit)}</div></div>
      </div>

      {error && <div className="notice" style={{ marginBottom: 14 }}>{error}</div>}

      <div className="card tbl-card tbl-card-fill">
        <div className="hd" style={{ flexWrap: "wrap", rowGap: 10 }}>
          <h3>Transactions</h3>
          <div className="sp" />
          <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
            <FilterPanel categories={filterCategories} value={filters} onChange={setFilters} hideChips hideClearAll />
            {canExport && (
              <button className="btn ghost sm" disabled={exporting} onClick={onDownload} title="PDF of every transaction matching the current filters">
                <Icon name="download" /> {exporting ? "Preparing…" : "Download"}
              </button>
            )}
          </div>
        </div>
        <div className="tbl-wrap tbl-scroll">
          <table className="tbl tbl-center tbl-stack ledger-amt" data-ledger-scope="mode" data-ledger-page={page}>
            <thead>
              <tr><th>Date</th><th>Ref No</th><th style={{ textAlign: "center" }}>Particulars</th>{mode !== "Cash" && <th>Bank</th>}<th className="num">Debit</th><th className="num">Credit</th><th className="num">Balance</th></tr>
            </thead>
            <tbody>
              {loading ? (
                <tr><td colSpan={mode !== "Cash" ? 7 : 6} className="empty compact">Loading…</td></tr>
              ) : items.length === 0 ? (
                <tr><td colSpan={mode !== "Cash" ? 7 : 6} className="empty compact">No transactions found.</td></tr>
              ) : (() => {
                return items.map((r) => {
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
                  <tr key={`${r.type}-${r.id}-${r.method}`} data-ledger-key={`${r.id}-${r.d}-${r.amount}-${r.debitOrCredit}-${r.method}`} data-ledger-date={r.d} data-ledger-amount={r.amount}>
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
                      {r.customerId ? (
                        <LedgerRefLink kind="customer" id={r.customerId} label={r.customerName || "Customer"} />
                      ) : null}
                      <CategoryChip text={r.description} categoryIds={categoryIds} />
                    </div>
                  </td>
                                        {mode !== "Cash" && (
                      <td data-label="Bank">{r.bankId ? <LedgerRefLink kind="bank" id={r.bankId} label={r.bankName || "Bank"} /> : "—"}</td>
                    )}
                    <td className="num" data-label="Debit" style={{ color: r.debitOrCredit === "debit" ? "var(--red)" : undefined }}>{r.debitOrCredit === "debit" ? fmt(r.amount) : "—"}</td>
                    <td className="num" data-label="Credit" style={r.memo ? { color: "var(--muted)", fontStyle: "italic" } : { color: r.debitOrCredit === "credit" ? "var(--green)" : undefined }}>{r.debitOrCredit === "credit" ? fmt(r.amount) : "—"}</td>
                    <td className="num" data-label="Balance">{fmt(r.runningBalance)}<LedgerEntryActions entryId={r.entryId} row={r} editable={r.editable} onChanged={refresh} /></td>
                  </tr>
                  );
                });
              })()}
            </tbody>
          </table>
        </div>
        <ScrollSentinel enabled={cards && items.length < total} onVisible={more} watch={items.length} />
        <Pager page={page} total={total} pageSize={pageSize} onChange={setPage} cards={cards}>
          <FooterTotals aligned items={[
            { value: totals.debit, color: "var(--red)" },
            { value: totals.credit, color: "var(--green)" },
          ]} />
        </Pager>
      </div>
    </>
  );
}
