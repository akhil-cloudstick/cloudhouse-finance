"use client";

import { useState } from "react";
import { useModal } from "@/common/components/Modal";
import { useToast } from "@/common/components/Toast";
import { Icon } from "@/common/components/Icon";
import { fmt } from "@/common/utils/format";
import { ApiError } from "@/common/services/httpClient";
import { SplitPaymentInput, ZERO_SPLIT, type SplitAmounts } from "@/common/components/ui/SplitPaymentInput";
import { topUpLoan, getLoan, type LoanView } from "@/modules/loans/services/loanService";
import { EditLoanModalContent } from "@/common/components/modals/EditLoanModal";

/* Draws additional cash against an already-Active loan's spare eligible
 * value, without closing/reopening it — a single-step flow (no multi-stage
 * sanction chain). Shows current headroom (eligibleLoanAmount -
 * outstanding); if the requested amount exceeds it, the backend rejects
 * with ErrTopUpShortfall and this modal chains straight into the existing
 * "Edit Loan" ornament-add flow, then reopens itself once ornaments are
 * saved so the new (larger) headroom is visible without a second click. */
export function TopUpLoanModalContent({ loan, onSaved }: { loan: LoanView; onSaved: (updated: LoanView) => void }) {
  const { openModal, closeModal } = useModal();
  const toast = useToast();
  const headroom = Math.max(0, loan.eligibleLoanAmount - loan.outstanding);

  const [amount, setAmount] = useState("");
  const [split, setSplit] = useState<SplitAmounts>(ZERO_SPLIT);
  const [remaining, setRemaining] = useState(0);
  const [reference, setReference] = useState("");
  const [err, setErr] = useState("");
  const [shortfall, setShortfall] = useState(false);
  const [saving, setSaving] = useState(false);

  const amt = +amount || 0;
  const balanced = Math.abs(remaining) < 0.01;

  function openAddOrnaments() {
    closeModal();
    openModal(
      <EditLoanModalContent
        loan={loan}
        onSaved={async () => {
          // EditLoanModalContent's onSaved carries no payload — re-fetch so
          // the reopened top-up modal sees the now-larger eligible amount,
          // matching what the customer originally asked for.
          const updated = await getLoan(loan.numericId);
          onSaved(updated);
          openModal(<TopUpLoanModalContent loan={updated} onSaved={onSaved} />);
        }}
      />,
      true
    );
  }

  async function save() {
    if (!amt || amt <= 0) { setErr("Please enter the top-up amount."); return; }
    if (!balanced) { setErr("The payment breakdown must add up to the amount."); return; }
    setSaving(true);
    setErr("");
    setShortfall(false);
    try {
      const updated = await topUpLoan(loan.numericId, {
        amount: amt,
        cashAmount: split.cashAmount,
        upiAmount: split.upiAmount,
        bankTransferAmount: split.bankTransferAmount,
        chequeAmount: split.chequeAmount,
        reference: reference.trim() || undefined,
      });
      toast(`${fmt(amt)} topped up on loan ${loan.id}`);
      onSaved(updated);
      closeModal();
    } catch (e) {
      if (e instanceof ApiError && /headroom/i.test(e.message)) {
        setShortfall(true);
        setErr(e.message);
      } else {
        setErr(e instanceof ApiError ? e.message : "Could not record the top-up — try again.");
      }
    } finally {
      setSaving(false);
    }
  }

  return (
    <>
      <div className="hd"><h3>Top Up Loan — {loan.id}</h3><button className="x" onClick={closeModal}>×</button></div>
      <div className="bd">
        <div className="notice" style={{ marginBottom: 16, flexDirection: "column", alignItems: "stretch", gap: 4 }}>
          <div><Icon name="coin" /> Available headroom: <b>{fmt(headroom)}</b></div>
          <div style={{ fontSize: 12, color: "var(--muted)" }}>Eligible {fmt(loan.eligibleLoanAmount)} − Outstanding {fmt(loan.outstanding)}</div>
        </div>
        <div className="frow">
          <div><label className="f">Top-up Amount (₹) *</label><input className="inp" type="number" min={1} max={headroom || undefined} placeholder="e.g. 5000" value={amount} onChange={(e) => setAmount(e.target.value)} /></div>
        </div>
        <div className="frow" style={{ marginTop: 4 }}>
          <SplitPaymentInput totalAmount={amt} onChange={(s, r) => { setSplit(s); setRemaining(r); }} />
        </div>
        <div className="frow"><div><label className="f">Reference</label><input className="inp" value={reference} onChange={(e) => setReference(e.target.value)} maxLength={80} /></div></div>
        {err && (
          <div className="notice" style={{ marginTop: 10 }}>
            {err}
            {shortfall && (
              <div style={{ marginTop: 8 }}>
                <a href="#" onClick={(e) => { e.preventDefault(); openAddOrnaments(); }}>Add ornaments to raise the eligible amount →</a>
              </div>
            )}
          </div>
        )}
      </div>
      <div className="ft">
        <button className="btn plain" style={{ fontSize: 12.5, fontWeight: 600, letterSpacing: ".16em", textTransform: "uppercase" }} onClick={closeModal}>Cancel</button>
        <button className="btn" disabled={saving || !balanced} onClick={save}>{saving ? "Recording…" : "Top Up"}</button>
      </div>
    </>
  );
}
