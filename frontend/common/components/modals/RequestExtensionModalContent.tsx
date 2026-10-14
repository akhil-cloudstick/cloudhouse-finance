"use client";

import { useRef, useState } from "react";
import { useModal } from "@/common/components/ModalProvider";
import { useToast } from "@/common/components/ToastProvider";
import { Icon } from "@/common/components/Icon";
import { fmt, fmtW, fmtDate } from "@/common/utils/format";
import { createExtensionRequest } from "@/modules/loans/services/loanService";
import { type LoanView } from "@/modules/loans/types/loan-types";
import { ApiError } from "@/common/services/httpClient";
import { PaymentModalContent } from "@/common/components/modals/PaymentModalContent";
import { singleFlight } from "@/common/utils/singleFlight";
import { FieldError, fieldForMessage } from "@/common/components/ui/FieldError";

// Which field a server message is about, by its words (first match wins).
const SERVER_FIELDS: Record<string, RegExp> = { months: /month/i };

type RequestExtensionModalContentProps = { loan: LoanView; onSaved: () => void };

/* Logs a customer's ask to push a loan's due date out. Staff decide on it
 * later from the Extensions & Release page (modules/loans/pages/RequestsPage.tsx) — this
 * only records the request, it does not change the loan's due date itself. */
export function RequestExtensionModalContent({ loan, onSaved }: RequestExtensionModalContentProps) {
  const { closeModal, openModal } = useModal();
  const toast = useToast();

  const [months, setMonths] = useState("3");
  const [detail, setDetail] = useState("");
  const [err, setErr] = useState("");
  // Validation messages, each shown under the field it is about; `err` keeps the ones that fit no field.
  const [fe, setFe] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState(false);
  // The backend refuses the request outright while arrears stand (see
  // Service.CreateExtensionRequest's ErrExtensionNeedsPayment) — checked
  // here too so the form leads with "pay first" instead of only surfacing
  // it as a submit-time error after months/detail are already filled in.
  const hasArrears = loan.outstandingInterest > 0.01 || loan.outstandingPenalInterest > 0.01;
  // Belt-and-braces alongside disabled={saving} on the button below: a fast
  // real (or synthetic double-tap) click can fire both handlers before
  // React re-renders with the disabled attribute applied, since setSaving
  // only takes effect on the NEXT render — a plain ref flips synchronously,
  // before either click's async work starts, so the second click's own call
  // sees it already set and bails out instead of logging a second, duplicate
  // request.
  const submittingRef = useRef(false);

  async function save() { return singleFlight("modal:requestextension:save:1", async () => {
    const m = +months;
    setErr(""); setFe({});
    if (!m || m <= 0) { setFe({ months: "Please enter how many months to extend by." }); return; }
    if (submittingRef.current) return;
    submittingRef.current = true;
    setSaving(true);
    try {
      const created = await createExtensionRequest(loan.numericId, m, detail.trim() || `+${m} month${m === 1 ? "" : "s"}`);
      onSaved();
      closeModal();
      // With the loan_extension approval flow switched off the backend
      // applies the extension on creation — the request comes back Approved.
      toast(created.status === "Approved" ? `Extension applied — ${loan.id}'s due date updated` : `Extension request logged for ${loan.id}`);
    } catch (e) {
      const msg = e instanceof ApiError ? e.message : "Could not log the request — try again.";
      const field = fieldForMessage(msg, SERVER_FIELDS);
      if (field) setFe({ [field]: msg }); else setErr(msg);
    } finally {
      submittingRef.current = false;
      setSaving(false);
    }
  }); }

  return (
    <>
      <div className="hd"><h3>Request Extension — {loan.id}</h3><button className="x" onClick={closeModal}>×</button></div>
      <div className="bd bd-scroll">
        <div className="notice" style={{ marginBottom: 16 }}>
          <Icon name="clock" /> Currently due {fmtDate(loan.due)} · {fmtW(loan.totalNetWeight)} gold pledged
        </div>
        {hasArrears && (
          <div className="notice" style={{ marginBottom: 16, color: "var(--red)" }}>
            <Icon name="shield" />
            Outstanding interest {fmt(loan.outstandingInterest)}{loan.outstandingPenalInterest > 0.01 ? ` + penal interest ${fmt(loan.outstandingPenalInterest)}` : ""} must be paid.
            {" "}
            <a
              href="#"
              onClick={(e) => { e.preventDefault(); openModal(<PaymentModalContent loan={loan} onSaved={() => { onSaved(); toast("Payment recorded — you can now request the extension."); closeModal(); }} />, true); }}
              style={{ textDecoration: "underline", cursor: "pointer" }}
            >
              Record Payment
            </a>
          </div>
        )}
        <div className="frow c2">
          <div className={fe.months ? "has-err" : undefined}><label className="f">Extend By (months) *</label><input className="inp" type="number" min={1} value={months} onChange={(e) => { setMonths(e.target.value); setFe({}); }} disabled={hasArrears} /><FieldError msg={fe.months} /></div>
          <div><label className="f">Note</label><input className="inp" placeholder="optional detail" value={detail} onChange={(e) => setDetail(e.target.value)} disabled={hasArrears} /></div>
        </div>
        <p style={{ color: "var(--red)", fontSize: 12.5, minHeight: 16, marginTop: 8 }}>{err}</p>
      </div>
      <div className="ft">
        <button className="btn ghost" onClick={closeModal}>Cancel</button>
        <button className="btn" onClick={save} disabled={saving || hasArrears} title={hasArrears ? "Pay the outstanding interest/penal interest first" : undefined}>
          <Icon name="check" /> {saving ? "Saving…" : "Log Request"}
        </button>
      </div>
    </>
  );
}
