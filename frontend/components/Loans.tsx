"use client";

import { useEffect, useState } from "react";
import { useLoans } from "@/lib/LoansProvider";
import { LoanRow } from "@/components/LoanRow";
import { Icon } from "@/lib/icons";
import { useAuth } from "@/lib/auth-context";
import { listLoans, type LoanView } from "@/lib/loansApi";

const CATS = ["All", "Active", "Due Soon", "Overdue", "Defaulted", "Pending Approval", "Auction Eligible", "Closed"];

/* "Due Soon"/"Overdue"/"Defaulted" are computed read-time flags (isDueSoon/
 * isOverdue/isDefaulted, see loan/accrual.go's enrichStatusFlags), NOT
 * values of the persisted Loan.Status field — nothing ever sets Status to
 * those strings. So these three categories filter the already-loaded list
 * client-side instead of being sent to the server's `status` query param
 * (which only matches Loan.Status exactly). */
const COMPUTED_CATS: Partial<Record<string, (l: LoanView) => boolean>> = {
  "Due Soon": (l) => l.isDueSoon,
  /* Past term AND actually in arrears. A loan whose interest is paid off is
   * returned as status "Active" (refreshServicingStatus in loan/accrual.go)
   * even though isOverdue stays true, and listing it under Overdue would put
   * a paying customer back in the collections worklist. */
  "Overdue": (l) => l.isOverdue && l.status !== "Active",
  "Defaulted": (l) => l.isDefaulted,
};

/* Ported from legacy/app.js's `renderLoans()`. Backed by the real loan API:
 * the initial list comes from LoansProvider, but once a status filter or
 * search term is applied, this re-queries `GET /loans` directly (via
 * listLoans's `q`/`status` params) so filtering happens server-side instead
 * of only scanning the client's already-loaded page — except for the
 * computed-flag categories above, which filter client-side (see
 * COMPUTED_CATS). */
export function Loans() {
  const { loans: allLoans, loading: providerLoading, error: providerError, refresh: refreshLoans } = useLoans();
  const { role } = useAuth();
  // Cashier is outside the loan creation/approval flow — the backend
  // already 403s a Cashier's POST /loans, so hide the button rather than
  // let them click into a form that can only ever fail.
  const canCreateLoans = role !== "Cashier";
  const [cat, setCat] = useState("All");
  const [q, setQ] = useState("");
  const [filtered, setFiltered] = useState<LoanView[] | null>(null);
  const [searching, setSearching] = useState(false);
  const [searchError, setSearchError] = useState("");

  const computedPredicate = COMPUTED_CATS[cat];

  // LoansProvider fetches once when the app shell mounts and is only
  // re-fetched by pages that explicitly call refresh() (LoanDetail, Requests,
  // NewLoan). Anything else that moves a loan — an auction sale, a bank
  // re-pledge, or plain server-side interest accrual — left this page
  // rendering the app-mount snapshot until a full browser reload. <Loans/> is
  // remounted on every hash route change (see app/app/page.tsx's View), so
  // refreshing here gives the list the same on-demand round trip opening a
  // loan already gets.
  useEffect(() => { refreshLoans(); }, [refreshLoans]);

  useEffect(() => {
    // Due Soon/Overdue/Defaulted filter LoansProvider's already-loaded list
    // client-side (see COMPUTED_CATS above) rather than sending `cat` to the
    // server — but that meant switching to one of these tabs did nothing
    // but re-render whatever was fetched on mount, going stale the moment a
    // loan crosses its due date or clears its arrears while the page sits
    // open. Re-fetch on tab switch so these tabs get the same on-demand
    // round trip every other tab does.
    if (computedPredicate) refreshLoans();
  }, [cat, computedPredicate, refreshLoans]);

  useEffect(() => {
    if (computedPredicate || (cat === "All" && !q.trim())) {
      setFiltered(null);
      return;
    }
    let cancelled = false;
    setSearching(true);
    const handle = setTimeout(() => {
      listLoans({ status: cat === "All" ? undefined : cat, q: q.trim() || undefined })
        .then((list) => { if (!cancelled) { setFiltered(list); setSearchError(""); } })
        .catch((e) => { if (!cancelled) setSearchError(e instanceof Error ? e.message : "Search failed."); })
        .finally(() => { if (!cancelled) setSearching(false); });
    }, 300);
    return () => { cancelled = true; clearTimeout(handle); };
    // `allLoans` is a dependency for its identity, not its value: this branch
    // renders `filtered` (a server-side listLoans snapshot) rather than the
    // provider list, and nothing was re-running this query when a loan
    // changed. Recording a payment or clearing an approval called
    // refreshLoans(), which swapped in a fresh provider array but left
    // `filtered` pinned to the pre-change rows — so with any tab but "All" or
    // a search term present, the table only caught up on a browser reload.
    // Keying off the new array identity re-issues the filtered query in step
    // with every provider refresh.
  }, [cat, q, computedPredicate, allLoans]);

  const loading = filtered === null ? providerLoading : searching;
  const error = searchError || providerError;
  let rows = filtered ?? allLoans;
  if (computedPredicate) {
    rows = rows.filter(computedPredicate);
    if (q.trim()) {
      const needle = q.trim().toLowerCase();
      rows = rows.filter((l) => l.id.toLowerCase().includes(needle) || l.customerName.toLowerCase().includes(needle));
    }
  }

  return (
    <>
      <div className="page-h">
        {/* <div><h1>Loans</h1><p>All customer loans with search and status filters</p></div> */}
        <div className="sp" />
        <div className="search"><Icon name="search" /><input className="inp" placeholder="Search loan ID or customer…" value={q} onChange={(e) => setQ(e.target.value)} /></div>
        {canCreateLoans && <a className="btn" href="#newloan"><Icon name="plus" /> New Gold Loan</a>}
      </div>
      <hr className="gold-rule" />
      <div style={{ marginBottom: 14 }} className="tabs">
        {CATS.map((c) => (
          <button key={c} className={c === cat ? "on" : ""} onClick={() => setCat(c)}>{c}</button>
        ))}
      </div>
      {error && <div className="notice" style={{ marginBottom: 14 }}>{error}</div>}
      <div className="card"><div className="tbl-wrap"><table className="tbl">
        <thead><tr><th>Loan / Customer</th><th>Scheme</th><th>Opened / Due</th><th className="num">Principal</th><th className="num">Outstanding</th><th>Pledge</th><th>Status</th></tr></thead>
        <tbody>
          {loading ? (
            <tr><td colSpan={7} className="empty">Loading loans…</td></tr>
          ) : rows.length === 0 ? (
            <tr><td colSpan={7} className="empty">No loans in this category.</td></tr>
          ) : rows.map((l) => <LoanRow loan={l} key={l.id} />)}
        </tbody>
      </table></div></div>
    </>
  );
}
