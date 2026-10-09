"use client";

import { usePersistedState } from "@/product/hooks/usePersistedState";
import { useCallback, useEffect, useState } from "react";
import { Icon } from "@/product/components/Icon";
import { useAuth } from "@/product/providers/auth-context";
import { useModal } from "@/product/components/Modal";
import { ApiError } from "@/product/services/httpClient";
import { useIsSmallScreen, useResponsivePageSize } from "@/product/utils/responsive";
import { listPersonalLoansPage, type BackendPersonalLoan, type Frequency } from "@/product/pages/personal-loans/services/personalLoanService";
import { PersonalLoanRow } from "@/product/pages/personal-loans/components/PersonalLoanRow";
import { NewPersonalLoanModalContent } from "@/product/pages/personal-loans/components/NewPersonalLoanModal";
import { FilterPanel, type FilterCategory, type FilterValue } from "@/product/components/ui/FilterPanel";

const FREQS: ("All" | Frequency)[] = ["All", "Daily", "Weekly", "Monthly"];
// Status filter — "Pending Approval"/"Rejected" only occur while the
// business has the personal_loan approval flow switched on.
const STATUS_OPTIONS = [
  { value: "Active", label: "Active" },
  { value: "Pending Approval", label: "Pending Approval" },
  { value: "Rejected", label: "Rejected" },
  { value: "Closed", label: "Closed" },
  { value: "Renewed", label: "Renewed" },
  { value: "Defaulted", label: "Defaulted" },
];

/* Personal Loans list — an unsecured, no-KYC loan product separate from the
 * Gold Loan module (see backend/internal/personalloan's package doc).
 * Search (loan # or customer name) and the frequency filter are both
 * server-side (GET /personal-loans?q=&frequency=&limit=&offset=), and the
 * table is paginated 10 (7 on a small screen) rows at a time with Prev/Next
 * — mirrors Loans.tsx's convention exactly, including using the backend's
 * real `total` row count for "Page N of M" rather than only ever knowing
 * whether one more page exists. */
export function PersonalLoans() {
  const { can } = useAuth();
  const { openModal, closeModal } = useModal();
  const canCreate = can("Personal_Loan_Management", "can_create_personal_loan");
  const smallScreen = useIsSmallScreen();
  const pageSize = useResponsivePageSize(15, 15);

  // Both filters are multi-select, stored (and sent to the API) as
  // comma-separated lists; "" means no filter.
  const [freq, setFreq] = usePersistedState<string>("personalloans:freq:multi", "");
  const [q, setQ] = usePersistedState("personalloans:q", "");
  const [status, setStatus] = usePersistedState("personalloans:status", "");
  const [page, setPage] = useState(1);
  // One grouped filter: Frequency and Status. Selections show as a count in
  // the panel, not as chips.
  const filterCategories: FilterCategory[] = [
    { key: "freq", label: "Frequency", kind: "static", options: FREQS.filter((f) => f !== "All").map((f) => ({ value: f, label: f })) },
    { key: "status", label: "Status", kind: "static", options: STATUS_OPTIONS },
  ];
  const filterValue: FilterValue = { freq: freq ? freq.split(",") : [], status: status ? status.split(",") : [] };
  const [loans, setLoans] = useState<BackendPersonalLoan[]>([]);
  const [hasMore, setHasMore] = useState(false);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  // Any filter change resets back to page 1 rather than leaving the user
  // stranded on a page number the new filter may not have.
  useEffect(() => { setPage(1); }, [freq, q, status, pageSize]);

  const refresh = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const res = await listPersonalLoansPage({ page, q: q.trim() || undefined, frequency: freq || undefined, status: status || undefined, pageSize });
      setLoans(res?.items || []);
      setHasMore(!!res?.hasMore);
      setTotal(res?.total || 0);
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "Could not load personal loans.");
    } finally {
      setLoading(false);
    }
  }, [page, q, freq, status, pageSize]);

  useEffect(() => {
    const handle = setTimeout(() => void refresh(), q ? 300 : 0);
    return () => clearTimeout(handle);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [page, freq, q, status, pageSize]);

  const knownTotal = total > 0;
  const totalPages = knownTotal ? Math.max(1, Math.ceil(total / pageSize)) : (hasMore ? page + 1 : page);
  const nextDisabled = knownTotal ? page >= totalPages : !hasMore;

  function openNewLoan() {
    // Wide: this modal can swap in the full RegisterCustomerModalContent
    // ("+ Add new customer" flow) inline, whose 3-column field rows need a
    // wide modal's width — see NewPersonalLoanModal.tsx's creatingCustomer
    // branch.
    openModal(<NewPersonalLoanModalContent onSaved={() => { closeModal(); setPage(1); void refresh(); }} />, true);
  }

  return (
    <>
      {/* Header/rule/tab spacing deliberately mirrors Loans.tsx — the two
        * pages sit next to each other in the sidebar and are the same
        * shape (title + search + filter chips + paginated table), so they
        * should not drift apart vertically. Keep them in step. */}
      <div className="page-h">
        <div><h1>Personal Loans</h1><p>Small unsecured cash loans, repaid daily/weekly/monthly</p></div>
        <div className="sp" />
        <div className="search"><Icon name="search" /><input className="inp" placeholder="Search loan # or customer…" title="Searches: loan number, customer name, customer code" value={q} onChange={(e) => setQ(e.target.value)} /></div>
        {canCreate && <button className="btn" onClick={openNewLoan}><Icon name="plus" /> New Personal Loan</button>}
      </div>
      <hr className="gold-rule" style={{ margin: smallScreen ? "4px 0 6px" : "4px 0 10px" }} />
      {error && <div className="notice" style={{ marginBottom: 14 }}>{error}</div>}
      <div style={{ display: "flex", justifyContent: "flex-end", marginBottom: 12 }}>
        <FilterPanel
          categories={filterCategories}
          value={filterValue}
          onChange={(next) => {
            setFreq(Array.isArray(next.freq) ? next.freq.join(",") : "");
            setStatus(Array.isArray(next.status) ? next.status.join(",") : "");
          }}
          hideChips
          hideClearAll
        />
      </div>
      <div className="card tbl-card tbl-card-fill tbl-rounded">
      <div className="tbl-wrap tbl-scroll"><table className="tbl tbl-center">
        <thead><tr><th>Loan / Customer</th><th className="num">Principal</th><th className="num">Outstanding</th><th>Frequency</th><th>Status</th></tr></thead>
        <tbody>
          {loading ? (
            <tr><td colSpan={5} className="empty">Loading personal loans…</td></tr>
          ) : loans.length === 0 ? (
            <tr><td colSpan={5} className="empty">No personal loans</td></tr>
          ) : loans.map((l) => <PersonalLoanRow loan={l} key={l.id} />)}
        </tbody>
      </table></div>
      <div className="ft" style={{ display: "flex", alignItems: "center", gap: 10 }}>
        <button className="btn plain sm" disabled={page <= 1} onClick={() => setPage((p) => Math.max(1, p - 1))}>‹ Prev</button>
        <span style={{ fontSize: 12.5 }}>Page {page} of {totalPages}</span>
        <button className="btn plain sm" disabled={nextDisabled} onClick={() => setPage((p) => (knownTotal ? Math.min(totalPages, p + 1) : p + 1))}>Next ›</button>
      </div>
      </div>
    </>
  );
}
