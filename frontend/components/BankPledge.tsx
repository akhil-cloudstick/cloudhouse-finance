"use client";

import { useState } from "react";
import { useLoans } from "@/lib/LoansProvider";
import { useModal } from "@/components/Modal";
import { useToast } from "@/components/Toast";
import { Icon } from "@/lib/icons";
import { fmt, fmtW } from "@/lib/format";
import { releaseBankPledge } from "@/lib/loansApi";
import { RepledgeModalContent, SelectLoanForRepledgeModalContent } from "@/components/modals/RepledgeModal";
import { BankModalContent } from "@/components/modals/BankModal";
import { ApiError } from "@/lib/api";

/* Ported from legacy/app.js's `renderBankPledge()`. The mock version also
 * showed a directory of banks (db.banks, a hardcoded list with per-bank
 * exposure totals) — that resource doesn't exist on the backend
 * (BankPledgeRecord.BankName is a free-text field, not a Bank entity), so
 * the bank-directory panel is dropped here. "New Re-Pledge" is initiated
 * from a loan's own detail page (LoanDetail.tsx's "Repledge to Bank"
 * button), same as before. */
export function BankPledge() {
  const { loans, loading, error, refresh } = useLoans();
  const { openModal, closeModal } = useModal();
  const toast = useToast();
  const [releasingId, setReleasingId] = useState<number | null>(null);
  const pledged = loans.filter((l) => l.bankPledgeStatus === "Bank Pledged");

  function startNewRepledge() {
    openModal(
      <SelectLoanForRepledgeModalContent
        loans={loans}
        onPicked={(loan) => {
          closeModal();
          openModal(<RepledgeModalContent loan={loan} onSaved={refresh} />);
        }}
      />
    );
  }

  async function release(loanId: number, pledgeId: number) {
    setReleasingId(pledgeId);
    try {
      await releaseBankPledge(loanId, pledgeId);
      refresh();
      toast("Bank pledge released");
    } catch (e) {
      toast(e instanceof ApiError ? e.message : "Could not release the pledge — try again");
    } finally {
      setReleasingId(null);
    }
  }

  return (
    <>
      <div className="page-h">
        <div><h1>Bank &amp; Gold Re-Pledge</h1><p>Customer gold re-pledged with external banks</p></div>
        <div className="sp" />
        <button className="btn ghost" onClick={() => openModal(<BankModalContent onSaved={() => {}} />)}><Icon name="plus" /> Add Bank</button>
        <button className="btn" onClick={startNewRepledge}><Icon name="plus" /> New Re-Pledge</button>
      </div>
      <hr className="gold-rule" />
      {error && <div className="notice" style={{ marginBottom: 14 }}>{error}</div>}
      <div className="card">
        <div className="hd"><h3>Re-Pledged Loans</h3></div>
        <div className="tbl-wrap">
          <table className="tbl">
            <thead>
              <tr><th>Loan</th><th>Customer</th><th>Bank</th><th className="num">Weight</th><th className="num">Pledged Amount</th><th>Pledged On</th><th></th></tr>
            </thead>
            <tbody>
              {loading ? (
                <tr><td colSpan={7} className="empty">Loading…</td></tr>
              ) : pledged.length === 0 ? (
                <tr><td colSpan={7} className="empty">No loans currently bank-pledged.</td></tr>
              ) : pledged.map((l) => {
                const active = l.bankPledges.find((p) => !p.isReleased);
                return (
                  <tr key={l.id}>
                    <td><a href={`#loan/${l.id}`}>{l.id}</a></td>
                    <td>{l.customerName}</td>
                    <td>{active?.bankName || "—"}</td>
                    <td className="num">{fmtW(l.totalNetWeight)}</td>
                    <td className="num">{active ? fmt(active.pledgedAmount) : "—"}</td>
                    <td>{active?.pledgeDate || "—"}</td>
                    <td>
                      {active && (
                        <button className="btn ghost sm" disabled={releasingId === active.id} onClick={() => release(l.numericId, active.id)}>
                          {releasingId === active.id ? "Releasing…" : "Release"}
                        </button>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        <div className="ft">If a customer requests closure while gold is bank-pledged, the release workflow flags the bank release step first.</div>
      </div>
    </>
  );
}
