"use client";

import { useState } from "react";
import { useModal } from "@/common/components/ModalProvider";
import { useToast } from "@/common/components/ToastProvider";
import { Icon } from "@/common/components/Icon";
import { Select } from "@/common/components/ui/Select";
import { DatePicker } from "@/common/components/ui/DatePicker";
import { FieldError } from "@/common/components/ui/FieldError";
import { SplitPaymentInput, type SplitAmounts, type SplitPaymentLine } from "@/common/components/SplitPaymentInput";
import { fmt } from "@/common/utils/format";
import { ApiError } from "@/common/services/httpClient";
import { singleFlight } from "@/common/utils/singleFlight";
import { editLedgerPayment, deleteLedgerPayment, type LedgerEditPreview } from "@/modules/loans/services/loanService";
import { type PaymentView, type DiscountKind, DISCOUNT_KIND_LABELS } from "@/modules/loans/types/loan-types";

const CASH_TYPES = ["Interest", "Penal Interest", "Principal", "Partial", "Full Settlement"];
const DISCOUNT_MODES = ["Cash", "UPI", "Bank Transfer", "Cheque"];

type Props = {
  loanId: number;
  payment: PaymentView;
  mode: "edit" | "delete";
  minDate?: string; // the loan's start — a payment cannot be dated before it
  onSaved: () => void;
};

// Two steps: the first click asks the server what the change would do to the loan (nothing is saved), the second
// click saves it. The loan is recalculated from its first day, so every later entry may change.
export function LedgerPaymentEditModalContent({ loanId, payment: p, mode, minDate, onSaved }: Props) {
  const { closeModal } = useModal();
  const toast = useToast();
  const isDiscount = p.type === "Discount";
  const [date, setDate] = useState(p.paidOn.slice(0, 10));
  const [type, setType] = useState(p.type);
  const [amount, setAmount] = useState(String(p.amount));
  // The payment's saved breakdown, shown in the same Mode / Amount / Bank control every payment form uses.
  const initialLines: SplitPaymentLine[] = [
    p.cashAmount > 0 && { mode: "Cash" as const, amount: String(p.cashAmount) },
    p.upiAmount > 0 && { mode: "UPI" as const, amount: String(p.upiAmount), bankId: p.bankId ?? undefined, bankName: p.bankName },
    p.bankTransferAmount > 0 && { mode: "Bank Transfer" as const, amount: String(p.bankTransferAmount), bankId: p.bankId ?? undefined, bankName: p.bankName },
  ].filter(Boolean) as SplitPaymentLine[];
  const [split, setSplit] = useState<SplitAmounts>({ cashAmount: p.cashAmount, upiAmount: p.upiAmount, bankTransferAmount: p.bankTransferAmount, chequeAmount: 0 });
  const [remaining, setRemaining] = useState(0);
  const [bankId, setBankId] = useState<number | undefined>(p.bankId ?? undefined);
  const [reference, setReference] = useState(p.reference || "");
  const [discountReason, setDiscountReason] = useState((p.description || "").replace(/^Discount:\s*/, ""));
  const [discountMode, setDiscountMode] = useState(DISCOUNT_MODES.includes(p.method) ? p.method : "Cash");
  const [discountKind, setDiscountKind] = useState<DiscountKind>((p.discountKind as DiscountKind) || "customer");
  const [preview, setPreview] = useState<LedgerEditPreview | null>(null);
  // Whether the packet goes back too, when the edit reopens a closed loan (asked after the preview).
  const [reversePacket, setReversePacket] = useState(true);
  const [err, setErr] = useState("");
  const [saving, setSaving] = useState(false);
  const now = new Date();
  const today = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;

  // Any change makes the shown preview stale.
  function changed(set: (v: string) => void) {
    return (v: string) => { setPreview(null); setErr(""); set(v); };
  }

  async function submit() {
    return singleFlight("modal:ledger-edit", async () => {
      const dry = preview == null;
      setSaving(true);
      try {
        let res: LedgerEditPreview;
        if (mode === "delete") {
          res = await deleteLedgerPayment(loanId, p.id, dry, undefined, !dry && !!preview?.packet && reversePacket);
        } else {
          const amt = +amount;
          if (!(amt > 0)) { setErr("Enter a valid amount."); return; }
          if (!isDiscount) {
            if (Math.abs(remaining) > 0.01) { setErr(`The payment breakdown must add up to the amount (${fmt(amt)}).`); return; }
            if ((split.upiAmount > 0 || split.bankTransferAmount > 0) && !bankId) { setErr("Select the bank for the UPI / Bank Transfer part."); return; }
          } else if (!discountReason.trim()) {
            setErr("A discount needs a reason.");
            return;
          }
          res = await editLedgerPayment(loanId, p.id, {
            paidOn: date, amount: amt,
            ...(!dry && preview?.packet && reversePacket ? { reversePacket: true } : {}),
            ...(isDiscount
              ? { discountReason: discountReason.trim(), discountMode, discountKind }
              : { type, cashAmount: split.cashAmount, upiAmount: split.upiAmount, bankTransferAmount: split.bankTransferAmount, chequeAmount: 0, bankId, reference }),
          }, dry);
        }
        if (dry) { setPreview(res); setErr(""); return; }
        toast(mode === "delete" ? "Entry deleted and the loan recalculated" : "Entry updated and the loan recalculated");
        if (res.packetReversed && res.packet) toast(`Packet ${res.packet.code} moved back to ${res.packet.previousStatus}`);
        else if (res.packetError) toast(`The loan was updated, but the packet could not be moved back: ${res.packetError}`);
        onSaved();
        closeModal();
      } catch (e) {
        setErr(e instanceof ApiError ? e.message : "Could not save the change — try again.");
        setPreview(null);
      } finally {
        setSaving(false);
      }
    });
  }

  const changedRow = (label: string, before: number, after: number) => (
    <tr>
      <td>{label}</td>
      <td className="num">{fmt(before)}</td>
      <td className="num" style={{ fontWeight: 600, color: Math.abs(after - before) > 0.005 ? "var(--brand)" : undefined }}>{fmt(after)}</td>
    </tr>
  );

  return (
    <>
      <div className="hd"><h3>{mode === "delete" ? "Delete" : "Edit"} {p.type} entry</h3><button className="x" onClick={closeModal}>×</button></div>
      <div className="bd bd-scroll ledger-edit-bd">
        <p className="notice" style={{ marginBottom: 12 }}>
          The loan is recalculated from its first day, so interest, later payments, balances, the cash ledger and every other
          ledger update to match this change.
        </p>
        {mode === "edit" && (
          <>
            <div className="frow c2">
              <div><label className="f">Date *</label><DatePicker value={date} min={minDate} max={today} onChange={changed(setDate)} /></div>
              <div><label className="f">Amount (₹) *</label><input className="inp" type="number" min={0} value={amount} onChange={(e) => changed(setAmount)(e.target.value)} /></div>
            </div>
            {isDiscount ? (
              <div className="frow c2">
                <div><label className="f">Discount Reason *</label><input className="inp" maxLength={200} value={discountReason} onChange={(e) => changed(setDiscountReason)(e.target.value)} /></div>
                <div><label className="f">Discount Mode</label><Select options={DISCOUNT_MODES.map((m) => ({ value: m, label: m }))} value={discountMode} onChange={changed(setDiscountMode)} /></div>
                <div><label className="f">Discount Type</label><Select options={(Object.keys(DISCOUNT_KIND_LABELS) as DiscountKind[]).map((k) => ({ value: k, label: DISCOUNT_KIND_LABELS[k] }))} value={discountKind} onChange={(v) => changed(setDiscountKind as (v: string) => void)(v)} /></div>
              </div>
            ) : (
              <>
                <div className="frow c2">
                  <div><label className="f">Apply Payment To</label><Select options={CASH_TYPES.map((t) => ({ value: t, label: t }))} value={type} onChange={changed(setType)} /></div>
                  <div><label className="f">Reference</label><input className="inp" value={reference} onChange={(e) => changed(setReference)(e.target.value)} /></div>
                </div>
                <h4 style={{ margin: "14px 0 6px", fontSize: 13 }}>Payment breakdown <small style={{ fontWeight: 400, color: "var(--muted)" }}>How the customer paid</small></h4>
                <SplitPaymentInput
                  totalAmount={+amount || 0} initialLines={initialLines} scrollInternally={false} label={null}
                  onChange={(s, r, b) => { setPreview(null); setErr(""); setSplit(s); setRemaining(r); setBankId(b); }}
                />
              </>
            )}
          </>
        )}
        {mode === "delete" && (
          <p style={{ marginBottom: 12 }}>
            Delete the <b>{p.type}</b> of <b>{fmt(p.amount)}</b> dated <b>{p.paidOn.slice(0, 10)}</b>? Its cash-ledger line is removed too.
            {!isDiscount && " A discount given with this payment is its own entry and has to be deleted separately."}
          </p>
        )}
        {preview && (
          <div style={{ marginTop: 12 }}>
            <label className="f">What changes on the loan (as of its last entry)</label>
            <div className="tbl-wrap"><table className="tbl">
              <thead><tr><th></th><th className="num">Before</th><th className="num">After</th></tr></thead>
              <tbody>
                {changedRow("Principal owed", preview.before.principal, preview.after.principal)}
                {changedRow("Interest owed", preview.before.interest, preview.after.interest)}
                {changedRow("Penal interest owed", preview.before.penalInterest, preview.after.penalInterest)}
                {changedRow("Total owed", preview.before.total, preview.after.total)}
                <tr><td>Status</td><td className="num">{preview.before.status}</td><td className="num">{preview.after.status}</td></tr>
              </tbody>
            </table></div>
          </div>
        )}
        {preview?.packet && (
          <label style={{ display: "flex", gap: 8, alignItems: "flex-start", marginTop: 12, fontSize: 13.5, cursor: "pointer" }}>
            <input type="checkbox" checked={reversePacket} onChange={(e) => setReversePacket(e.target.checked)} style={{ marginTop: 3 }} />
            <span>
              This reopens the loan. Move packet <b>{preview.packet.code}</b> back from <b>{preview.packet.currentStatus}</b> to <b>{preview.packet.previousStatus}</b>?
              <span style={{ display: "block", color: "var(--muted)", fontSize: 12.5 }}>Untick to leave the packet as it is.</span>
            </span>
          </label>
        )}
        <FieldError msg={err} />
      </div>
      <div className="ft">
        <button className="btn ghost" onClick={closeModal} disabled={saving}>Cancel</button>
        <button className="btn" onClick={submit} disabled={saving}>
          <Icon name={mode === "delete" ? "trash" : "check"} /> {saving ? "Working…" : preview ? (mode === "delete" ? "Confirm delete" : "Confirm") : "Preview the change"}
        </button>
      </div>
    </>
  );
}
