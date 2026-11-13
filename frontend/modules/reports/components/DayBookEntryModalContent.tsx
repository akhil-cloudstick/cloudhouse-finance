"use client";

import { useRef, useState } from "react";
import { useModal } from "@/common/components/ModalProvider";
import { useToast } from "@/common/components/ToastProvider";
import { Icon } from "@/common/components/Icon";
import { FieldError } from "@/common/components/ui/FieldError";
import { DatePicker } from "@/common/components/ui/DatePicker";
import { ApiError } from "@/common/services/httpClient";
import { singleFlight } from "@/common/utils/singleFlight";
import { createDayBookEntry, updateDayBookEntry } from "@/modules/reports/services/reportsService";
import { type DayBookRow } from "@/modules/reports/types/reports-types";

type DayBookEntryModalContentProps = { entry?: DayBookRow; onSaved?: () => void };

/* Add or edit one Day Book line: the date, its particulars and a debit, credit and/or interest
 * amount. Opened from the Day Book report and from the dashboard's Quick actions. Each validation message
 * sits under its own field; only a failed save shows in the footer. */
export function DayBookEntryModalContent({ entry, onSaved }: DayBookEntryModalContentProps) {
  const { closeModal } = useModal();
  const toast = useToast();
  const now = new Date();
  const today = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;
  const amountText = (v?: number) => (v ? String(v) : "");

  const [date, setDate] = useState(entry?.date ?? today);
  const [particulars, setParticulars] = useState(entry?.particulars ?? "");
  const [debit, setDebit] = useState(amountText(entry?.debit));
  const [credit, setCredit] = useState(amountText(entry?.credit));
  const [interest, setInterest] = useState(amountText(entry?.interest));
  const [err, setErr] = useState("");
  const [fe, setFe] = useState<{ date?: string; particulars?: string; amount?: string }>({});
  const [saving, setSaving] = useState(false);
  const submittingRef = useRef(false);

  const num = (s: string) => (s.trim() === "" ? 0 : Number(s));

  async function save() { return singleFlight("modal:daybook:save", async () => {
    if (submittingRef.current) return;
    const values = { debit: num(debit), credit: num(credit), interest: num(interest) };
    const next: { date?: string; particulars?: string; amount?: string } = {};
    if (!date) next.date = "Pick the date.";
    if (!particulars.trim()) next.particulars = "Enter the particulars.";
    if (Object.values(values).some((v) => !Number.isFinite(v) || v < 0)) next.amount = "Amounts must be zero or more.";
    else if (!values.debit && !values.credit && !values.interest) next.amount = "Enter at least one of debit, credit or interest.";
    setFe(next);
    if (Object.keys(next).length) return;
    submittingRef.current = true;
    setErr("");
    setSaving(true);
    try {
      const input = { date, particulars: particulars.trim(), ...values };
      if (entry) await updateDayBookEntry(entry.id, input);
      else await createDayBookEntry(input);
      onSaved?.();
      closeModal();
      toast(entry ? "Day book entry updated" : "Day book entry added");
    } catch (e) {
      setErr(e instanceof ApiError ? e.message : "Could not save the entry — try again.");
    } finally {
      submittingRef.current = false;
      setSaving(false);
    }
  }); }

  const clearErr = (k?: "date" | "particulars" | "amount") => { setErr(""); if (k) setFe((f) => ({ ...f, [k]: undefined })); };

  return (
    <>
      <div className="hd"><h3>{entry ? "Edit Day Book Entry" : "Day Book Entry"}</h3><button className="x" onClick={closeModal}>×</button></div>
      <div className="bd bd-scroll">
        <div className="frow c2">
          <div className={fe.date ? "has-err" : undefined}><label className="f">Date *</label><DatePicker value={date} max={today} onChange={(v) => { clearErr("date"); setDate(v); }} /><FieldError msg={fe.date} /></div>
          <div className={fe.particulars ? "has-err" : undefined}><label className="f">Particulars *</label>
            <input className="inp" placeholder="e.g. Office rent, LN-00144 interest" value={particulars} maxLength={255} autoComplete="off" onChange={(e) => { clearErr("particulars"); setParticulars(e.target.value); }} /><FieldError msg={fe.particulars} /></div>
        </div>
        <div className="frow c2">
          <div className={fe.amount ? "has-err" : undefined}><label className="f">Debit (₹) *</label>
            <input className="inp" type="number" min={0} step="0.01" inputMode="decimal" placeholder="0" value={debit} onChange={(e) => { clearErr("amount"); setDebit(e.target.value); }} /></div>
          <div className={fe.amount ? "has-err" : undefined}><label className="f">Credit (₹) *</label>
            <input className="inp" type="number" min={0} step="0.01" inputMode="decimal" placeholder="0" value={credit} onChange={(e) => { clearErr("amount"); setCredit(e.target.value); }} /></div>

        </div>
        <div className="frow c2">
          <div className={fe.amount ? "has-err" : undefined}><label className="f">Interest (₹) *</label>
            <input className="inp" type="number" min={0} step="0.01" inputMode="decimal" placeholder="0" value={interest} onChange={(e) => { clearErr("amount"); setInterest(e.target.value); }} /></div>
        </div>
        <FieldError msg={fe.amount} />
      </div>
      <div className="ft">
        <span className="pay-ft-msg">{err}</span>
        <button className="btn" onClick={save} disabled={saving}><Icon name="check" /> {saving ? "Saving…" : entry ? "Save Changes" : "Add Entry"}</button>
      </div>
    </>
  );
}
