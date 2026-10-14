"use client";

import { useRef, useState } from "react";
import { useModal } from "@/common/components/ModalProvider";
import { useToast } from "@/common/components/ToastProvider";
import { Icon } from "@/common/components/Icon";
import { fmt } from "@/common/utils/format";
import { settleAuction } from "@/modules/loans/services/loanService";
import { type AuctionRecordView, type AuctionSurplusDisposition, type LoanView } from "@/modules/loans/types/loan-types";
import { ApiError } from "@/common/services/httpClient";
import { singleFlight } from "@/common/utils/singleFlight";
import { SplitPaymentInput, ZERO_SPLIT, singleSplitMode, type SplitAmounts } from "@/common/components/SplitPaymentInput";
import { FieldError, fieldForMessage } from "@/common/components/ui/FieldError";

type SettleAuctionModalContentProps = { loan: LoanView; rec: AuctionRecordView; onSaved: (rec: AuctionRecordView) => void; onError?: () => void };

/* SettleAuctionModalContent is now specifically the SURPLUS DISPOSITION step.
 * It is only reachable when the sale covered the debt in full — a shortfall goes
 * through the management decision instead (AuctionDecisionModalContent below),
 * and the backend rejects settling such a loan.
 *
 * The surplus is the customer's money, so what happens to it is recorded as an
 * explicit decision with no pre-selected default: previously the dropdown
 * defaulted based on the sign of the surplus, which meant the common path was to
 * accept whatever was already highlighted without really choosing. */
export function SettleAuctionModalContent({ loan, rec, onSaved, onError }: SettleAuctionModalContentProps) {
  const { closeModal } = useModal();
  const toast = useToast();
  const [disposition, setDisposition] = useState<AuctionSurplusDisposition | "">("");
  const [remarks, setRemarks] = useState("");
  const [err, setErr] = useState("");
  const [fe, setFe] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState(false);
  const [split, setSplit] = useState<SplitAmounts>(ZERO_SPLIT);
  const [remaining, setRemaining] = useState(0);
  const [bankId, setBankId] = useState<number | undefined>(undefined);

  const surplus = rec.surplusPayableAmount;
  // Guards a double-click/double-Enter that fires both calls before React
  // has re-rendered the disabled button — `saving` state alone isn't
  // enough since both calls can read it as still-false in the same tick.
  // Without this, the first call could settle the case and the second
  // then fails against the now-concluded case with a confusing "no active
  // auction" error, even though the settle itself succeeded.
  const submittingRef = useRef(false);

  const fail = (field: string, msg: string) => { setErr(""); setFe({ [field]: msg }); };

  async function save() { return singleFlight("auction-modal:save:4", async () => {
    if (submittingRef.current) return;
    setErr(""); setFe({});
    if (!disposition) { fail("disposition", "Please choose what happens to the surplus."); return; }
    // Retaining a customer's money needs a stated reason — enforced server-side
    // too, so this is a courtesy check rather than the control.
    if (disposition === "RecordedAsIncome" && !remarks.trim()) {
      fail("remarks", "Please state why the surplus is being retained.");
      return;
    }
    let mode: string | undefined;
    if (disposition === "RefundedToCustomer") {
      if (Math.abs(remaining) >= 0.01) { fail("payments", "The payment breakdown must add up to the surplus."); return; }
      mode = singleSplitMode(split) ?? undefined;
      if (!mode) { fail("payments", "Refund the surplus in one payment mode — Cash, UPI or Bank Transfer."); return; }
      if (mode !== "Cash" && !bankId) { fail("payments", "Pick the bank the refund was paid from."); return; }
    }
    submittingRef.current = true;
    setSaving(true);
    try {
      const updated = await settleAuction(loan.numericId, disposition, remarks.trim() || undefined, mode, mode ? bankId : undefined);
      onSaved(updated);
      closeModal();
      toast(disposition === "RefundedToCustomer"
        ? `Surplus of ${fmt(surplus)} marked for refund to ${loan.customerName}`
        : `Auction settled for ${loan.id} — surplus retained as income`);
    } catch (e) {
      onError?.(); // see IssueNoticeModalContent's onError comment above
      // "already settled" means a previous attempt already succeeded (a
      // stale screen re-submitting after its first click went through) —
      // nothing left for this modal to do, so close it instead of leaving
      // staff staring at a settle form for a case that's already done.
      if (e instanceof ApiError && /already been settled/i.test(e.message)) {
        closeModal();
        toast("This auction case was already settled.");
        return;
      }
      const msg = e instanceof ApiError ? e.message : "Could not settle the auction — try again.";
      const field = fieldForMessage(msg, { remarks: /reason|remark|retain/i, payments: /bank|payment mode/i });
      if (field) fail(field, msg); else { setFe({}); setErr(msg); }
      submittingRef.current = false;
    } finally {
      setSaving(false);
    }
  }); }

  return (
    <>
      <div className="hd"><h3>Settle Auction — {loan.id}</h3><button className="x" onClick={closeModal}>×</button></div>
      <div className="bd bd-scroll">
        <div className="notice" style={{ marginBottom: 16 }}>
          <Icon name="gavel" />
          <span>
            The gold sold for {fmt(rec.saleAmount)} and cleared the full amount owed.
            A surplus of <b>{fmt(surplus)}</b> remains. What should happen to it?
          </span>
        </div>
        <div className="frow"><div className={fe.disposition ? "has-err" : undefined}>
          <label className="f">Surplus Disposition *</label>
          <div style={{ display: "flex", flexDirection: "column", gap: 6, marginTop: 4 }}>
            <label className="cradio" style={{ fontSize: 13 }}>
              <input type="radio" name="disposition" checked={disposition === "RefundedToCustomer"} onChange={() => { setDisposition("RefundedToCustomer"); setFe({}); }} />
              <span className="mark" />
              <span>
                <strong className="cradio-title">Refund to customer</strong>
                <span className="cradio-detail">a cash-out of {fmt(surplus)} will be booked and the money handed back to {loan.customerName}.</span>
              </span>
            </label>
            <label className="cradio" style={{ fontSize: 13 }}>
              <input type="radio" name="disposition" checked={disposition === "RecordedAsIncome"} onChange={() => { setDisposition("RecordedAsIncome"); setFe({}); }} />
              <span className="mark" />
              <span>
                <strong className="cradio-title">Record as company income</strong>
                <span className="cradio-detail">the money stays in the till. No further cash movement is created, since the full proceeds were already booked in at sale time.</span>
              </span>
            </label>
          </div>
          <FieldError msg={fe.disposition} />
        </div></div>
        {disposition === "RefundedToCustomer" && (
          <div className={fe.payments ? "has-err" : undefined}>
            <div className="frow">
              <SplitPaymentInput totalAmount={surplus} onChange={(s, r, bid) => { setSplit(s); setRemaining(r); setBankId(bid); setFe((cur) => (cur.payments ? { ...cur, payments: "" } : cur)); }} />
            </div>
            <FieldError msg={fe.payments} />
          </div>
        )}
        <div className="frow"><div className={fe.remarks ? "has-err" : undefined}>
          <label className="f">Remarks {disposition === "RecordedAsIncome" ? "*" : ""}</label>
          <input className="inp" value={remarks} onChange={(e) => { setRemarks(e.target.value); setFe((cur) => ({ ...cur, remarks: "" })); }} placeholder="reason / reference" maxLength={255} /><FieldError msg={fe.remarks} />
        </div></div>
        <p style={{ fontSize: 12, color: "var(--muted)" }}>This can only be recorded once — a surplus cannot be disposed of twice.</p>
        <p style={{ color: "var(--red)", fontSize: 12.5, minHeight: 16, marginTop: 8 }}>{err}</p>
      </div>
      <div className="ft">
        <button className="btn ghost" onClick={closeModal}>Cancel</button>
        {/* Not blanket-disabled on `!disposition` — that would block save()'s
         * own "Please choose what happens to the surplus" validation (and
         * Enter-to-submit, see common/utils/enterToSubmit.ts) from ever
         * running, silently doing nothing instead of showing the warning. */}
        <button className="btn" onClick={save} disabled={saving}><Icon name="check" /> {saving ? "Saving…" : "Settle"}</button>
      </div>
    </>
  );
}
