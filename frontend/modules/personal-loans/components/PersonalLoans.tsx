"use client";

import { useCallback, useEffect, useState } from "react";
import { Icon } from "@/common/components/Icon";
import { useAuth } from "@/common/auth-context";
import { useModal } from "@/common/components/Modal";
import { ApiError } from "@/common/services/httpClient";
import { listPersonalLoans, type BackendPersonalLoan } from "@/modules/personal-loans/services/personalLoanService";
import { PersonalLoanRow } from "@/modules/personal-loans/components/PersonalLoanRow";
import { NewPersonalLoanModalContent } from "@/modules/personal-loans/components/NewPersonalLoanModal";

const CATS = ["All", "Active", "Closed", "Renewed", "Defaulted"];

/* Personal Loans list — an unsecured, no-KYC loan product separate from the
 * Gold Loan module (see backend/internal/personalloan's package doc). Kept
 * deliberately simple (no server-side pagination/search) compared to
 * Loans.tsx: this is a new, smaller-scale product line. */
export function PersonalLoans() {
  const { can } = useAuth();
  const { openModal, closeModal } = useModal();
  const canCreate = can("Personal_Loan_Management", "can_create_personal_loan");

  const [cat, setCat] = useState("All");
  const [q, setQ] = useState("");
  const [loans, setLoans] = useState<BackendPersonalLoan[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  const refresh = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const rec = await listPersonalLoans({ status: cat === "All" ? undefined : cat });
      setLoans(rec);
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "Could not load personal loans.");
    } finally {
      setLoading(false);
    }
  }, [cat]);

  useEffect(() => { void refresh(); }, [refresh]);

  const needle = q.trim().toLowerCase();
  const rows = needle
    ? loans.filter((l) => l.loanNumber.toLowerCase().includes(needle) || (l.customer?.name || "").toLowerCase().includes(needle))
    : loans;

  function openNewLoan() {
    openModal(<NewPersonalLoanModalContent onSaved={() => { closeModal(); void refresh(); }} />);
  }

  return (
    <>
      <div className="page-h">
        <div><h1>Personal Loans</h1><p>Small unsecured cash loans, repaid daily/weekly/monthly</p></div>
        <div className="sp" />
        <div className="search"><Icon name="search" /><input className="inp" placeholder="Search loan # or customer…" value={q} onChange={(e) => setQ(e.target.value)} /></div>
        {canCreate && <button className="btn" onClick={openNewLoan}><Icon name="plus" /> New Personal Loan</button>}
      </div>
      <hr className="gold-rule" />
      <div style={{ marginBottom: 14 }} className="tabs">
        {CATS.map((c) => (
          <button key={c} className={c === cat ? "on" : ""} onClick={() => setCat(c)}>{c}</button>
        ))}
      </div>
      {error && <div className="notice" style={{ marginBottom: 14 }}>{error}</div>}
      <div className="card"><div className="tbl-wrap tbl-scroll"><table className="tbl tbl-center">
        <thead><tr><th>Loan / Customer</th><th className="num">Principal</th><th className="num">Outstanding</th><th>Frequency</th><th>Status</th></tr></thead>
        <tbody>
          {loading ? (
            <tr><td colSpan={5} className="empty">Loading personal loans…</td></tr>
          ) : rows.length === 0 ? (
            <tr><td colSpan={5} className="empty">No personal loans in this category.</td></tr>
          ) : rows.map((l) => <PersonalLoanRow loan={l} key={l.id} />)}
        </tbody>
      </table></div>
      </div>
    </>
  );
}
