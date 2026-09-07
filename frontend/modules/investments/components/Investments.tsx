"use client";

import { useCallback, useEffect, useState } from "react";
import { Icon } from "@/common/components/Icon";
import { useAuth } from "@/common/auth-context";
import { useModal } from "@/common/components/Modal";
import { ApiError } from "@/common/services/httpClient";
import { listInvestmentsPage, type BackendInvestment, type InvestmentStatus } from "@/modules/investments/services/investmentService";
import { InvestmentRow } from "@/modules/investments/components/InvestmentRow";
import { NewInvestmentModalContent } from "@/modules/investments/components/NewInvestmentModal";
import { InvestmentPlansModalContent } from "@/modules/investments/components/InvestmentPlansModal";

const STATUSES: ("All" | InvestmentStatus)[] = ["All", "Active", "Matured", "Closed", "Renewed"];

/* Investments list — investor deposits managed separately from borrower
 * loans (see backend/internal/investment's package doc). Search (investment
 * # or investor name) and the status filter are both server-side (GET
 * /investments?q=&status=&limit=&offset=), table paginated 10 rows at a
 * time — mirrors personal-loans/components/PersonalLoans.tsx exactly. */
export function Investments() {
  const { can } = useAuth();
  const { openModal, closeModal } = useModal();
  const canCreate = can("Investment_Management", "can_create_investment");
  const canUpdate = can("Investment_Management", "can_update_investment");

  const [status, setStatus] = useState<"All" | InvestmentStatus>("All");
  const [q, setQ] = useState("");
  const [page, setPage] = useState(1);
  const [investments, setInvestments] = useState<BackendInvestment[]>([]);
  const [hasMore, setHasMore] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => { setPage(1); }, [status, q]);

  const refresh = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const res = await listInvestmentsPage({ page, q: q.trim() || undefined, status });
      setInvestments(res?.items || []);
      setHasMore(!!res?.hasMore);
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "Could not load investments.");
    } finally {
      setLoading(false);
    }
  }, [page, q, status]);

  useEffect(() => {
    const handle = setTimeout(() => void refresh(), q ? 300 : 0);
    return () => clearTimeout(handle);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [page, status, q]);

  const totalPages = hasMore ? page + 1 : page;

  function openNewInvestment() {
    openModal(<NewInvestmentModalContent onSaved={() => { closeModal(); setPage(1); void refresh(); }} />);
  }
  function openPlans() {
    openModal(<InvestmentPlansModalContent onChanged={() => void refresh()} />, true);
  }

  return (
    <>
      <div className="page-h">
        <div><h1>Investments</h1><p>Investor deposits, interest payout schedules and maturity</p></div>
        <div className="sp" />
        <div className="search"><Icon name="search" /><input className="inp" placeholder="Search investment # or investor…" value={q} onChange={(e) => setQ(e.target.value)} /></div>
        {canUpdate && <button className="btn plain" onClick={openPlans}>Manage Plans</button>}
        {canCreate && <button className="btn" onClick={openNewInvestment}><Icon name="plus" /> New Investment</button>}
      </div>
      <hr className="gold-rule" />
      <div style={{ marginBottom: 14 }} className="tabs">
        {STATUSES.map((s) => (
          <button key={s} className={s === status ? "on" : ""} onClick={() => setStatus(s)}>{s}</button>
        ))}
      </div>
      {error && <div className="notice" style={{ marginBottom: 14 }}>{error}</div>}
      <div className="card"><div className="tbl-wrap tbl-scroll"><table className="tbl tbl-center">
        <thead><tr><th>Investment / Investor</th><th className="num">Principal</th><th>Rate</th><th>Maturity</th><th>Status</th></tr></thead>
        <tbody>
          {loading ? (
            <tr><td colSpan={5} className="empty">Loading investments…</td></tr>
          ) : investments.length === 0 ? (
            <tr><td colSpan={5} className="empty">No investments in this category.</td></tr>
          ) : investments.map((i) => <InvestmentRow investment={i} key={i.id} />)}
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
