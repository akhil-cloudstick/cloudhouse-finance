"use client";

import { useState } from "react";
import { useModal } from "@/common/components/ModalProvider";
import { useToast } from "@/common/components/ToastProvider";
import { Icon } from "@/common/components/Icon";
import { DatePicker } from "@/common/components/ui/DatePicker";
import { FieldError } from "@/common/components/ui/FieldError";
import { SplitPaymentInput, type SplitAmounts, type SplitPaymentLine } from "@/common/components/SplitPaymentInput";
import { fmt } from "@/common/utils/format";
import { ApiError } from "@/common/services/httpClient";
import { singleFlight } from "@/common/utils/singleFlight";
import { editInvestmentLedgerEntry, deleteInvestmentLedgerEntry, type InvestmentLedgerEditPreview } from "@/modules/investments/services/investmentService";
import { type InvestmentLedgerRow } from "@/modules/investments/types/investment-types";

type Props = {
  investmentId: number;
  row: InvestmentLedgerRow;
  mode: "edit" | "delete";
  live: boolean; // live-accrual engine: shows the principal / interest outstanding rows
  minDate?: string; // the investment's start — an entry cannot be dated before it
  onSaved: () => void;
};

const KIND_LABEL: Record<string, string> = { opening: "opening deposit", deposit: "deposit", withdrawal: "withdrawal", payout: "payout" };

// Two steps, like the gold-loan ledger edit: the first click asks the server what the change would do to the
// investment (nothing is saved), the second click saves it.
export function InvestmentLedgerEditModalContent({ investmentId, row: r, mode, live, minDate, onSaved }: Props) {
  const { closeModal } = useModal();
  const toast = useToast();
  const kind = r.entryKind || "deposit";
  const isWithdrawal = kind === "withdrawal";
  const isPayout = kind === "payout";
  const cash = r.cashAmount ?? 0, upi = r.upiAmount ?? 0, bt = r.bankTransferAmount ?? 0;
  const [date, setDate] = useState(r.date.slice(0, 10));
  const [amount, setAmount] = useState(String(r.entryAmount ?? r.amount));
  const [principal, setPrincipal] = useState(String(r.principalAmount ?? 0));
  const [interest, setInterest] = useState(String(r.interestAmount ?? 0));
  const [reference, setReference] = useState(r.reference || "");
  const initialLines: SplitPaymentLine[] = [
    cash > 0 && { mode: "Cash" as const, amount: String(cash) },
    upi > 0 && { mode: "UPI" as const, amount: String(upi), bankId: r.bankId ?? undefined },
    bt > 0 && { mode: "Bank Transfer" as const, amount: String(bt), bankId: r.bankId ?? undefined },
  ].filter(Boolean) as SplitPaymentLine[];
  const [split, setSplit] = useState<SplitAmounts>({ cashAmount: cash, upiAmount: upi, bankTransferAmount: bt, chequeAmount: 0 });
  const [remaining, setRemaining] = useState(0);
  const [bankId, setBankId] = useState<number | undefined>(r.bankId ?? undefined);
  const [preview, setPreview] = useState<InvestmentLedgerEditPreview | null>(null);
  const [err, setErr] = useState("");
  const [saving, setSaving] = useState(false);
  const now = new Date();
  const today = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;

  const total = isWithdrawal ? (+principal || 0) + (+interest || 0) : isPayout ? (r.entryAmount ?? r.amount) : +amount || 0;

  // Any change makes the shown preview stale.
  function changed(set: (v: string) => void) {
    return (v: string) => { setPreview(null); setErr(""); set(v); };
  }

  async function submit() {
    return singleFlight("modal:investment-ledger-edit", async () => {
      const dry = preview == null;
      setSaving(true);
      try {
        let res: InvestmentLedgerEditPreview;
        if (mode === "delete") {
          res = await deleteInvestmentLedgerEntry(investmentId, r.id, dry);
        } else {
          if (!(total > 0)) { setErr("Enter a valid amount."); return; }
          if (Math.abs(remaining) > 0.01) { setErr(`The payment breakdown must add up to the amount (${fmt(total)}).`); return; }
          if ((split.upiAmount > 0 || split.bankTransferAmount > 0) && !bankId) { setErr("Select the bank for the UPI / Bank Transfer part."); return; }
          res = await editInvestmentLedgerEntry(investmentId, r.id, {
            occurredOn: new Date(date).toISOString(),
            ...(isWithdrawal ? { principalAmount: +principal || 0, interestAmount: +interest || 0 } : isPayout ? {} : { amount: +amount }),
            ...(isPayout || kind === "opening" ? {} : { reference: reference.trim() }),
            cashAmount: split.cashAmount, upiAmount: split.upiAmount, bankTransferAmount: split.bankTransferAmount, chequeAmount: 0, bankId,
          }, dry);
        }
        if (dry) { setPreview(res); setErr(""); return; }
        toast(mode === "delete" ? "Entry deleted and the investment recalculated" : "Entry updated and the investment recalculated");
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

  const numRow = (label: string, before: number, after: number) => (
    <tr>
      <td>{label}</td>
      <td className="num">{fmt(before)}</td>
      <td className="num" style={{ fontWeight: 600, color: Math.abs(after - before) > 0.005 ? "var(--brand)" : undefined }}>{fmt(after)}</td>
    </tr>
  );
  const textRow = (label: string, before: string | number, after: string | number) => (
    <tr>
      <td>{label}</td>
      <td className="num">{before}</td>
      <td className="num" style={{ fontWeight: 600, color: String(before) !== String(after) ? "var(--brand)" : undefined }}>{after}</td>
    </tr>
  );

  return (
    <>
      <div className="hd"><h3>{mode === "delete" ? "Delete" : "Edit"} {KIND_LABEL[kind] || "entry"}</h3><button className="x" onClick={closeModal}>×</button></div>
      <div className="bd bd-scroll ledger-edit-bd">
        <p className="notice" style={{ marginBottom: 12 }}>
          {live
            ? "The investment is recalculated from its first day, so interest, later entries, balances and the cash ledger update to match this change."
            : "The change is applied to the investment and its cash-ledger line is rewritten to match."}
        </p>
        {mode === "edit" && (
          <>
            <div className="frow c2">
              <div><label className="f">Date *</label><DatePicker value={date} min={kind === "opening" ? undefined : minDate} max={today} onChange={changed(setDate)} /></div>
              {isWithdrawal ? null : isPayout ? (
                <div><label className="f">Amount (₹)</label><input className="inp" value={fmt(r.entryAmount ?? r.amount)} readOnly disabled /></div>
              ) : (
                <div><label className="f">Amount (₹) *</label><input className="inp" type="number" min={0} value={amount} onChange={(e) => changed(setAmount)(e.target.value)} /></div>
              )}
            </div>
            {isWithdrawal && (
              <div className="frow c2">
                <div><label className="f">Principal (₹)</label><input className="inp" type="number" min={0} value={principal} onChange={(e) => changed(setPrincipal)(e.target.value)} /></div>
                <div><label className="f">Interest (₹)</label><input className="inp" type="number" min={0} value={interest} onChange={(e) => changed(setInterest)(e.target.value)} /></div>
              </div>
            )}
            {isPayout && <p style={{ margin: "4px 0 10px", color: "var(--muted)", fontSize: 12 }}>The amount of a payout is fixed by the schedule. To change it, delete this entry and pay the payout again.</p>}
            {!isPayout && kind !== "opening" && (
              <div className="frow">
                <div><label className="f">Reference</label><input className="inp" value={reference} onChange={(e) => changed(setReference)(e.target.value)} /></div>
              </div>
            )}
            <h4 style={{ margin: "14px 0 6px", fontSize: 13 }}>Payment breakdown <small style={{ fontWeight: 400, color: "var(--muted)" }}>How the money moved</small></h4>
            <SplitPaymentInput
              totalAmount={total} initialLines={initialLines} scrollInternally={false} label={null}
              onChange={(s, rem, b) => { setPreview(null); setErr(""); setSplit(s); setRemaining(rem); setBankId(b); }}
            />
          </>
        )}
        {mode === "delete" && (
          <p style={{ marginBottom: 12 }}>
            Delete the <b>{KIND_LABEL[kind] || "entry"}</b> of <b>{fmt(r.entryAmount ?? r.amount)}</b> dated <b>{r.date.slice(0, 10)}</b>? Its cash-ledger line is removed too.
            {isPayout && " The payout goes back to Pending."}
          </p>
        )}
        {preview && (
          <div style={{ marginTop: 12 }}>
            <label className="f">What changes on the investment</label>
            <div className="tbl-wrap"><table className="tbl">
              <thead><tr><th></th><th className="num">Before</th><th className="num">After</th></tr></thead>
              <tbody>
                {numRow("Principal invested", preview.before.invested, preview.after.invested)}
                {live && numRow("Principal outstanding", preview.before.outstandingPrincipal, preview.after.outstandingPrincipal)}
                {live && numRow("Interest outstanding", preview.before.outstandingInterest, preview.after.outstandingInterest)}
                {numRow("Interest paid", preview.before.totalInterestPaid, preview.after.totalInterestPaid)}
                {textRow("Payouts paid", preview.before.paidPayouts, preview.after.paidPayouts)}
                {textRow("Start date", preview.before.startDate, preview.after.startDate)}
                {textRow("Maturity date", preview.before.maturityDate, preview.after.maturityDate)}
                {textRow("Status", preview.before.status, preview.after.status)}
              </tbody>
            </table></div>
          </div>
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
