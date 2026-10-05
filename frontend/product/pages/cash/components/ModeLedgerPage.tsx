"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { fmt, fmtDate } from "@/product/utils/format";
import { ApiError } from "@/product/services/httpClient";
import { DatePicker } from "@/product/components/ui/DatePicker";
import { LedgerRefLink, CategoryChip } from "@/product/components/ui/LedgerRefLink";
import { useExpenseCategoryIds } from "@/product/hooks/useExpenseCategoryIds";
import { rememberedLedgerPage, useLedgerFocus } from "@/product/hooks/useLedgerFocus";
import { getModeLedger, downloadLedger, PARTY_PAGE_SIZE, type LedgerMode, type LedgerRowView } from "@/product/pages/cash/services/cashService";
import { Icon } from "@/product/components/Icon";
import { useAuth } from "@/product/providers/auth-context";
import { FooterTotals } from "@/product/components/ui/FooterTotals";
import { listActiveBranches, type BranchView } from "@/product/pages/branches/services/branchService";
import { useBranding } from "@/product/providers/BrandingProvider";
import { searchBanksPage, type BackendBank } from "@/product/pages/banks/services/bankService";
import { FilterPanel, type FilterCategory, type FilterValue } from "@/product/components/ui/FilterPanel";
import { routeHref } from "@/product/services/appRoutes";

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
  const [fromDate, setFromDate] = useState("");
  const [toDate, setToDate] = useState("");
  const [branches, setBranches] = useState<BranchView[]>([]);
  // Single-branch business: no branch filter — every row is its one branch.
  const { singleBranch } = useBranding();
  const [filters, setFilters] = useState<FilterValue>({});
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  // Server-side sums over every row matching the filters, not just this page.
  const [totals, setTotals] = useState({ debit: 0, credit: 0 });
  const [exporting, setExporting] = useState(false);

  const branchIds = Array.isArray(filters.branch) ? filters.branch : [];
  const bankValues = Array.isArray(filters.bank) ? filters.bank : [];
  const bankId = bankValues.length ? Number(bankValues[0]) : undefined;

  useEffect(() => {
    listActiveBranches().then(setBranches).catch(() => {});
  }, []);

  // Any filter change resets back to page 1; switching to another mode's
  // ledger (same component, new `mode`) starts on its remembered page.
  // Compared against the previous key so neither fires on mount.
  const filterKey = `${fromDate}|${toDate}|${JSON.stringify(branchIds)}|${bankId ?? ""}`;
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
      { fromDate: fromDate || undefined, toDate: toDate || undefined, branchIds: branchIds.length ? branchIds.map(Number) : undefined, bankId },
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
  }, [mode, page, fromDate, toDate, JSON.stringify(branchIds), bankId]);

  useEffect(() => { refresh(); }, [refresh]);
  useLedgerFocus("mode", !loading, [items]);

  async function onDownload() {
    setExporting(true);
    try {
      await downloadLedger("mode", mode, {
        fromDate: fromDate || undefined, toDate: toDate || undefined,
        branchIds: branchIds.length ? branchIds.map(Number) : undefined, bankId,
      });
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not download the ledger.");
    } finally {
      setExporting(false);
    }
  }

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
            searchBanksPage(search, p).then((res) => ({
              items: res.items.map((b: BackendBank) => ({ value: String(b.id), label: b.branch ? `${b.name} — ${b.branch}` : b.name })),
              hasMore: res.hasMore,
            })),
        }]
      : []),
  ];

  return (
    <>
      <div className="page-h">
        <div>
          <a href={routeHref("ledger")} style={{ fontSize: 13 }}>← Back</a>
          <h1>{mode} Ledger</h1>
          <p>{MODE_DESCRIPTION[mode]}</p>
        </div>
        <div className="sp" />
        {canExport && (
          <button className="btn ghost" disabled={exporting} onClick={onDownload} title="PDF of every transaction matching the current filters">
            <Icon name="download" /> {exporting ? "Preparing…" : "Download"}
          </button>
        )}
      </div>
      <hr className="gold-rule" />

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
            {(branches.length > 1 || mode !== "Cash") && (
              <FilterPanel categories={filterCategories} value={filters} onChange={setFilters} hideChips />
            )}
          </div>
        </div>
        <div className="tbl-wrap tbl-scroll">
          <table className="tbl" data-ledger-scope="mode" data-ledger-page={page}>
            <thead>
              <tr><th>Date</th><th>Description</th><th>Mode</th>{mode !== "Cash" && <th>Bank</th>}<th>Reference</th><th className="num">Debit</th><th className="num">Credit</th><th className="num">Balance</th></tr>
            </thead>
            <tbody>
              {loading ? (
                <tr><td colSpan={mode !== "Cash" ? 8 : 7} className="empty compact">Loading…</td></tr>
              ) : items.length === 0 ? (
                <tr><td colSpan={mode !== "Cash" ? 8 : 7} className="empty compact">No transactions found.</td></tr>
              ) : (() => {
                // Running balance over the currently loaded (paginated) page
                // only — same best-effort approach every other ledger table
                // in the app uses (Cash.tsx's Ledger tab, BranchLedgerModal),
                // not a true running balance across the whole filtered set.
                const chronological = [...items].reverse();
                let running = 0;
                const withBalance = chronological.map((r) => {
                  running += r.debitOrCredit === "debit" ? r.amount : -r.amount;
                  return { r, balance: running };
                });
                return withBalance.reverse().map(({ r, balance }) => {
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
                      {r.description || r.type}
                      <div style={{ display: "flex", flexWrap: "wrap", gap: 4, marginTop: 4 }}>
                        {r.customerId ? <LedgerRefLink kind="customer" id={r.customerId} label={r.customerName || "Customer"} /> : null}
                        <CategoryChip text={r.description} categoryIds={categoryIds} />
                      </div>
                    </td>
                    <td>{r.method || mode}</td>
                    {mode !== "Cash" && (
                      <td>{r.bankId ? <LedgerRefLink kind="bank" id={r.bankId} label={r.bankName || "Bank"} /> : "—"}</td>
                    )}
                    <td>
                      {loanRef ? (
                        <LedgerRefLink kind="loan" id={loanRef} label={r.reference || loanRef} />
                      ) : invRef ? (
                        <LedgerRefLink kind="investment" id={invRef} label={invRef} />
                      ) : plRef ? (
                        <LedgerRefLink kind="personalloan" id={plRef} label={plRef} />
                      ) : (
                        r.reference || "—"
                      )}
                    </td>
                    <td className="num" style={{ color: r.debitOrCredit === "debit" ? "var(--red)" : undefined }}>{r.debitOrCredit === "debit" ? fmt(r.amount) : "—"}</td>
                    <td className="num" style={{ color: r.debitOrCredit === "credit" ? "var(--green)" : undefined }}>{r.debitOrCredit === "credit" ? fmt(r.amount) : "—"}</td>
                    <td className="num">{fmt(balance)}</td>
                  </tr>
                  );
                });
              })()}
            </tbody>
          </table>
        </div>
        <Pager page={page} total={total} pageSize={PARTY_PAGE_SIZE} onChange={setPage}>
          <FooterTotals items={[
            { label: "Total Debit", value: totals.debit, color: "var(--red)" },
            { label: "Total Credit", value: totals.credit, color: "var(--green)" },
          ]} />
        </Pager>
      </div>
    </>
  );
}
