"use client";

import { useRef, useState } from "react";
import { useModal } from "@/common/components/Modal";
import { useToast } from "@/common/components/Toast";
import { Icon } from "@/common/components/Icon";
import { Select } from "@/common/components/ui/Select";
import { fmt, fmtW } from "@/common/utils/format";
import { createExtensionRequest, createReleaseRequest, type LoanView } from "@/modules/loans/services/loanService";
import { ApiError } from "@/common/services/httpClient";
import { PaymentModalContent } from "@/common/components/modals/PaymentModal";

/* Logs a customer's ask to push a loan's due date out. Staff decide on it
 * later from the Extensions & Release page (components/Requests.tsx) — this
 * only records the request, it does not change the loan's due date itself. */
export function RequestExtensionModalContent({ loan, onSaved }: { loan: LoanView; onSaved: () => void }) {
  const { closeModal, openModal } = useModal();
  const toast = useToast();

  const [months, setMonths] = useState("3");
  const [detail, setDetail] = useState("");
  const [err, setErr] = useState("");
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
      <div className="bd bd-scroll">
        <div className="notice" style={{ marginBottom: 16 }}>
          <Icon name="clock" /> Currently due {loan.due} · {fmtW(loan.totalNetWeight)} gold pledged
        </div>
        {hasArrears && (
          <div className="notice" style={{ marginBottom: 16, color: "var(--red)" }}>
            <Icon name="shield" />
            Outstanding interest {fmt(loan.outstandingInterest)}{loan.outstandingPenalInterest > 0.01 ? ` + penal interest ${fmt(loan.outstandingPenalInterest)}` : ""} must be paid before an extension can be requested.
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
          <div><label className="f">Extend By (months) *</label><input className="inp" type="number" min={1} value={months} onChange={(e) => setMonths(e.target.value)} disabled={hasArrears} /></div>
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

// Mirrors backend/internal/loan/service.go's partialReleaseRemaining — the
// same buffered formula the server re-checks on submit, computed here too
// so staff get live feedback as they check/uncheck ornaments instead of a
// round trip per click. buffer = 5% of principal, absorbing ordinary drift
// between selection and Manager/Management approval.
function partialReleaseRemaining(outstandingBalance: number, principalAmount: number, remainingGoldValue: number, ltvPercent: number): number {
  const buffer = 0.05 * principalAmount;
  return (outstandingBalance + buffer) - (remainingGoldValue * ltvPercent) / 100;
}

/* Step 1 of Request Release — pick which pledged ornaments come out this
 * time. Selecting every ornament (the default — all start checked) is
 * exactly today's full release, unchanged: the "Remaining" collateral math
 * below only matters once staff starts UNchecking something. Reuses
 * LoanDetail.tsx's own Pledged Ornaments table column layout so the two
 * screens read as the same table. */
function ReleaseOrnamentSelector({ loan, onContinue, onCancel }: { loan: LoanView; onContinue: (ornamentIds: number[]) => void; onCancel: () => void }) {
  const pledged = loan.ornaments.filter((o) => !o.releasedAt);
  const [selected, setSelected] = useState<Set<number>>(new Set(pledged.map((o) => o.id)));

  function toggle(id: number) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  }

  const allSelected = selected.size === pledged.length;
  const remainingOrnaments = pledged.filter((o) => !selected.has(o.id));
  const remainingCollateral = remainingOrnaments.reduce((sum, o) => sum + o.goldValue, 0);
  const eligibleOnRemaining = (remainingCollateral * loan.schemeLtv) / 100;
  // Full release (nothing unchecked) skips the LTV condition entirely on the
  // backend too — see CreateReleaseRequest's 100%-selection rule — so there
  // is nothing to show here in that case.
  const remaining = allSelected ? 0 : partialReleaseRemaining(loan.totalOutstandingBalance, loan.principal, remainingCollateral, loan.schemeLtv);
  const conditionMet = allSelected || remaining <= 0.01;

  return (
    <>
      <div className="hd"><h3>Request Release — {loan.id}</h3><button className="x" onClick={onCancel}>×</button></div>
      <div className="bd bd-scroll">
        <div className="kv" style={{ gridTemplateColumns: "1fr 1fr", marginBottom: 14 }}>
          <div className="i"><div className="k">Outstanding Balance</div><div className="v">{fmt(loan.totalOutstandingBalance)}</div></div>
          <div className="i"><div className="k">Scheme LTV</div><div className="v">{loan.schemeLtv}%</div></div>
        </div>
        <div className="tbl-wrap"><table className="tbl">
          <thead><tr><th style={{ width: 36 }}></th><th>Ornament</th><th>Purity</th><th className="num">Net (g)</th><th className="num">Gold Value</th></tr></thead>
          <tbody>
            {pledged.map((o) => (
              <tr key={o.id}>
                <td><input type="checkbox" checked={selected.has(o.id)} onChange={() => toggle(o.id)} /></td>
                <td>{o.name}</td>
                <td><span className="chip brand">{o.purity}</span></td>
                <td className="num">{o.netWeight.toFixed(1)}</td>
                <td className="num">{fmt(o.goldValue)}</td>
              </tr>
            ))}
          </tbody>
        </table></div>
        {/* Plain inline text, not a notice/toast banner — see the plan's
         * wireframe note on why these live figures stay out of `.notice`. */}
        <div className="kv" style={{ gridTemplateColumns: "1fr 1fr", marginTop: 14 }}>
          <div className="i"><div className="k">Remaining Collateral</div><div className="v">{fmt(remainingCollateral)}</div></div>
          <div className="i"><div className="k">Eligible On What Stays Pledged</div><div className="v">{fmt(eligibleOnRemaining)}</div></div>
          <div className="i"><div className="k">Remaining</div>
            <div className="v" style={{ color: conditionMet ? "var(--green, #1a7f37)" : "var(--red)" }}>
              {allSelected ? "Full release" : conditionMet ? "₹0 (condition met)" : fmt(remaining)}
            </div>
          </div>
        </div>
      </div>
      <div className="ft">
        <button className="btn ghost" onClick={onCancel}>Cancel</button>
        <button className="btn" disabled={!conditionMet || selected.size === 0} onClick={() => onContinue(Array.from(selected))}>
          <Icon name="check" /> Continue
        </button>
      </div>
    </>
  );
}

/* Step 2 — logs a customer's ask to release the ornaments selected in step 1
 * (or, if none were deselected, the whole loan — indistinguishable from
 * today's full release). Staff decide on it later — approving moves the
 * loan to "Closure Requested" (full) or releases just the selected
 * ornaments while the loan stays Active (partial); actual settlement still
 * happens through the existing Record Payment flow, now reachable directly
 * from the release review screen. */
function RequestReleaseNoteStep({ loan, ornamentIds, allSelected, onBack, onSaved }: { loan: LoanView; ornamentIds: number[]; allSelected: boolean; onBack: () => void; onSaved: () => void }) {
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
      // Passing every pledged ornament's id behaves identically to omitting
      // ornamentIds entirely — see createReleaseRequest's own doc comment —
      // so there is no separate "full release" branch to keep in sync here.
      await createReleaseRequest(loan.numericId, detail.trim() || (allSelected ? "Full settlement requested" : "Partial release requested"), ornamentIds);
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
      <div className="bd bd-scroll">
        <div className="kv" style={{ gridTemplateColumns: "1fr 1fr", marginBottom: 14 }}>
          <div className="i"><div className="k">Outstanding Principal</div><div className="v">{fmt(loan.outstanding)}</div></div>
          <div className="i"><div className="k">Outstanding Interest</div><div className="v">{fmt(loan.outstandingInterest)}</div></div>
          <div className="i"><div className="k">Outstanding Penal Interest</div><div className="v" style={{ color: loan.outstandingPenalInterest > 0 ? "var(--red)" : undefined }}>{fmt(loan.outstandingPenalInterest)}</div></div>
          <div className="i"><div className="k">Settlement (as of today)</div><div className="v" style={{ fontWeight: 600, color: "var(--brand-deep)" }}>{fmt(loan.settlementAmount)}</div></div>
        </div>
        <div className="notice" style={{ marginBottom: 16 }}>
          <Icon name="unlock" /> {allSelected ? `${fmtW(loan.totalNetWeight)} gold pledged` : `${ornamentIds.length} of ${loan.ornaments.filter((o) => !o.releasedAt).length} ornaments selected`} — staff will verify the gold was shown to the customer and record payment before release
        </div>
        <div className="frow"><div><label className="f">Note</label><input className="inp" placeholder="optional detail" value={detail} onChange={(e) => setDetail(e.target.value)} /></div></div>
        <p style={{ color: "var(--red)", fontSize: 12.5, minHeight: 16, marginTop: 8 }}>{err}</p>
      </div>
      <div className="ft">
        <button className="btn ghost" onClick={onBack}>Back</button>
        <button className="btn" onClick={save} disabled={saving}><Icon name="check" /> {saving ? "Saving…" : "Log Request"}</button>
      </div>
    </>
  );
}

/* Two-step Request Release: pick ornaments (ReleaseOrnamentSelector), then
 * the note/submit step (RequestReleaseNoteStep). A single-ornament loan (or
 * one already fully selected) simply lands on "Continue" with everything
 * checked — no special UI state needed, per the plan's wireframe. */
export function RequestReleaseModalContent({ loan, onSaved }: { loan: LoanView; onSaved: () => void }) {
  const { closeModal } = useModal();
  const pledgedCount = loan.ornaments.filter((o) => !o.releasedAt).length;
  const [step, setStep] = useState<{ ornamentIds: number[] } | null>(null);

  if (!step) {
    return <ReleaseOrnamentSelector loan={loan} onCancel={closeModal} onContinue={(ids) => setStep({ ornamentIds: ids })} />;
  }
  return (
    <RequestReleaseNoteStep
      loan={loan}
      ornamentIds={step.ornamentIds}
      allSelected={step.ornamentIds.length === pledgedCount}
      onBack={() => setStep(null)}
      onSaved={onSaved}
    />
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
      <div className="bd bd-scroll">
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
