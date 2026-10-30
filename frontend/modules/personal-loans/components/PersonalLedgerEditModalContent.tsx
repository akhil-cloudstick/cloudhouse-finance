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
import {
  editPersonalLoanPayment, deletePersonalLoanPayment, editPersonalLoanDisbursement, type PersonalLedgerEditPreview,
} from "@/modules/personal-loans/services/personalLoanService";
import { FollowingEntriesTable } from "@/modules/loans/components/FollowingEntriesTable";
import { InstalmentChangesTable } from "@/modules/personal-loans/components/InstalmentChangesTable";
import { type BackendPersonalLoanPayment } from "@/modules/personal-loans/types/personal-loan-types";

type Props = {
  loanId: number;
  entry: BackendPersonalLoanPayment; // a payment row, or the disbursement row
  bankId?: number | null; // the bank of the entry's UPI / Bank Transfer part
  mode: "edit" | "delete";
  minDate?: string;
  onSaved: () => void;
};

// Two steps: the first click asks the server what the change would do to the loan (nothing is saved), the second
// click saves it. Balances, instalments, status and the cash ledger line are recalculated.
export function PersonalLedgerEditModalContent({ loanId, entry: p, bankId: savedBankId, mode, minDate, onSaved }: Props) {
  const { closeModal } = useModal();
  const toast = useToast();
  const isDisbursement = p.kind === "disbursement";
  const [date, setDate] = useState((p.date || p.paidOn || "").slice(0, 10));
  const [amount, setAmount] = useState(String(p.amount));
  const initialLines: SplitPaymentLine[] = [
    p.cashAmount > 0 && { mode: "Cash" as const, amount: String(p.cashAmount) },
    p.upiAmount > 0 && { mode: "UPI" as const, amount: String(p.upiAmount), bankId: savedBankId ?? undefined, bankName: p.bankName },
    p.bankTransferAmount > 0 && { mode: "Bank Transfer" as const, amount: String(p.bankTransferAmount), bankId: savedBankId ?? undefined, bankName: p.bankName },
  ].filter(Boolean) as SplitPaymentLine[];
  const [split, setSplit] = useState<SplitAmounts>({ cashAmount: p.cashAmount, upiAmount: p.upiAmount, bankTransferAmount: p.bankTransferAmount, chequeAmount: 0 });
  const [remaining, setRemaining] = useState(0);
  const [bankId, setBankId] = useState<number | undefined>(savedBankId ?? undefined);
  const [reference, setReference] = useState(p.reference || "");
  const [preview, setPreview] = useState<PersonalLedgerEditPreview | null>(null);
  // The later payments that no longer fit: what each becomes, filled in with what it can still be and editable.
  const [follow, setFollow] = useState<Record<number, string>>({});
  const [err, setErr] = useState("");
  const [saving, setSaving] = useState(false);
  const now = new Date();
  const today = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;

  // Any change makes the shown preview stale.
  function changed(set: (v: string) => void) {
    return (v: string) => { setPreview(null); setErr(""); set(v); };
  }

  async function submit() {
    return singleFlight("modal:personal-ledger-edit", async () => {
      const dry = preview == null;
      setSaving(true);
      try {
        let res: PersonalLedgerEditPreview;
        if (mode === "delete") {
          res = await deletePersonalLoanPayment(loanId, p.id, dry);
        } else {
          const amt = isDisbursement ? p.amount : +amount;
          if (!(amt > 0)) { setErr("Enter a valid amount."); return; }
          if (Math.abs(remaining) > 0.01) { setErr(`The payment breakdown must add up to the amount (${fmt(amt)}).`); return; }
          if ((split.upiAmount > 0 || split.bankTransferAmount > 0) && !bankId) { setErr("Select the bank for the UPI / Bank Transfer part."); return; }
          const breakdown = { cashAmount: split.cashAmount, upiAmount: split.upiAmount, bankTransferAmount: split.bankTransferAmount, chequeAmount: 0, bankId };
          res = isDisbursement
            ? await editPersonalLoanDisbursement(loanId, { disbursedAt: date, ...breakdown }, dry)
            : await editPersonalLoanPayment(loanId, p.id, {
              paidOn: date, amount: amt, ...breakdown, reference,
              ...(!dry && preview?.following?.length ? { adjustFollowing: preview.following.map((f) => ({ id: f.id, amount: +(follow[f.id] ?? f.current) || 0 })) } : {}),
            }, dry);
        }
        if (dry) {
          setPreview(res);
          setFollow(Object.fromEntries((res.following ?? []).map((f) => [f.id, String(f.current)])));
          setErr("");
          return;
        }
        toast(mode === "delete" ? "Payment deleted" : "Entry updated");
        onSaved();
        closeModal();
      } catch (e) {
        const msg = e instanceof ApiError ? e.message : "Could not save the change — try again.";
        setErr(msg);
        // a later payment that still does not fit leaves the list on screen to be corrected
        if (!/can be at most|can only be lowered/.test(msg)) setPreview(null);
      } finally {
        setSaving(false);
      }
    });
  }

  return (
    <>
      <div className="hd"><h3>{mode === "delete" ? "Delete" : "Edit"} {isDisbursement ? "disbursement" : "payment"} entry</h3><button className="x" onClick={closeModal}>×</button></div>
      <div className="bd bd-scroll ledger-edit-bd">
        {mode === "edit" && (
          <>
            <div className="frow c2">
              <div><label className="f">Date *</label><DatePicker value={date} min={isDisbursement ? undefined : minDate} max={today} onChange={changed(setDate)} /></div>
              {isDisbursement ? (
                <div><label className="f">Amount (₹)</label><input className="inp" value={amount} disabled readOnly /></div>
              ) : (
                <div><label className="f">Amount (₹) *</label><input className="inp" type="number" min={0} value={amount} onChange={(e) => changed(setAmount)(e.target.value)} /></div>
              )}
            </div>
            {!isDisbursement && (
              <div className="frow">
                <div><label className="f">Reference</label><input className="inp" value={reference} onChange={(e) => changed(setReference)(e.target.value)} /></div>
              </div>
            )}
            <h4 style={{ margin: "14px 0 6px", fontSize: 13 }}>Payment breakdown</h4>
            <SplitPaymentInput
              totalAmount={+amount || 0} initialLines={initialLines} label={null}
              onChange={(s, r, b) => { setPreview(null); setErr(""); setSplit(s); setRemaining(r); setBankId(b); }}
            />
          </>
        )}
        {mode === "delete" && (
          <p style={{ marginBottom: 12 }}>
            Delete the payment of <b>{fmt(p.amount)}</b> dated <b>{(p.date || "").slice(0, 10)}</b>? Its cash-ledger line is removed too.
          </p>
        )}
        {preview && (
          <div style={{ marginTop: 12 }}>
            <label className="f">What changes on the loan</label>
            <div className="tbl-wrap"><table className="tbl">
              <thead><tr><th></th><th className="num">Before</th><th className="num">After</th></tr></thead>
              <tbody>
                <tr><td>Outstanding</td><td className="num">{fmt(preview.before.outstanding)}</td><td className="num" style={{ fontWeight: 600 }}>{fmt(preview.after.outstanding)}</td></tr>
                <tr><td>Total paid</td><td className="num">{fmt(preview.before.totalPaid)}</td><td className="num" style={{ fontWeight: 600 }}>{fmt(preview.after.totalPaid)}</td></tr>
                <tr><td>Status</td><td className="num">{preview.before.status}</td><td className="num">{preview.after.status}</td></tr>
              </tbody>
            </table></div>
            <InstalmentChangesTable changes={preview.instalmentChanges ?? []} />
            {!!preview.following?.length && (
              <FollowingEntriesTable entries={preview.following} values={follow} onChange={(id, v) => setFollow((cur) => ({ ...cur, [id]: v }))} />
            )}
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
