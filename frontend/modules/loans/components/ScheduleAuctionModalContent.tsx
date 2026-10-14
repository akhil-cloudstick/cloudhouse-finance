"use client";

import { useState } from "react";
import { useModal } from "@/common/components/ModalProvider";
import { useToast } from "@/common/components/ToastProvider";
import { Icon } from "@/common/components/Icon";
import { DatePicker } from "@/common/components/ui/DatePicker";
import { scheduleAuction } from "@/modules/loans/services/loanService";
import { type AuctionRecordView, type LoanView } from "@/modules/loans/types/loan-types";
import { ApiError } from "@/common/services/httpClient";
import { singleFlight } from "@/common/utils/singleFlight";
import { FieldError, fieldForMessage } from "@/common/components/ui/FieldError";

type ScheduleAuctionModalContentProps = { loan: LoanView; onSaved: (rec: AuctionRecordView) => void; onError?: () => void };

export function ScheduleAuctionModalContent({ loan, onSaved, onError }: ScheduleAuctionModalContentProps) {
  const { closeModal } = useModal();
  const toast = useToast();
  const today = new Date().toISOString().slice(0, 10);
  const [date, setDate] = useState(today);
  const [ref, setRef] = useState("");
  const [err, setErr] = useState("");
  const [fe, setFe] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState(false);

  const fail = (field: string, msg: string) => { setErr(""); setFe({ [field]: msg }); };

  async function save() { return singleFlight("auction-modal:save:2", async () => {
    setErr(""); setFe({});
    if (!date) { fail("date", "Please select the auction date."); return; }
    setSaving(true);
    try {
      const rec = await scheduleAuction(loan.numericId, date, ref.trim() || undefined);
      onSaved(rec);
      closeModal();
      toast(`Auction scheduled for ${loan.id}`);
    } catch (e) {
      const msg = e instanceof ApiError ? e.message : "Could not schedule the auction — try again.";
      const field = fieldForMessage(msg, { ref: /reference/i, date: /date/i });
      if (field) fail(field, msg); else { setFe({}); setErr(msg); }
      onError?.(); // see IssueNoticeModalContent's onError comment above
    } finally {
      setSaving(false);
    }
  }); }

  return (
    <>
      <div className="hd"><h3>Schedule Auction — {loan.id}</h3><button className="x" onClick={closeModal}>×</button></div>
      <div className="bd bd-scroll">
        <div className="frow c2">
          <div className={fe.date ? "has-err" : undefined}><label className="f">Auction Date *</label><DatePicker value={date} onChange={(v) => { setDate(v); setFe((cur) => ({ ...cur, date: "" })); }} /><FieldError msg={fe.date} /></div>
          <div className={fe.ref ? "has-err" : undefined}><label className="f">Reference Number</label><input className="inp" value={ref} onChange={(e) => { setRef(e.target.value); setFe((cur) => ({ ...cur, ref: "" })); }} /><FieldError msg={fe.ref} /></div>
        </div>
        <p style={{ color: "var(--red)", fontSize: 12.5, minHeight: 16, marginTop: 8 }}>{err}</p>
      </div>
      <div className="ft">
        <button className="btn ghost" onClick={closeModal}>Cancel</button>
        <button className="btn" onClick={save} disabled={saving}><Icon name="check" /> {saving ? "Saving…" : "Schedule"}</button>
      </div>
    </>
  );
}
