"use client";

import { useRef, useState } from "react";
import { useModal } from "@/common/components/Modal";
import { useToast } from "@/common/components/Toast";
import { Icon } from "@/common/components/Icon";
import { Select } from "@/common/components/ui/Select";
import { fmt, fmtW } from "@/common/utils/format";
import { createExtensionRequest, createReleaseRequest, type LoanView } from "@/modules/loans/services/loanService";
import { ApiError } from "@/common/services/httpClient";

/* Logs a customer's ask to push a loan's due date out. Staff decide on it
 * later from the Extensions & Release page (components/Requests.tsx) — this
 * only records the request, it does not change the loan's due date itself. */
export function RequestExtensionModalContent({ loan, onSaved }: { loan: LoanView; onSaved: () => void }) {
  const { closeModal } = useModal();
  const toast = useToast();

  const [months, setMonths] = useState("3");
  const [detail, setDetail] = useState("");
  const [err, setErr] = useState("");
  const [saving, setSaving] = useState(false);
  // Belt-and-braces alongside disabled={saving} on the button below: a fast
  // real (or synthetic double-tap) click can fire both handlers before
  // React re-renders with the disabled attribute applied, since setSaving
  // only takes effect on the NEXT render — a plain ref flips synchronously,
  // before either click's async work starts, so the second click's own call
  // sees it already set and bails out instead of logging a second, duplicate
  // request.
  const submittingRef = useRef(false);

  async function save() {
    const m = +months;
    if (!m || m <= 0) { setErr("Please enter how many months to extend by."); return; }
    if (submittingRef.current) return;
    submittingRef.current = true;
    setSaving(true);
    try {
      await createExtensionRequest(loan.numericId, m, detail.trim() || `+${m} month${m === 1 ? "" : "s"}`);
      onSaved();
      closeModal();
      toast(`Extension request logged for ${loan.id}`);
    } catch (e) {
      setErr(e instanceof ApiError ? e.message : "Could not log the request — try again.");
    } finally {
      submittingRef.current = false;
      setSaving(false);
    }
  }

  return (
    <>
      <div className="hd"><h3>Request Extension — {loan.id}</h3><button className="x" onClick={closeModal}>×</button></div>
      <div className="bd">
        <div className="notice" style={{ marginBottom: 16 }}>
          <Icon name="clock" /> Currently due {loan.due} · {fmtW(loan.totalNetWeight)} gold pledged
        </div>
        <div className="frow c2">
          <div><label className="f">Extend By (months) *</label><input className="inp" type="number" min={1} value={months} onChange={(e) => setMonths(e.target.value)} /></div>
          <div><label className="f">Note</label><input className="inp" placeholder="optional detail" value={detail} onChange={(e) => setDetail(e.target.value)} /></div>
        </div>
        <p style={{ color: "var(--red)", fontSize: 12.5, minHeight: 16, marginTop: 8 }}>{err}</p>
      </div>
      <div className="ft">
        <button className="btn ghost" onClick={closeModal}>Cancel</button>
        <button className="btn" onClick={save} disabled={saving}><Icon name="check" /> {saving ? "Saving…" : "Log Request"}</button>
      </div>
    </>
  );
}

/* Logs a customer's ask to close the loan and take their gold back. Staff
 * decide on it later — approving moves the loan to "Closure Requested";
 * actual closure still happens through the existing full-settlement
 * payment flow (LoanDetail.tsx's Record Payment). */
export function RequestReleaseModalContent({ loan, onSaved }: { loan: LoanView; onSaved: () => void }) {
  const { closeModal } = useModal();
  const toast = useToast();

  const [detail, setDetail] = useState("");
  const [err, setErr] = useState("");
  const [saving, setSaving] = useState(false);
  // See RequestExtensionModalContent's own submittingRef above for why this
  // is needed alongside disabled={saving} — a fast double-click was creating
  // two duplicate Release requests for the same loan.
  const submittingRef = useRef(false);

  async function save() {
    if (submittingRef.current) return;
    submittingRef.current = true;
    setSaving(true);
    try {
      await createReleaseRequest(loan.numericId, detail.trim() || "Full settlement requested");
      onSaved();
      closeModal();
      toast(`Release request logged for ${loan.id}`);
    } catch (e) {
      setErr(e instanceof ApiError ? e.message : "Could not log the request — try again.");
    } finally {
      submittingRef.current = false;
      setSaving(false);
    }
  }

  return (
    <>
      <div className="hd"><h3>Request Release — {loan.id}</h3><button className="x" onClick={closeModal}>×</button></div>
      <div className="bd">
        <div className="kv" style={{ gridTemplateColumns: "1fr 1fr", marginBottom: 14 }}>
          <div className="i"><div className="k">Outstanding Principal</div><div className="v">{fmt(loan.outstanding)}</div></div>
          <div className="i"><div className="k">Outstanding Interest</div><div className="v">{fmt(loan.outstandingInterest)}</div></div>
          <div className="i"><div className="k">Outstanding Penal Interest</div><div className="v" style={{ color: loan.outstandingPenalInterest > 0 ? "var(--red)" : undefined }}>{fmt(loan.outstandingPenalInterest)}</div></div>
          <div className="i"><div className="k">Settlement (as of today)</div><div className="v" style={{ fontWeight: 600, color: "var(--gold-deep)" }}>{fmt(loan.settlementAmount)}</div></div>
        </div>
        <div className="notice" style={{ marginBottom: 16 }}>
          <Icon name="unlock" /> {fmtW(loan.totalNetWeight)} gold pledged — staff will verify payment, packet location, bank pledge status, and customer confirmation before release
        </div>
        <div className="frow"><div><label className="f">Note</label><input className="inp" placeholder="optional detail" value={detail} onChange={(e) => setDetail(e.target.value)} /></div></div>
        <p style={{ color: "var(--red)", fontSize: 12.5, minHeight: 16, marginTop: 8 }}>{err}</p>
      </div>
      <div className="ft">
        <button className="btn ghost" onClick={closeModal}>Cancel</button>
        <button className="btn" onClick={save} disabled={saving}><Icon name="check" /> {saving ? "Saving…" : "Log Request"}</button>
      </div>
    </>
  );
}

/* Loan picker shown from CustomerDetail.tsx's "Request Extension / Release"
 * button — a customer can have multiple loans, so pick one first, then
 * choose which kind of request to log for it. Mirrors
 * RepledgeModal.tsx's SelectLoanForRepledgeModalContent. */
export function SelectLoanForRequestModalContent({ loans, onPicked }: { loans: LoanView[]; onPicked: (loan: LoanView, type: "Extension" | "Release") => void }) {
  const { closeModal } = useModal();
  const [loanId, setLoanId] = useState("");
  const [type, setType] = useState<"Extension" | "Release">("Extension");
  const [err, setErr] = useState("");

  const eligible = loans.filter((l) => l.status !== "Closed");
  const selected = eligible.find((l) => l.id === loanId);

  // Not blanket-disabled on `!selected` — see RepledgeModal.tsx's own
  // SelectLoanForRepledgeModalContent for why.
  function next() {
    if (!selected) { setErr("Please select a loan first."); return; }
    onPicked(selected, type);
  }

  return (
    <>
      <div className="hd"><h3>Request Extension / Release</h3><button className="x" onClick={closeModal}>×</button></div>
      <div className="bd">
        <div className="frow"><div><label className="f">Loan *</label>
          <Select
            options={[
              { value: "", label: "Select loan…" },
              ...eligible.map((l) => ({ value: l.id, label: `${l.id} — due ${l.due} (outstanding ₹${l.outstanding.toLocaleString("en-IN")})` })),
            ]}
            value={loanId}
            onChange={(v) => { setLoanId(v); setErr(""); }}
          /></div></div>
        <div className="frow"><div><label className="f">Request Type *</label>
          <Select
            options={[{ value: "Extension", label: "Extension" }, { value: "Release", label: "Release" }]}
            value={type}
            onChange={(v) => setType(v as "Extension" | "Release")}
          /></div></div>
        {eligible.length === 0 && (
          <p className="notice"><Icon name="shield" /> This customer has no open loans to request an extension or release for.</p>
        )}
        <p style={{ color: "var(--red)", fontSize: 12.5, minHeight: 16, marginTop: 8 }}>{err}</p>
      </div>
      <div className="ft">
        <button className="btn ghost" onClick={closeModal}>Cancel</button>
        <button className="btn" onClick={next}><Icon name="check" /> Next</button>
      </div>
    </>
  );
}
