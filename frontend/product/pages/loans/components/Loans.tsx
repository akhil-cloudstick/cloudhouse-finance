"use client";

import { useEffect, useState } from "react";
import { useLoans } from "@/product/pages/loans/store/LoansProvider";
import { LoanRow } from "@/product/pages/loans/components/LoanRow";
import { Icon } from "@/product/components/Icon";
import { useAuth } from "@/product/providers/auth-context";
import { useAppRoute } from "@/product/hooks/useAppRoute";
import { listLoansPage, type LoanView } from "@/product/pages/loans/services/loanService";
import { useResponsivePageSize, useIsSmallScreen } from "@/product/utils/responsive";
import { routeHref } from "@/product/services/appRoutes";
import { DatePicker } from "@/product/components/ui/DatePicker";

const CATS = ["All", "Active", "Due Soon", "Overdue", "Defaulted", "Pending Approval", "Auction Eligible", "Closed", "Rejected"];

/* "Due Soon"/"Overdue"/"Defaulted" are read-time classifications (see
 * loan/accrual.go's enrichStatusFlags), not stored statuses, so they are not
 * sent as `status`. They go to GET /loans as `servicing`, and the server
 * applies the same rules and paginates (see loan/servicing_filter.go). The
 * three are mutually exclusive: Overdue leaves out defaulted loans, and
 * Defaulted leaves out loans already in the auction pipeline. */
const SERVICING_CATS: Partial<Record<string, "due_soon" | "overdue" | "defaulted">> = {
  "Due Soon": "due_soon",
  "Overdue": "overdue",
  "Defaulted": "defaulted",
};

/* Ported from legacy/app.js's `renderLoans()`. Backed by the real loan API:
 * the initial list comes from LoansProvider, but once a status filter or
 * search term is applied, this re-queries `GET /loans` directly (via
 * listLoans's `q`/`status` params) so filtering happens server-side instead
 * of only scanning the client's already-loaded page. */
export function Loans() {
  const { loans: allLoans, loading: providerLoading, error: providerError, refresh: refreshLoans } = useLoans();
  const { can } = useAuth();
  const pageSize = useResponsivePageSize(15, 15);
  const smallScreen = useIsSmallScreen();
  // Hidden rather than shown as a form that can only fail with a 403.
  const canCreateLoans = can("Loan_Management", "can_create_loan");
  // Dashboard KPI cards ("Active Loans", "Due Soon", etc.) link here as
  // `#loans/<category>` so the tab they promise is the tab that's actually
  // open on arrival, instead of always landing on "All".
  const { arg: initialCatArg } = useAppRoute();
  const initialCat = initialCatArg ? decodeURIComponent(initialCatArg) : undefined;
  const [cat, setCat] = useState(() => (initialCat && CATS.includes(initialCat) ? initialCat : "All"));
  const [q, setQ] = useState("");
  const [fromDate, setFromDate] = useState("");
  const [toDate, setToDate] = useState("");
  // Small-screen category tabs collapse behind a "Filter" button; opening it
  // hides the date-range filter and shows the tabs, and picking a tab
  // collapses the tabs back and reveals the date filter again.
  const [tabsExpanded, setTabsExpanded] = useState(false);
  const [page, setPage] = useState(1);
  const [filtered, setFiltered] = useState<LoanView[] | null>(null);
  const [hasMore, setHasMore] = useState(false);
  const [serverTotal, setServerTotal] = useState(0);
  const [searching, setSearching] = useState(false);
  const [searchError, setSearchError] = useState("");

  const servicing = SERVICING_CATS[cat];

  // Any filter change resets back to page 1 rather than leaving the user
  // stranded on a page number the new filter may not have.
  useEffect(() => { setPage(1); }, [cat, q, fromDate, toDate, pageSize]);

  // LoansProvider fetches once when the app shell mounts and is only
  // re-fetched by pages that explicitly call refresh() (LoanDetail, Requests,
  // NewLoan). Anything else that moves a loan — an auction sale, a bank
  // re-pledge, or plain server-side interest accrual — left this page
  // rendering the app-mount snapshot until a full browser reload. <Loans/> is
  // remounted on every route change (see app/app/page.tsx's View), so
  // refreshing here gives the list the same on-demand round trip opening a
  // loan already gets.
  useEffect(() => { refreshLoans(); }, [refreshLoans]);

  useEffect(() => {
    let cancelled = false;
    setSearching(true);
    const handle = setTimeout(() => {
      listLoansPage({
        status: cat === "All" || servicing ? undefined : cat,
        servicing,
        q: q.trim() || undefined,
        from: fromDate || undefined,
        to: toDate || undefined,
        page,
        limit: pageSize,
      })
        .then((res) => { if (!cancelled) { setFiltered(res.items); setHasMore(res.hasMore); setServerTotal(res.total); setSearchError(""); } })
        .catch((e) => { if (!cancelled) setSearchError(e instanceof Error ? e.message : "Search failed."); })
        .finally(() => { if (!cancelled) setSearching(false); });
    }, 300);
    return () => { cancelled = true; clearTimeout(handle); };
    // `allLoans` is a dependency for its identity, not its value: this branch
    // renders `filtered` (a server-side listLoansPage snapshot) rather than
    // the provider list, and nothing was re-running this query when a loan
    // changed. Recording a payment or clearing an approval called
    // refreshLoans(), which swapped in a fresh provider array but left
    // `filtered` pinned to the pre-change rows — so the table only caught up on a browser reload.
    // Keying off the new array identity re-issues the filtered query in step
    // with every provider refresh.
  }, [cat, q, fromDate, toDate, page, servicing, allLoans, pageSize]);

  const loading = filtered === null ? providerLoading : searching;
  const error = searchError || providerError;
  const rows: LoanView[] = filtered ?? [];
  const totalPages = Math.max(1, Math.ceil(serverTotal / pageSize));
  // `filtered` is null only until the first server response lands, so a
  // legitimately empty result (total 0) still counts as a known total.
  const knownTotal = filtered !== null;
  const nextDisabled = knownTotal ? page >= totalPages : !hasMore;

  return (
    <>
      <div className="page-h" >
        <div><h1>Loans</h1><p>All customer loans with search and status filters</p></div>
        <div className="sp" />
        <div className="search"><Icon name="search" /><input className="inp" placeholder="Search loan ID or customer…" title="Searches: loan number, customer name, customer code" value={q} onChange={(e) => setQ(e.target.value)} /></div>
        {canCreateLoans && <a className="btn" href={routeHref("newloan")}><Icon name="plus" /> New Gold Loan</a>}
      </div>
      <hr className="gold-rule" style={{ margin: "4px 0 10px" }} />
      <div className={`loans-filter-row${smallScreen ? " small" : ""}`} style={{ marginTop: 4, marginBottom: 14 }}>
        <div className="tabs loans-filter-toggle-tabs">
          <button type="button" className="loans-filter-toggle" onClick={() => setTabsExpanded((v) => !v)}>
            <Icon name="filter" /> Filter
          </button>
        </div>
        <div className={`tabs loans-cat-tabs${tabsExpanded ? " expanded" : ""}`}>
          {CATS.map((c) => (
            <button
              key={c}
              className={c === cat ? "on" : ""}
              onClick={() => { setCat(c); setTabsExpanded(false); }}
            >
              {c}
            </button>
          ))}
        </div>
        <div className={`loans-date-filter${tabsExpanded ? " collapsed" : ""}`}>
          <DatePicker value={fromDate} onChange={setFromDate} placeholder="From date…" max={toDate || undefined} />
          <span className="loans-date-sep">to</span>
          <DatePicker value={toDate} onChange={setToDate} placeholder="To date…" min={fromDate || undefined} />
          {(fromDate || toDate) && (
            <button type="button" className="btn plain sm" onClick={() => { setFromDate(""); setToDate(""); }}>
              Clear
            </button>
          )}
        </div>
      </div>
      {error && <div className="notice" style={{ marginBottom: 14 }}>{error}</div>}
      <div className="card tbl-card tbl-card-fill"><div className="tbl-wrap tbl-scroll"><table className="tbl tbl-center">
        <thead><tr><th>Loan / Customer</th><th>Scheme</th><th>Opened / Due</th><th className="num">Principal</th><th className="num">Outstanding</th><th>Pledge</th><th>Status</th></tr></thead>
        <tbody>
          {loading ? (
            <tr><td colSpan={7} className="empty">Loading loans…</td></tr>
          ) : rows.length === 0 ? (
            <tr><td colSpan={7} className="empty">No loans in this category.</td></tr>
          ) : rows.map((l) => <LoanRow loan={l} key={l.id} />)}
        </tbody>
      </table></div>
      <div className="ft" style={{ display: "flex", alignItems: "center", gap: 10 }}>
        <button className="btn plain sm" disabled={page <= 1} onClick={() => setPage((p) => Math.max(1, p - 1))}>‹ Prev</button>
        <span style={{ fontSize: 12.5 }}>Page {page}{knownTotal ? ` of ${totalPages}` : ""}</span>
        <button className="btn plain sm" disabled={nextDisabled} onClick={() => setPage((p) => (knownTotal ? Math.min(totalPages, p + 1) : p + 1))}>Next ›</button>
      </div>
      </div>
    </>
  );
}
