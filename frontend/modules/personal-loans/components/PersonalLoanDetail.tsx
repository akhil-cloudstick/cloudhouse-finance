"use client";

import { useCallback, useEffect, useState } from "react";
import { useAuth } from "@/common/auth-context";
import { useModal } from "@/common/components/Modal";
import { ApiError } from "@/common/services/httpClient";
import { fmt } from "@/common/utils/format";
import { StatusChip } from "@/common/components/ui/StatusChip";
import {
  getPersonalLoan,
  getPersonalLoanSchedule,
  listPersonalLoanPayments,
  type BackendPersonalLoan,
  type BackendPersonalLoanInstallment,
  type BackendPersonalLoanPayment,
} from "@/modules/personal-loans/services/personalLoanService";
import { CollectPaymentModalContent } from "@/modules/personal-loans/components/CollectPaymentModal";
import { RenewLoanModalContent } from "@/modules/personal-loans/components/RenewLoanModal";

export function PersonalLoanDetail({ id }: { id?: string }) {
  const { can } = useAuth();
  const { openModal, closeModal } = useModal();
  const canUpdate = can("Personal_Loan_Management", "can_update_personal_loan");

  const [loan, setLoan] = useState<BackendPersonalLoan | null>(null);
  const [schedule, setSchedule] = useState<BackendPersonalLoanInstallment[]>([]);
  const [payments, setPayments] = useState<BackendPersonalLoanPayment[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  const numericId = Number(id);

  const refresh = useCallback(async () => {
    if (!numericId) return;
    setLoading(true);
    setError("");
    try {
      const [l, s, p] = await Promise.all([
        getPersonalLoan(numericId),
        getPersonalLoanSchedule(numericId),
        listPersonalLoanPayments(numericId),
      ]);
      setLoan(l);
      setSchedule(s);
      setPayments(p);
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "Could not load this loan.");
    } finally {
      setLoading(false);
    }
  }, [numericId]);

  useEffect(() => { void refresh(); }, [refresh]);

  if (loading) return <div className="notice">Loading loan…</div>;
  if (error || !loan) return <div className="notice">{error || "Loan not found."}</div>;

  function openCollect() {
    if (!loan) return;
    openModal(<CollectPaymentModalContent loan={loan} onSaved={() => { closeModal(); void refresh(); }} />);
  }
  function openRenew() {
    if (!loan) return;
    openModal(<RenewLoanModalContent loan={loan} onSaved={() => { closeModal(); location.hash = "personalloans"; }} />);
  }

  return (
    <>
      <div className="page-h">
        <div>
          <a href="#personalloans" style={{ fontSize: 13 }}>← Back</a>
          <h1>Loan {loan.loanNumber} · {loan.customer?.name}</h1>
        </div>
        <div className="sp" />
        {canUpdate && loan.status === "Active" && (
          <button className="btn plain" onClick={openRenew}>Renew Loan</button>
        )}
      </div>
      <hr className="gold-rule" />

      <div className="card" style={{ marginBottom: 16, display: "flex", gap: 24, flexWrap: "wrap" }}>
        <div><div className="sub">Principal</div><div><strong>{fmt(loan.principalAmount)}</strong></div></div>
        <div><div className="sub">Interest</div><div><strong>{fmt(loan.interestAmount)}</strong> ({loan.interestType === "Flat" ? fmt(loan.interestValue) : `${loan.interestValue}%`})</div></div>
        <div><div className="sub">Disbursed</div><div><strong>{fmt(loan.disbursedAmount)}</strong></div></div>
        <div><div className="sub">Outstanding</div><div><strong>{fmt(loan.outstandingAmount)}</strong></div></div>
        <div><div className="sub">Status</div><div><StatusChip status={loan.status} /></div></div>
        <div><div className="sub">Frequency</div><div>{loan.frequency}</div></div>
        {loan.renewedFromLoanId && <div><div className="sub">Renewed from</div><div><a href={`#personalloan/${loan.renewedFromLoanId}`}>Loan #{loan.renewedFromLoanId}</a></div></div>}
        {loan.renewedToLoanId && <div><div className="sub">Renewed to</div><div><a href={`#personalloan/${loan.renewedToLoanId}`}>Loan #{loan.renewedToLoanId}</a></div></div>}
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16 }}>
        <div className="card">
          <h3 style={{ marginTop: 0 }}>Schedule</h3>
          <div className="tbl-wrap tbl-scroll"><table className="tbl tbl-center">
            <thead><tr><th>#</th><th>Due Date</th><th className="num">Amount</th><th>Status</th></tr></thead>
            <tbody>
              {schedule.length === 0 ? (
                <tr><td colSpan={4} className="empty">No installments.</td></tr>
              ) : schedule.map((s) => (
                <tr key={s.id}>
                  <td>{s.sequenceNo}</td>
                  <td>{s.dueDate.slice(0, 10)}</td>
                  <td className="num">{fmt(s.amount)}</td>
                  <td><StatusChip status={s.status === "PartiallyPaid" ? "Partially Paid" : s.status} /></td>
                </tr>
              ))}
            </tbody>
          </table></div>
        </div>

        <div className="card">
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
            <h3 style={{ margin: 0 }}>Payment History</h3>
            {canUpdate && loan.status === "Active" && <button className="btn sm" onClick={openCollect}>+ Collect</button>}
          </div>
          <div className="tbl-wrap tbl-scroll" style={{ marginTop: 10 }}><table className="tbl tbl-center">
            <thead><tr><th>Date</th><th className="num">Amount</th><th>Method</th><th className="num">Balance</th></tr></thead>
            <tbody>
              {payments.length === 0 ? (
                <tr><td colSpan={4} className="empty">No payments yet.</td></tr>
              ) : payments.map((p) => (
                <tr key={p.id}>
                  <td>{p.paidOn.slice(0, 10)}</td>
                  <td className="num">{fmt(p.amount)}</td>
                  <td>{p.method}</td>
                  <td className="num">{fmt(p.runningBalance)}</td>
                </tr>
              ))}
            </tbody>
          </table></div>
        </div>
      </div>
    </>
  );
}
