"use client";

import { useCallback, useEffect, useState } from "react";
import { Icon } from "@/common/components/Icon";
import { useAuth } from "@/common/auth-context";
import { useModal } from "@/common/components/Modal";
import { ApiError } from "@/common/services/httpClient";
import { useIsSmallScreen, useResponsivePageSize } from "@/common/utils/responsive";
import { listPersonalLoansPage, type BackendPersonalLoan, type Frequency } from "@/modules/personal-loans/services/personalLoanService";
import { PersonalLoanRow } from "@/modules/personal-loans/components/PersonalLoanRow";
import { NewPersonalLoanModalContent } from "@/modules/personal-loans/components/NewPersonalLoanModal";

const FREQS: ("All" | Frequency)[] = ["All", "Daily", "Weekly", "Monthly"];

/* Personal Loans list — an unsecured, no-KYC loan product separate from the
 * Gold Loan module (see backend/internal/personalloan's package doc).
 * Search (loan # or customer name) and the frequency filter are both
 * server-side (GET /personal-loans?q=&frequency=&limit=&offset=), and the
 * table is paginated 10 rows at a time with Prev/Next — mirrors Loans.tsx's
 * convention exactly (debounced search, {items, hasMore} envelope with no
 * total-row count, so "Page N of M" isn't shown, just enable/disable Next). */
export function PersonalLoans() {
  const { can } = useAuth();
  const { openModal, closeModal } = useModal();
  const canCreate = can("Personal_Loan_Management", "can_create_personal_loan");
  const smallScreen = useIsSmallScreen();
  const pageSize = useResponsivePageSize(10, 7);

  const [freq, setFreq] = useState<"All" | Frequency>("All");
  const [q, setQ] = useState("");
  const [page, setPage] = useState(1);
  const [loans, setLoans] = useState<BackendPersonalLoan[]>([]);
  const [hasMore, setHasMore] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  // Any filter change resets back to page 1 rather than leaving the user
  // stranded on a page number the new filter may not have.
  useEffect(() => { setPage(1); }, [freq, q, pageSize]);

  const refresh = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const res = await listPersonalLoansPage({ page, q: q.trim() || undefined, frequency: freq === "All" ? undefined : freq, pageSize });
      setLoans(res?.items || []);
      setHasMore(!!res?.hasMore);
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "Could not load personal loans.");
    } finally {
      setLoading(false);
    }
  }, [page, q, freq, pageSize]);

  useEffect(() => {
    const handle = setTimeout(() => void refresh(), q ? 300 : 0);
    return () => clearTimeout(handle);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [page, freq, q, pageSize]);

  const totalPages = hasMore ? page + 1 : page;

  function openNewLoan() {
    openModal(<NewPersonalLoanModalContent onSaved={() => { closeModal(); setPage(1); void refresh(); }} />);
  }

  return (
    <>
      <div className="page-h" style={smallScreen ? { gap: 9, marginBottom: 10 } : { marginBottom: 12 }}>
        <div><h1>Personal Loans</h1><p>Small unsecured cash loans, repaid daily/weekly/monthly</p></div>
        <div className="sp" />
        <div className="search"><Icon name="search" /><input className="inp" placeholder="Search loan # or customer…" value={q} onChange={(e) => setQ(e.target.value)} /></div>
        {canCreate && <button className="btn" onClick={openNewLoan}><Icon name="plus" /> New Personal Loan</button>}
      </div>
      <hr className="gold-rule" style={{ margin: "4px 0 14px" }} />
      <div style={{ marginBottom: 14 }} className="tabs">
        {FREQS.map((f) => (
          <button key={f} className={f === freq ? "on" : ""} onClick={() => setFreq(f)}>{f}</button>
        ))}
      </div>
      {error && <div className="notice" style={{ marginBottom: 14 }}>{error}</div>}
      <div className="card"><div className="tbl-wrap tbl-scroll"><table className="tbl tbl-center">
        <thead><tr><th>Loan / Customer</th><th className="num">Principal</th><th className="num">Outstanding</th><th>Frequency</th><th>Status</th></tr></thead>
        <tbody>
          {loading ? (
            <tr><td colSpan={5} className="empty">Loading personal loans…</td></tr>
          ) : loans.length === 0 ? (
            <tr><td colSpan={5} className="empty">No personal loans in this category.</td></tr>
          ) : loans.map((l) => <PersonalLoanRow loan={l} key={l.id} />)}
        </tbody>
      </table></div>
      <div className="ft" style={{ display: "flex", alignItems: "center", gap: 10 }}>
        <button className="btn plain sm" disabled={page <= 1} onClick={() => setPage((p) => Math.max(1, p - 1))}>‹ Prev</button>
        <span style={{ fontSize: 12.5 }}>Page {page} of {totalPages}</span>
        <button className="btn plain sm" disabled={page >= totalPages} onClick={() => setPage((p) => Math.min(totalPages, p + 1))}>Next ›</button>
      </div>
      </div>
    </>
  );
}
