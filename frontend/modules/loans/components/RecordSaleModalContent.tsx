"use client";

import { useState } from "react";
import { useModal } from "@/common/components/ModalProvider";
import { useToast } from "@/common/components/ToastProvider";
import { Icon } from "@/common/components/Icon";
import { fmt } from "@/common/utils/format";
import { recordAuctionSale } from "@/modules/loans/services/loanService";
import { type AuctionRecordView, type LoanView } from "@/modules/loans/types/loan-types";
import { ApiError } from "@/common/services/httpClient";
import { singleFlight } from "@/common/utils/singleFlight";
import { SplitPaymentInput, ZERO_SPLIT, type SplitAmounts } from "@/common/components/SplitPaymentInput";

type RecordSaleModalContentProps = { loan: LoanView; onSaved: (rec: AuctionRecordView) => void; onError?: () => void };

export function RecordSaleModalContent({ loan, onSaved, onError }: RecordSaleModalContentProps) {
  const { closeModal } = useModal();
  const toast = useToast();
  const [amount, setAmount] = useState("");
  const [expenses, setExpenses] = useState("");
  const [err, setErr] = useState("");
  const [saving, setSaving] = useState(false);
  const [split, setSplit] = useState<SplitAmounts>(ZERO_SPLIT);
  const [remaining, setRemaining] = useState(0);
  const [bankId, setBankId] = useState<number | undefined>(undefined);

  const sale = +amount || 0;
  const exp = +expenses || 0;
  const preview = sale - exp - loan.totalOutstandingBalance;

  async function save() { return singleFlight("auction-modal:save:3", async () => {
    if (!sale || sale <= 0) { setErr("Please enter the sale amount."); return; }
    if (exp > sale) { setErr("Auction expenses cannot be more than the sale amount."); return; }
    if (Math.abs(remaining) >= 0.01) { setErr("The payment breakdown must add up to the sale amount."); return; }
    if (split.upiAmount + split.bankTransferAmount > 0 && !bankId) { setErr("Pick the bank the proceeds were received in."); return; }
    setSaving(true);
    try {
      const rec = await recordAuctionSale(loan.numericId, sale, exp, { cashAmount: split.cashAmount, upiAmount: split.upiAmount, bankTransferAmount: split.bankTransferAmount, bankId });
      onSaved(rec);
      closeModal();
      toast(`Auction sale recorded for ${loan.id}`);
    } catch (e) {
      setErr(e instanceof ApiError ? e.message : "Could not record the sale — try again.");
      onError?.(); // see IssueNoticeModalContent's onError comment above
    } finally {
      setSaving(false);
    }
  }); }

  return (
    <>
      <div className="hd"><h3>Record Auction Sale — {loan.id}</h3><button className="x" onClick={closeModal}>×</button></div>
      <div className="bd bd-scroll">
        <div className="notice" style={{ marginBottom: 16 }}>
          <Icon name="gavel" /> {loan.customerName} · outstanding <b>{fmt(loan.totalOutstandingBalance)}</b>
        </div>
        <div className="frow c2">
          <div><label className="f">Sale Amount (₹) *</label><input className="inp" type="number" min={1} value={amount} onChange={(e) => setAmount(e.target.value)} /></div>
          <div><label className="f">Auction Expenses (₹)</label><input className="inp" type="number" min={0} value={expenses} onChange={(e) => setExpenses(e.target.value)} /></div>
        </div>
        <div className="frow">
          <SplitPaymentInput totalAmount={Math.max(0, sale)} onChange={(s, r, bid) => { setSplit(s); setRemaining(r); setBankId(bid); }} />
        </div>
        <div style={{ display: "flex", justifyContent: "space-between", padding: "8px 0", fontWeight: 600, color: preview >= 0 ? "var(--green)" : "var(--red)" }}>
          <span>{preview >= 0 ? "Surplus" : "Shortfall"}</span><span>{fmt(Math.abs(preview))}</span>
        </div>
        {/* Spell out the consequence before the click. The two outcomes differ
          * sharply — one closes the loan, the other keeps a real balance owing
          * and escalates it to management — and the amount entered here is what
          * decides which, so it should not be a surprise afterwards. */}
        {/* .notice is display:flex, so all text must sit inside ONE child
          * element — otherwise each <b> becomes its own flex item and the
          * amounts get pulled out into separate columns mid-sentence. */}
        {sale > 0 && (
          <div className="notice" style={{ fontSize: 12.5 }}>
            <Icon name="shield" />
            <span>
              {preview >= 0
                ? (preview > 0.01 ? <>Amount payable <b>{fmt(preview)}</b></> : <>Loan will be closed</>)
                : <>Balance owing <b>{fmt(Math.abs(preview))}</b></>}
            </span>
          </div>
        )}
        <p style={{ color: "var(--red)", fontSize: 12.5, minHeight: 16, marginTop: 8 }}>{err}</p>
      </div>
      <div className="ft">
        <button className="btn ghost" onClick={closeModal}>Cancel</button>
        <button className="btn" onClick={save} disabled={saving}><Icon name="check" /> {saving ? "Saving…" : "Record Sale"}</button>
      </div>
    </>
  );
}
