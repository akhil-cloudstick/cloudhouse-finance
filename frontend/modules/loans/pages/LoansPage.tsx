"use client";

import { ScrollSentinel } from "@/common/components/ui/ScrollSentinel";
import { usePersistedState } from "@/common/hooks/use-persisted-state";
import { useEffect, useState } from "react";
import { useLoans } from "@/modules/loans/store/LoansProvider";
import { LoanRow } from "@/modules/loans/components/LoanRow";
import { Icon } from "@/common/components/Icon";
import { useAuth } from "@/common/providers/AuthProvider";
import { useAppRoute } from "@/common/hooks/use-app-route";
import { listLoansPage } from "@/modules/loans/services/loanService";
import { type LoanView, type ServicingClass } from "@/modules/loans/types/loan-types";
import { useResponsivePageSize, useScrollPageSize } from "@/common/utils/responsive";
import { routeHref } from "@/common/services/appRoutes";
import { FilterPanel, type FilterCategory, type FilterValue } from "@/common/components/ui/FilterPanel";
import { listActiveBranches } from "@/modules/branches/services/branchService";
import { type BranchView } from "@/modules/branches/types/branch-types";
import { listCustomersPage } from "@/modules/customers/services/customerService";
import { useShowBranchFilter } from "@/common/hooks/use-branch-switch";

// Stable empty selection for a hidden Branch filter (see useShowBranchFilter).
const NO_BRANCHES: string[] = [];

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
export function LoansPage() {
  const { loans: allLoans, loading: providerLoading, error: providerError, refresh: refreshLoans } = useLoans();
  const { can } = useAuth();
  const basePageSize = useResponsivePageSize(15, 15);
  const { cards, size: pageSize, more } = useScrollPageSize(basePageSize);
  // No branch filter in a single-branch business, or while the global
  // branch selector already scopes the page (see useShowBranchFilter).
  const showBranchFilter = useShowBranchFilter();
  // Hidden rather than shown as a form that can only fail with a 403.
  const canCreateLoans = can("Loan_Management", "can_create_loan");
  // Dashboard KPI cards ("Active Loans", "Due Soon", etc.) link here as
  // `#loans/<category>` so the tab they promise is the tab that's actually
  // open on arrival, instead of always landing on "All".
  const { arg: initialCatArg } = useAppRoute();
  const initialCat = initialCatArg ? decodeURIComponent(initialCatArg) : undefined;
  const [cats, setCats] = usePersistedState<string[]>("loans:cats", initialCat && CATS.includes(initialCat) && initialCat !== "All" ? [initialCat] : []);
  // A dashboard KPI link (#loans/<category>) wins over the remembered tab.
  useEffect(() => { if (initialCat && CATS.includes(initialCat)) setCats(initialCat === "All" ? [] : [initialCat]); }, [initialCat, setCats]);
  const [q, setQ] = usePersistedState("loans:q", "");
  const [fromDate, setFromDate] = usePersistedState("loans:from", "");
  const [toDate, setToDate] = usePersistedState("loans:to", "");
  const [savedBranchIds, setBranchIds] = usePersistedState<string[]>("loans:branches", []);
  // A hidden Branch filter must not keep narrowing rows with a stale saved
  // selection (it would intersect the global branch to an empty page).
  const branchIds = showBranchFilter ? savedBranchIds : NO_BRANCHES;
  const [customerIds, setCustomerIds] = usePersistedState<string[]>("loans:customers", []);
  const [branches, setBranches] = useState<BranchView[]>([]);
  useEffect(() => { listActiveBranches().then(setBranches).catch(() => {}); }, []);
  const [page, setPage] = useState(1);
  const [filtered, setFiltered] = useState<LoanView[] | null>(null);
  const [hasMore, setHasMore] = useState(false);
  const [serverTotal, setServerTotal] = useState(0);
  const [searching, setSearching] = useState(false);
  const [searchError, setSearchError] = useState("");

  const servicing = cats.map((c) => SERVICING_CATS[c]).filter((s): s is ServicingClass => !!s);
  const storedStatuses = cats.filter((c) => !SERVICING_CATS[c]);
  const catsKey = cats.join("|");
  const branchKey = branchIds.join(",");
  const customerKey = customerIds.join(",");

  // Any filter change resets back to page 1 rather than leaving the user
  // stranded on a page number the new filter may not have.
  useEffect(() => { setPage(1); }, [catsKey, q, fromDate, toDate, branchKey, customerKey, pageSize]);

  // LoansProvider fetches once when the app shell mounts and is only
  // re-fetched by pages that explicitly call refresh() (LoanDetail, Requests,
  // NewLoan). Anything else that moves a loan — an auction sale, a bank
  // re-pledge, or plain server-side interest accrual — left this page
  // rendering the app-mount snapshot until a full browser reload. <Loans/> is
  // remounted on every route change (see app/(product)/app/page.tsx's View), so
  // refreshing here gives the list the same on-demand round trip opening a
  // loan already gets.
  useEffect(() => { refreshLoans(); }, [refreshLoans]);

  useEffect(() => {
    let cancelled = false;
    setSearching(true);
    const handle = setTimeout(() => {
      listLoansPage({
        status: storedStatuses,
        servicing,
        q: q.trim() || undefined,
        branchId: branchIds.map(Number),
        customerId: customerIds.map(Number),
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
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [catsKey, q, fromDate, toDate, branchKey, customerKey, page, allLoans, pageSize]);

  // One grouped filter (same FilterPanel the ledger pages use) replacing the
  // old status tab row + standalone date pickers. Every section is
  // multi-select: a loan matches any selected value within a section.
  const filterCategories: FilterCategory[] = [
    {
      key: "status", label: "Status", kind: "static", searchHint: "Searches: loan status",
      options: CATS.filter((c) => c !== "All").map((c) => ({ value: c, label: c })),
    },
    ...(!showBranchFilter ? [] : [{
      key: "branch", label: "Branch", kind: "static" as const, searchHint: "Searches: branch name",
      options: branches.map((b) => ({ value: String(b.id), label: b.name })),
    }]),
    {
      key: "customer", label: "Customer", kind: "async" as const, searchHint: "Searches: customer name, customer code, phone",
      fetchOptions: (search: string, p: number) =>
        listCustomersPage(search, p, { branchIds: branchIds.length ? branchIds : undefined }, 20).then((res) => ({
          items: res.items.map((c) => ({ value: String(c.id), label: `${c.name} (${c.code})` })),
          hasMore: res.hasMore,
        })),
    },
    { key: "__date", label: "Date", kind: "date" as const },
  ];
  const filterValue: FilterValue = {
    status: cats,
    branch: branchIds,
    customer: customerIds,
    __dateFrom: fromDate || undefined,
    __dateTo: toDate || undefined,
  };

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
      {error && <div className="notice" style={{ marginBottom: 14 }}>{error}</div>}
      <div style={{ display: "flex", justifyContent: "flex-end", marginBottom: 12 }}>
        <FilterPanel
          categories={filterCategories}
          value={filterValue}
          onChange={(next) => {
            setCats(Array.isArray(next.status) ? next.status.filter((st) => CATS.includes(st)) : []);
            setBranchIds(Array.isArray(next.branch) ? next.branch : []);
            setCustomerIds(Array.isArray(next.customer) ? next.customer : []);
            setFromDate(next.__dateFrom || "");
            setToDate(next.__dateTo || "");
          }}
          hideChips
          hideClearAll
        />
      </div>
      <div className="card tbl-card tbl-card-fill tbl-rounded">
      <div className="tbl-wrap tbl-scroll"><table className="tbl tbl-center loans-tbl tbl-cards">
        <thead><tr><th>Loan / Customer</th><th>Scheme</th><th>Opened / Due</th><th className="num">Principal</th><th className="num">Outstanding</th><th>Pledge</th><th>Status</th></tr></thead>
        <tbody>
          {loading && !(cards && rows.length > 0) ? (
            <tr><td colSpan={7} className="empty">Loading loans…</td></tr>
          ) : rows.length === 0 ? (
            <tr><td colSpan={7} className="empty">No loans in this category.</td></tr>
          ) : rows.map((l) => <LoanRow loan={l} key={l.id} />)}
        </tbody>
      </table></div>
      <ScrollSentinel enabled={cards && (!nextDisabled)} onVisible={more} watch={rows.length} />
      <div className="ft ft-scroll-hide" style={{ display: "flex", alignItems: "center", gap: 10 }}>
        <button className="btn plain sm" disabled={page <= 1} onClick={() => setPage((p) => Math.max(1, p - 1))}>‹ Prev</button>
        <span style={{ fontSize: 12.5 }}>Page {page}{knownTotal ? ` of ${totalPages}` : ""}</span>
        <button className="btn plain sm" disabled={nextDisabled} onClick={() => setPage((p) => (knownTotal ? Math.min(totalPages, p + 1) : p + 1))}>Next ›</button>
      </div>
      </div>
    </>
  );
}
