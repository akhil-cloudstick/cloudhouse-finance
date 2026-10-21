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

// Read-time classifications, not stored statuses — sent as `servicing`, not `status`; mutually exclusive.
const SERVICING_CATS: Partial<Record<string, "due_soon" | "overdue" | "defaulted">> = {
  "Due Soon": "due_soon",
  "Overdue": "overdue",
  "Defaulted": "defaulted",
};

export function LoansPage() {
  const { loans: allLoans, loading: providerLoading, error: providerError, refresh: refreshLoans } = useLoans();
  const { can } = useAuth();
  const basePageSize = useResponsivePageSize(15, 15);
  const { cards, size: pageSize, more } = useScrollPageSize(basePageSize);
  const showBranchFilter = useShowBranchFilter();
  const canCreateLoans = can("Loan_Management", "can_create_loan");
  // Dashboard KPI cards link here as `#loans/<category>` so the promised tab is actually open on arrival.
  const { arg: initialCatArg } = useAppRoute();
  const initialCat = initialCatArg ? decodeURIComponent(initialCatArg) : undefined;
  const [cats, setCats] = usePersistedState<string[]>("loans:cats", initialCat && CATS.includes(initialCat) && initialCat !== "All" ? [initialCat] : []);
  // A dashboard KPI link (#loans/<category>) wins over the remembered tab.
  useEffect(() => { if (initialCat && CATS.includes(initialCat)) setCats(initialCat === "All" ? [] : [initialCat]); }, [initialCat, setCats]);
  const [q, setQ] = usePersistedState("loans:q", "");
  const [fromDate, setFromDate] = usePersistedState("loans:from", "");
  const [toDate, setToDate] = usePersistedState("loans:to", "");
  const [savedBranchIds, setBranchIds] = usePersistedState<string[]>("loans:branches", []);
  // A hidden Branch filter must not keep narrowing rows with a stale saved selection.
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

  useEffect(() => { setPage(1); }, [catsKey, q, fromDate, toDate, branchKey, customerKey, pageSize]);

  // Refetches on every mount so this page doesn't render a stale app-mount snapshot after a loan changes elsewhere.
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
    // `allLoans` is a dependency for its identity only — keys this query to re-run on every provider refresh.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [catsKey, q, fromDate, toDate, branchKey, customerKey, page, allLoans, pageSize]);

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
  // `filtered` is null only until the first server response lands, so an empty result (total 0) still counts as known.
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
