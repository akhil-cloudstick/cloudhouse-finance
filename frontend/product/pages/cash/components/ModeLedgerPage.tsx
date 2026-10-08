"use client";

import { usePersistedState } from "@/product/hooks/usePersistedState";
import { BackLink } from "@/product/components/ui/BackLink";
import { useCallback, useEffect, useRef, useState } from "react";
import { fmt, fmtDate } from "@/product/utils/format";
import { ApiError } from "@/product/services/httpClient";
import { LedgerRefLink, CategoryChip } from "@/product/components/ui/LedgerRefLink";
import { loanCatRef, BillLink } from "@/product/pages/cash/components/ledgerCells";
import { useExpenseCategoryIds } from "@/product/hooks/useExpenseCategoryIds";
import { rememberedLedgerPage, saveLedgerPosition, useLedgerFocus } from "@/product/hooks/useLedgerFocus";
import { getModeLedger, downloadLedger, PARTY_PAGE_SIZE, type LedgerMode, type LedgerRowView } from "@/product/pages/cash/services/cashService";
import { Icon } from "@/product/components/Icon";
import { useAuth } from "@/product/providers/auth-context";
import { listActiveBranches, type BranchView } from "@/product/pages/branches/services/branchService";
import { useBranding } from "@/product/providers/BrandingProvider";
import { searchBanksPage, type BackendBank } from "@/product/pages/banks/services/bankService";
import { FilterPanel, type FilterCategory, type FilterValue } from "@/product/components/ui/FilterPanel";
import { FooterTotals } from "@/product/components/ui/FooterTotals";
import { goBack, routeHref } from "@/product/services/appRoutes";
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

const MODE_DESCRIPTION: Record<LedgerMode, string> = {
  Cash: "Every transaction recorded in Cash mode — loan/personal-loan collections, gold sales, and plain cash movements.",
  UPI: "Every transaction recorded in UPI mode — loan/personal-loan collections, gold sales, and plain cash movements.",
  "Bank Transfer": "Every transaction recorded in Bank Transfer mode — loan/personal-loan collections, gold sales, and plain cash movements.",
  Cheque: "Every transaction recorded in Cheque mode — loan/personal-loan collections, gold sales, and plain cash movements.",
};

/* One payment mode's own ledger — a sub-ledger of the branch/global cash
 * movement views, scoped to only transactions recorded in that mode (see
 * backend/internal/cash/ledger.go's ListModeLedger). Reachable via
 * #cash-ledger / #upi-ledger / #bank-transfer-ledger / #cheque-ledger — one
 * shared component parametrized by mode instead of four near-identical
 * copies. Branch scoping is enforced server-side (platform.GetBranchScope) —
 * a Branch Manager's own branch is locked in regardless of what's picked
 * here. Cash has no bank of record, so its own ledger never shows the Bank
 * filter; every other mode does. */
export function ModeLedgerPage({ mode }: { mode: LedgerMode }) {
  const { can } = useAuth();
  const canExport = can("Ledger_Export", "can_export_ledger");
  const categoryIds = useExpenseCategoryIds();
  const [items, setItems] = useState<LedgerRowView[]>([]);
  const [total, setTotal] = useState(0);
  // Back from a drill-down, this ledger reopens on the page the user left.
  const [page, setPage] = useState(() => rememberedLedgerPage("mode") ?? 1);
  useEffect(() => { saveLedgerPosition({ mode: page }); }, [page]);
  const [branches, setBranches] = useState<BranchView[]>([]);
  // Single-branch business: no branch filter — every row is its one branch.
  const { singleBranch } = useBranding();
  const [filters, setFilters] = usePersistedState<FilterValue>("mode:filters", {});
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  // Server-side sums over every row matching the filters, not just this page.
  const [totals, setTotals] = useState({ debit: 0, credit: 0 });
  const [exporting, setExporting] = useState(false);

  const fromDate = filters.__dateFrom || "";
  const toDate = filters.__dateTo || "";
  const branchIds = Array.isArray(filters.branch) ? filters.branch : [];
  const typeValues = Array.isArray(filters.type) ? filters.type : [];
  const bankValues = Array.isArray(filters.bank) ? filters.bank : [];
  const bankId = bankValues.length ? Number(bankValues[0]) : undefined;

  useEffect(() => {
    listActiveBranches().then(setBranches).catch(() => {});
  }, []);

  // Any filter change resets back to page 1; switching to another mode's
  // ledger (same component, new `mode`) starts on its remembered page.
  // Compared against the previous key so neither fires on mount.
  const filterKey = `${fromDate}|${toDate}|${JSON.stringify(branchIds)}|${bankId ?? ""}|${typeValues.join(",")}`;
  const prevFilterKey = useRef(filterKey);
  useEffect(() => {
    if (prevFilterKey.current === filterKey) return;
    prevFilterKey.current = filterKey;
    setPage(1);
  }, [filterKey]);
  const prevMode = useRef(mode);
  useEffect(() => {
    if (prevMode.current === mode) return;
    prevMode.current = mode;
    setPage(rememberedLedgerPage("mode") ?? 1);
  }, [mode]);

  // Only the latest request may land — see PartyLedger's refresh.
  const requestIdRef = useRef(0);
  const refresh = useCallback(() => {
    const reqId = ++requestIdRef.current;
    setLoading(true);
    getModeLedger(
      mode,
      page,
      { fromDate: fromDate || undefined, toDate: toDate || undefined, branchIds: branchIds.length ? branchIds.map(Number) : undefined, bankId, types: typeValues.length ? typeValues : undefined },
      PARTY_PAGE_SIZE
    )
      .then(({ items, total, totalDebit, totalCredit }) => {
        if (reqId !== requestIdRef.current) return;
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
  }, [mode, page, fromDate, toDate, JSON.stringify(branchIds), bankId, typeValues.join(",")]);

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
    ...(singleBranch ? [] : [{ key: "branch", label: "Branch", kind: "static" as const, searchHint: "Searches: branch name", options: branches.map((b) => ({ value: String(b.id), label: b.name })) }]),
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
          <table className="tbl tbl-center ledger-amt" data-ledger-scope="mode" data-ledger-page={page}>
            <thead>
              <tr><th>Date</th><th>Ref No</th><th style={{ textAlign: "center" }}>Particulars</th>{mode !== "Cash" && <th>Bank</th>}<th className="num">Debit</th><th className="num">Credit</th><th className="num">Balance</th></tr>
            </thead>
            <tbody>
              {loading ? (
                <tr><td colSpan={mode !== "Cash" ? 7 : 6} className="empty compact">Loading…</td></tr>
              ) : items.length === 0 ? (
                <tr><td colSpan={mode !== "Cash" ? 7 : 6} className="empty compact">No transactions found.</td></tr>
              ) : (() => {
                // The balance comes from the server — a true running balance over the
                // whole filtered ledger, so the newest row equals the Net above.
                return items.map((r) => {
                  // A gold-loan reference ("LN-00047") gets a clickable link
                  // to that loan — #loan/:loanNumber resolves it directly.
                  // A personal-loan ("PL-00012") or investment ("INV-00003")
                  // reference links the same way — both detail pages resolve
                  // their number to the id. A plain cash_movement row (e.g. a loan top-up) carries no
                  // Reference at all — its loan number instead sits inside
                  // Description ("Loan top-up — LN-00048"), same shape
                  // Cash.tsx's own LOAN_NUMBER_RE parses.
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
                      {r.customerId ? (
                        <LedgerRefLink kind="customer" id={r.customerId} label={r.customerName || "Customer"} />
                      ) : null}
                      <CategoryChip text={r.description} categoryIds={categoryIds} />
                    </div>
                  </td>
                                        {mode !== "Cash" && (
                      <td>{r.bankId ? <LedgerRefLink kind="bank" id={r.bankId} label={r.bankName || "Bank"} /> : "—"}</td>
                    )}
                    <td className="num" style={{ color: r.debitOrCredit === "debit" ? "var(--red)" : undefined }}>{r.debitOrCredit === "debit" ? fmt(r.amount) : "—"}</td>
                    <td className="num" style={{ color: r.debitOrCredit === "credit" ? "var(--green)" : undefined }}>{r.debitOrCredit === "credit" ? fmt(r.amount) : "—"}</td>
                    <td className="num">{fmt(r.runningBalance)}</td>
                  </tr>
                  );
                });
              })()}
            </tbody>
          </table>
        </div>
        <Pager page={page} total={total} pageSize={PARTY_PAGE_SIZE} onChange={setPage}>
          <FooterTotals aligned items={[
            { value: totals.debit, color: "var(--red)" },
            { value: totals.credit, color: "var(--green)" },
          ]} />
        </Pager>
      </div>
    </>
  );
}
