"use client";

import { useEffect, useState } from "react";
import { useModal } from "@/common/components/Modal";
import { useToast } from "@/common/components/Toast";
import { Icon } from "@/common/components/Icon";
import { DatePicker } from "@/common/components/ui/DatePicker";
import { fmt } from "@/common/utils/format";
import { getLoan, verifyReleaseChecklist, recordReleasePayment, approveReleaseRequest, type RequestView, type LoanView } from "@/modules/loans/services/loanService";
import { ApiError } from "@/common/services/httpClient";
import { useAuth } from "@/common/auth-context";

/* Staff review screen for a pending Release request — shown from
 * Requests.tsx's "Review" button. Shows the loan's live principal/interest/
 * penal-interest/settlement figures (from Service.enrich), a Charges
 * override, and the four-item verification checklist (payment, packet
 * location, bank pledge, customer confirmation). All four must be ticked
 * before the Manager/Management approval buttons (the same chain used for
 * loan sanctioning) become usable — see backend/internal/loan/service.go's
 * ApproveReleaseRequest. Once Management approves, the release completes
 * immediately (packet moved to Released, loan Closed) — there is no
 * further manual step.
 *
 * "Record Payment" — only while the request is still at (or before) the
 * Manager stage — reveals Discount/Payment inputs; entering amounts calls
 * RecordReleasePayment, which records the payment and, if it clears the
 * final settlement, marks it verified. Its checkbox is read-only display,
 * not a manual toggle: the backend (Service.syncPaymentVerified, called on
 * every fetch/approval) keeps it honest against the loan's LIVE balance
 * regardless of how the balance actually cleared — through these fields,
 * or the loan's own ordinary Record Payment screen instead — so approval
 * never gets stuck on a stale flag just because staff used a different
 * screen to collect the money. A shortfall requires a Due Date instead. */
export function ReleaseReviewModalContent({ request, onSaved }: { request: RequestView; onSaved: () => void }) {
  const { closeModal } = useModal();
  const toast = useToast();
  // Without "can update loan" this modal is a read-only view: the checklist
  // toggles stay locked and the approve/reject pair never renders (see
  // Requests.tsx, which labels the row button View in that case).
  const { can } = useAuth();
  const canDecide = can("Loan_Management", "can_update_loan");
  // Checklist verification and the two Manager/Management approval stages
  // each need their own "Release Approval" permission on top of the
  // general canDecide gate — previously ungated entirely (any signed-in
  // staff member with "can update loan" could tick the checklist or
  // approve either stage); see internal/authz.Catalogue and backend/
  // internal/loan/service.go's VerifyReleaseChecklist/ApproveReleaseRequest.
  const canVerifyChecklist = can("Release_Approval", "can_verify_release_checklist");

  const [loan, setLoan] = useState<LoanView | null>(null);
  const [req, setReq] = useState(request);
  const [charges, setCharges] = useState(String(request.charges || 0));
  const [notes, setNotes] = useState(request.verificationNotes || "");
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState("");

  // recordPaymentMode is a pure UI expand/collapse for the Discount/Payment
  // fields — NOT the same thing as req.paymentVerified (the actual
  // checklist condition, which only flips true once a recorded payment
  // clears the final settlement in full; see the checkbox below).
  const [recordPaymentMode, setRecordPaymentMode] = useState(
    request.paymentVerified || request.recordedDiscount > 0 || request.recordedPayment > 0
  );
  // Each RecordReleasePayment call posts Discount/Payment as NEW amounts on
  // top of whatever was already recorded before (req.recordedDiscount/
  // recordedPayment accumulate server-side — see service.go's
  // RecordReleasePayment). These fields must therefore start at 0, not at
  // the already-recorded totals: pre-filling them with the running total
  // (as this used to) meant re-opening this modal — or just clicking Save
  // again without editing anything — resubmitted the SAME amount as a
  // second increment, double-charging the loan and, once that overshot
  // what was actually still owed, failing with "amount does not match
  // what is owed for this payment type".
  const [discount, setDiscount] = useState("0");
  const [payment, setPayment] = useState("0");
  const [dueDate, setDueDate] = useState(request.paymentDueDate || "");
  const today = new Date().toISOString().slice(0, 10);

  useEffect(() => {
    getLoan(request.loanNumericId).then(setLoan).catch(() => setLoan(null));
  }, [request.loanNumericId]);

  const checklistComplete = req.paymentVerified && req.packetVerified && req.bankPledgeVerified && req.customerConfirmed;
  const stage = req.approvalStage === "PendingManagement" ? "Management" : "Manager";
  const canActOnStage = can("Release_Approval", stage === "Management" ? "can_approve_release_management_stage" : "can_approve_release_manager_stage");

  // RecordReleasePayment (unlike the checklist toggles/charges) is refused
  // server-side once the request has moved past the Manager stage — see
  // ErrNotManagerStage. Gating it here too just keeps the inputs from
  // appearing for a request already at/through Management review.
  const canRecordPayment = req.approvalStage === "" || req.approvalStage === "PendingManager";
  // Discount+Payment together need to cover the loan's outstanding balance
  // PLUS whatever part of Charges hasn't been collected yet — Payment gets
  // that still-unapplied charge folded directly into it server-side (see
  // Service.RecordReleasePayment), so Payment must be big enough for both
  // its own share of the balance and Charges, same as the on-screen "Final
  // Settlement" figure below. Using `charges - req.chargesApplied` (not the
  // raw Charges figure) means a Charges amount already collected by an
  // earlier Save Payment click isn't asked for a second time here.
  const unappliedCharges = Math.max(0, (+charges || 0) - req.chargesApplied);
  const settlementTarget = loan ? loan.totalOutstandingBalance + unappliedCharges : undefined;
  // alreadyRecorded is what previous Save Payment click(s) already applied
  // — the new discount/payment inputs are on top of that, not instead of it.
  const alreadyRecorded = req.recordedDiscount + req.recordedPayment;
  const remaining = settlementTarget != null ? settlementTarget - alreadyRecorded - (+discount || 0) - (+payment || 0) : undefined;
  const needsDueDate = remaining != null && remaining > 0.01;
  const isOverdue = !!req.paymentDueDate && !req.paymentVerified && new Date(req.paymentDueDate) < new Date();

  async function savePayment() {
    if (needsDueDate && !dueDate) {
      setErr("A due date is required for the remaining balance.");
      return;
    }
    setSaving(true);
    setErr("");
    try {
      const updated = await recordReleasePayment(req.id, {
        discount: +discount || 0,
        payment: +payment || 0,
        dueDate: needsDueDate ? dueDate : undefined,
      });
      setReq(updated);
      onSaved();
      // The Outstanding*/Final Settlement figures above come from `loan`,
      // fetched once on mount — without refreshing it here they'd keep
      // showing the PRE-payment balance after a successful save, making it
      // look like nothing was recorded even though it was.
      getLoan(request.loanNumericId).then(setLoan).catch(() => {});
      // Reset back to 0 — these are increments on top of
      // updated.recordedDiscount/recordedPayment, not the running totals,
      // so leaving the just-submitted amounts in the fields would resubmit
      // them a second time on the next Save Payment click.
      setDiscount("0");
      setPayment("0");
      // Never closes the loan from here — recording a payment only ever
      // records the payment (and, if it clears the balance, ticks the
      // PaymentVerified checklist item). The request stays open for the
      // usual Manager→Management approval chain below.
      toast(needsDueDate ? `Payment recorded — due ${dueDate}` : "Payment recorded — balance cleared");
    } catch (e) {
      setErr(e instanceof ApiError ? e.message : "Could not record the payment — try again.");
    } finally {
      setSaving(false);
    }
  }

  async function toggle(field: "paymentVerified" | "packetVerified" | "bankPledgeVerified" | "customerConfirmed", value: boolean) {
    setSaving(true);
    setErr("");
    try {
      const updated = await verifyReleaseChecklist(req.id, { [field]: value });
      setReq(updated);
    } catch (e) {
      setErr(e instanceof ApiError ? e.message : "Could not update the checklist — try again.");
    } finally {
      setSaving(false);
    }
  }

  async function saveChargesAndNotes() {
    setSaving(true);
    setErr("");
    try {
      const updated = await verifyReleaseChecklist(req.id, { charges: +charges || 0, verificationNotes: notes });
      setReq(updated);
      toast("Saved");
    } catch (e) {
      setErr(e instanceof ApiError ? e.message : "Could not save — try again.");
    } finally {
      setSaving(false);
    }
  }

  async function decide(action: "Approved" | "Rejected") {
    setSaving(true);
    setErr("");
    try {
      // The acting employee is derived server-side from the logged-in
      // user's JWT — no employeeId sent from here.
      await approveReleaseRequest(req.id, { stage, action });
      onSaved();
      closeModal();
      if (action !== "Approved") {
        toast("Release request rejected");
      } else if (stage === "Management") {
        // Management is the last stage — the backend completes the release
        // (packet released, loan closed) in the same call, not a separate step.
        toast("Release approved — gold released, loan closed");
      } else {
        toast(`Release ${stage} stage approved`);
      }
    } catch (e) {
      setErr(e instanceof ApiError ? e.message : "Could not record the decision — try again.");
    } finally {
      setSaving(false);
    }
  }

  const checklistItems: Array<[string, "packetVerified" | "bankPledgeVerified" | "customerConfirmed", string]> = [
    ["Packet Location", "packetVerified", "Pledged gold's packet location has been physically confirmed"],
    ["Bank Pledge", "bankPledgeVerified", "No active bank pledge remains against this loan"],
    ["Customer Confirmation", "customerConfirmed", "Customer has confirmed the release in person"],
  ];

  return (
    <>
      <div className="hd"><h3>Review Release — {req.loanNumber}</h3><button className="x" onClick={closeModal}>×</button></div>
      <div className="bd">
        {loan ? (
          <div className="kv" style={{ gridTemplateColumns: "1fr 1fr", marginBottom: 14 }}>
            <div className="i"><div className="k">Outstanding Principal</div><div className="v">{fmt(loan.outstanding)}</div></div>
            <div className="i"><div className="k">Outstanding Interest</div><div className="v">{fmt(loan.outstandingInterest)}</div></div>
            <div className="i"><div className="k">Outstanding Penal Interest</div><div className="v" style={{ color: loan.outstandingPenalInterest > 0 ? "var(--red)" : undefined }}>{fmt(loan.outstandingPenalInterest)}</div></div>
            <div className="i"><div className="k">Total Paid So Far</div><div className="v">{fmt(loan.totalPaid)}</div></div>
          </div>
        ) : (
          <p className="notice">Loading loan financials…</p>
        )}

        <div className="frow c2">
          <div><label className="f">Charges (₹)</label><input className="inp" type="number" min={0} value={charges} disabled={!canDecide} onChange={(e) => setCharges(e.target.value)} onBlur={saveChargesAndNotes} /></div>
          <div><label className="f">Final Settlement</label>
            <div className="inp" style={{ display: "flex", alignItems: "center", fontWeight: 600, color: "var(--brand-deep)" }}>
              {/* Net of whatever Charges a previous Save Payment click already
                  collected (settlementTarget = outstanding + unappliedCharges)
                  — otherwise this would keep showing the full Charges amount
                  forever after it was actually paid, looking like Charges
                  never got collected. */}
              {settlementTarget != null ? fmt(settlementTarget) : "—"}
            </div>
          </div>
        </div>

        <div style={{ margin: "14px 0" }}>
          <label className="f">Verification Checklist</label>

          {/* checked reflects req.paymentVerified — kept honest against the
           * loan's live balance server-side regardless of how it clears
           * (this screen's own Discount/Payment fields below, or the
           * loan's ordinary Record Payment screen instead — see
           * Service.syncPaymentVerified/VerifyReleaseChecklist), so
           * approval never gets stuck on a stale flag. The checkbox itself
           * just expands/collapses the fields below; the real state comes
           * from the backend on every load, not from clicking it. */}
          <label className="ccheck" style={{ padding: "6px 0", cursor: canRecordPayment ? "pointer" : "default" }} onClick={(e) => { e.preventDefault(); if (canRecordPayment) setRecordPaymentMode((v) => !v); }}>
            <input type="checkbox" checked={req.paymentVerified} disabled readOnly />
            <span className="mark" />
            <span>
              <b>Record Payment</b>
              <div className="ccheck-hint">
                {canRecordPayment
                  ? "Enter a discount and/or payment against the final settlement"
                  : "Past the Manager review stage — recorded through Complete Release instead"}
              </div>
            </span>
          </label>

          {recordPaymentMode && (
            <div style={{ padding: "4px 0 10px 28px" }}>
              {alreadyRecorded > 0 && (
                <div style={{ fontSize: 12, color: "var(--muted)", marginBottom: canRecordPayment ? 6 : 0 }}>
                  Already recorded: {fmt(req.recordedDiscount)} discount + {fmt(req.recordedPayment)} payment.
                  {canRecordPayment ? " The fields below are for an ADDITIONAL amount, on top of that." : ""}
                </div>
              )}
              {/* Past the Manager stage, RecordReleasePayment itself is
                  refused server-side (see canRecordPayment's own comment
                  above) — the Discount/Payment/Due-Date inputs and Save
                  button would just be dead weight here, not a form staff can
                  actually still submit, so they're skipped entirely instead
                  of rendering disabled and empty. */}
              {canRecordPayment && (
                <>
                  <div className={`frow ${needsDueDate ? "c3" : "c2"}`}>
                    <div><label className="f">Discount (₹)</label><input className="inp" type="number" min={0} disabled={saving || !canDecide || req.status !== "Pending"} value={discount} onChange={(e) => {
                      const nextDiscount = e.target.value;
                      setDiscount(nextDiscount);
                      // Payment re-prefills with whatever's left of the final
                      // settlement (minus anything already recorded before)
                      // after this discount, each time Discount changes —
                      // staff can still edit Payment by hand afterward, this
                      // only recomputes the starting point.
                      if (settlementTarget != null) {
                        setPayment(String(Math.max(0, +(settlementTarget - alreadyRecorded - (+nextDiscount || 0)).toFixed(2))));
                      }
                    }} /></div>
                    <div><label className="f">Payment (₹)</label><input className="inp" type="number" min={0} disabled={saving || !canDecide || req.status !== "Pending"} value={payment} onChange={(e) => setPayment(e.target.value)} /></div>
                    {needsDueDate && (
                      <div>
                        <label className="f">Due Date</label>
                        <DatePicker value={dueDate} onChange={setDueDate} min={today} disabled={saving || !canDecide || req.status !== "Pending"} />
                      </div>
                    )}
                  </div>
                  {req.status === "Pending" && canDecide && (
                    <button className="btn sm" style={{ marginTop: 8 }} disabled={saving} onClick={savePayment}>
                      Save Payment
                    </button>
                  )}
                </>
              )}
              {isOverdue && (
                <p className="notice" style={{ color: "var(--red)", marginTop: 8 }}>
                  <Icon name="shield" /> Payment overdue — due date was {req.paymentDueDate}, balance still outstanding.
                </p>
              )}
            </div>
          )}

          <div className="ccheck-grid">
            {checklistItems.map(([label, field, hint]) => (
              <label key={field} className="ccheck" style={{ padding: "6px 0" }}>
                <input type="checkbox" checked={req[field]} disabled={saving || !canDecide || !canVerifyChecklist || req.status !== "Pending"} onChange={(e) => toggle(field, e.target.checked)} />
                <span className="mark" />
                <span>
                  <b>{label}</b>
                  <div className="ccheck-hint">{hint}</div>
                </span>
              </label>
            ))}
          </div>
        </div>

        <div className="frow"><div><label className="f">Verification Notes</label><input className="inp" value={notes} disabled={!canDecide} onChange={(e) => setNotes(e.target.value)} onBlur={saveChargesAndNotes} placeholder="optional" /></div></div>

        {!checklistComplete && req.status === "Pending" && (
          <p className="notice" style={{ marginTop: 12 }}><Icon name="shield" /> All four checklist items must be ticked before this can be approved.</p>
        )}
        {req.status === "Pending" && checklistComplete && (
          <p className="notice" style={{ marginTop: 12 }}><Icon name="clock" /> Awaiting {stage} approval — same chain used for loan sanctioning.</p>
        )}
        <p style={{ color: "var(--red)", fontSize: 12.5, minHeight: 16, marginTop: 8 }}>{err}</p>
      </div>
      <div className="ft">
        <button className="btn ghost" onClick={closeModal}>Close</button>
        {req.status === "Pending" && canDecide && canActOnStage && (
          <>
            <button className="btn danger" disabled={saving} onClick={() => decide("Rejected")}>Reject</button>
            <button className="btn" disabled={saving || !checklistComplete} onClick={() => decide("Approved")}>
              <Icon name="check" /> Approve ({stage})
            </button>
          </>
        )}
      </div>
    </>
  );
}
