"use client";

import { usePersistedState } from "@/common/hooks/use-persisted-state";
import { useCallback, useEffect, useRef, useState } from "react";
import { Icon } from "@/common/components/Icon";
import { useAuth } from "@/common/providers/AuthProvider";
import { useModal } from "@/common/components/ModalProvider";
import { ApiError } from "@/common/services/httpClient";
import { useIsSmallScreen } from "@/common/utils/responsive";
import { listInvestmentsPage } from "@/modules/investments/services/investmentService";
import { type BackendInvestment, type InvestmentStatus } from "@/modules/investments/types/investment-types";
import { FilterPanel, type FilterCategory, type FilterValue } from "@/common/components/ui/FilterPanel";
import { InvestmentRow } from "@/modules/investments/components/InvestmentRow";
import { NewInvestmentModalContent } from "@/modules/investments/components/NewInvestmentModalContent";
import { InvestmentPlansModalContent } from "@/modules/investments/components/InvestmentPlansModalContent";

const STATUSES: ("All" | InvestmentStatus)[] = ["All", "Active", "Matured", "Closed", "Renewed"];
const PAGE_SIZE = 10;

/* Investments list — investor deposits managed separately from borrower
 * loans (see backend/internal/investment's package doc). Search (investment
 * # or investor name) and the status filter are both server-side (GET
 * /investments?q=&status=&limit=&offset=). Scroll-paginated: 10 rows at a
 * time, the next 10 fetched as the table is scrolled to its end. */
export function InvestmentsPage() {
  const { can } = useAuth();
  const { openModal, closeModal } = useModal();
  const canCreate = can("Investment_Management", "can_create_investment");
  const canUpdate = can("Investment_Management", "can_update_investment");
  const smallScreen = useIsSmallScreen();

  const [status, setStatus] = usePersistedState<"All" | InvestmentStatus>("investments:status", "All");
  const [q, setQ] = usePersistedState("investments:q", "");
  const [page, setPage] = useState(1);
  // The status tabs became one grouped filter (single choice).
  const filterCategories: FilterCategory[] = [
    { key: "status", label: "Status", kind: "static", singleSelect: true, options: STATUSES.filter((st) => st !== "All").map((st) => ({ value: st, label: st })) },
  ];
  const filterValue: FilterValue = { status: status === "All" ? [] : [status] };
  const [investments, setInvestments] = useState<BackendInvestment[]>([]);
  const [hasMore, setHasMore] = useState(false);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState("");
  const [reloadKey, setReloadKey] = useState(0);
  const wrapRef = useRef<HTMLDivElement>(null);

  // A new filter/search restarts from page 1 (search debounced). Skipped on
  // mount — the fetch effect below already loads page 1 then.
  const mounted = useRef(false);
  useEffect(() => {
    if (!mounted.current) { mounted.current = true; return; }
    const handle = setTimeout(() => { setPage(1); setReloadKey((k) => k + 1); }, q ? 300 : 0);
    return () => clearTimeout(handle);
  }, [status, q]);

  // Page 1 replaces the rows (new filter/search, or a reload); every later
  // page appends — scrolling to the end of the table fetches the next 10.
  const fetchPage = useCallback(async (p: number) => {
    if (p === 1) setLoading(true); else setLoadingMore(true);
    setError("");
    try {
      const res = await listInvestmentsPage({ page: p, q: q.trim() || undefined, status, pageSize: PAGE_SIZE });
      const items = res?.items || [];
      setInvestments((prev) => (p === 1 ? items : [...prev, ...items]));
      if (p === 1 && wrapRef.current) wrapRef.current.scrollTop = 0;
      setHasMore(!!res?.hasMore);
      setTotal(res?.total || 0);
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "Could not load investments.");
    } finally {
      setLoading(false);
      setLoadingMore(false);
    }
  }, [q, status]);

  useEffect(() => {
    void fetchPage(page);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [page, reloadKey]);

  const refresh = () => { setPage(1); setReloadKey((k) => k + 1); };

  function loadNextPage() {
    if (hasMore && !loading && !loadingMore) setPage((p) => p + 1);
  }

  function onWrapScroll() {
    const el = wrapRef.current;
    if (el && el.scrollHeight - el.scrollTop - el.clientHeight < 48) loadNextPage();
  }

  // A batch too short to overflow the table never fires onScroll, so keep
  // loading until the rows actually scroll or the server runs out.
  useEffect(() => {
    const el = wrapRef.current;
    if (el && el.scrollHeight <= el.clientHeight) loadNextPage();
  }, [investments, hasMore, loading, loadingMore]); // eslint-disable-line react-hooks/exhaustive-deps

  function openNewInvestment() {
    openModal(<NewInvestmentModalContent onSaved={() => { closeModal(); refresh(); }} />);
  }
  function openPlans() {
    openModal(<InvestmentPlansModalContent onChanged={refresh} />, true);
  }

  return (
    <>
      {/* Header/rule/tab spacing deliberately mirrors Loans.tsx — see the
        * same note in PersonalLoans.tsx. Keep the three in step. */}
      <div className="page-h">
        <div><h1>Investments</h1><p>Investor deposits, interest payout schedules and maturity</p></div>
        <div className="sp" />
        <div className="search"><Icon name="search" /><input className="inp" placeholder="Search investment # or investor…" title="Searches: investment number, investor name, investor code" value={q} onChange={(e) => setQ(e.target.value)} /></div>
        {canUpdate && <button className="btn plain" onClick={openPlans}>Manage Plans</button>}
        {canCreate && <button className="btn" onClick={openNewInvestment}><Icon name="plus" /> New Investment</button>}
      </div>
      <hr className="gold-rule" style={{ margin: smallScreen ? "4px 0 6px" : "4px 0 10px" }} />
      {error && <div className="notice" style={{ marginBottom: 14 }}>{error}</div>}
      {/* `tbl-card`, not a bare `.card`: this is a `.tbl-wrap` + `.ft` pair,
        * the shape that class exists for — without it the footer falls back
        * to the sticky-overlay behavior and the card doesn't size to its own
        * rows, which is why this table sat differently to Loans'. */}
      <div style={{ display: "flex", justifyContent: "flex-end", marginBottom: 12 }}>
        <FilterPanel
          categories={filterCategories}
          value={filterValue}
          onChange={(next) => setStatus(((Array.isArray(next.status) ? next.status[0] : undefined) as InvestmentStatus | undefined) || "All")}
          hideChips
          hideClearAll
        />
      </div>
      <div className="card tbl-card tbl-card-fill tbl-rounded">
      <div className="tbl-wrap tbl-scroll" ref={wrapRef} onScroll={onWrapScroll}><table className="tbl tbl-center tbl-cards">
        <thead><tr><th>Investment / Investor</th><th className="num">Principal</th><th>Rate</th><th>Maturity</th><th>Status</th></tr></thead>
        <tbody>
          {loading ? (
            <tr><td colSpan={5} className="empty">Loading investments…</td></tr>
          ) : investments.length === 0 ? (
            <tr><td colSpan={5} className="empty">No investments</td></tr>
          ) : investments.map((i) => <InvestmentRow investment={i} key={i.id} />)}
          {loadingMore && <tr><td colSpan={5} className="empty compact">Loading more…</td></tr>}
        </tbody>
      </table></div>
      <div className="ft" style={{ fontSize: 12.5, color: "var(--muted)" }}>
        Showing {investments.length} of {total || investments.length}{hasMore ? " — scroll for more" : ""}{hasMore && <button className="btn plain sm tbl-cards-more" style={{ marginLeft: 10 }} disabled={loadingMore} onClick={loadNextPage}>Load more</button>}
      </div>
      </div>
    </>
  );
}
