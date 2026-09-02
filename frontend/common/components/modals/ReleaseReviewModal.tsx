"use client";

import { useEffect, useState } from "react";
import { useModal } from "@/common/components/Modal";
import { useToast } from "@/common/components/Toast";
import { Icon } from "@/common/components/Icon";
import { fmt } from "@/common/utils/format";
import { getLoan, verifyReleaseChecklist, approveReleaseRequest, type RequestView, type LoanView } from "@/modules/loans/services/loanService";
import { ApiError } from "@/common/services/httpClient";
import { useAuth } from "@/common/auth-context";

/* Staff review screen for a pending Release request — shown from
 * Requests.tsx's "Review" button. Shows the loan's live principal/interest/
 * penal-interest/settlement figures (from Service.enrich), a Charges
 * override, and the four-item verification checklist (payment, packet
 * location, bank pledge, customer confirmation). All four must be ticked
 * before the Manager/Management approval buttons (the same chain used for
 * loan sanctioning) become usable — see backend/internal/loan/service.go's
 * ApproveReleaseRequest. */
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

  useEffect(() => {
    getLoan(request.loanNumericId).then(setLoan).catch(() => setLoan(null));
  }, [request.loanNumericId]);

  const checklistComplete = req.paymentVerified && req.packetVerified && req.bankPledgeVerified && req.customerConfirmed;
  const stage = req.approvalStage === "PendingManagement" ? "Management" : "Manager";
  const canActOnStage = can("Release_Approval", stage === "Management" ? "can_approve_release_management_stage" : "can_approve_release_manager_stage");

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
      toast(action === "Approved" ? `Release ${stage} stage approved` : "Release request rejected");
    } catch (e) {
      setErr(e instanceof ApiError ? e.message : "Could not record the decision — try again.");
    } finally {
      setSaving(false);
    }
  }

  const checklistItems: Array<[string, "paymentVerified" | "packetVerified" | "bankPledgeVerified" | "customerConfirmed", string]> = [
    ["Payment", "paymentVerified", "Final settlement has been paid (or will be, before Complete Release)"],
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
            <div className="inp" style={{ display: "flex", alignItems: "center", fontWeight: 600, color: "var(--gold-deep)" }}>
              {loan ? fmt(loan.totalOutstandingBalance + (+charges || 0)) : "—"}
            </div>
          </div>
        </div>

        <div style={{ margin: "14px 0" }}>
          <label className="f">Verification Checklist</label>
          {checklistItems.map(([label, field, hint]) => (
            <label key={field} className="ccheck" style={{ padding: "6px 0" }}>
              <input type="checkbox" checked={req[field]} disabled={saving || !canDecide || !canVerifyChecklist || req.status !== "Pending"} onChange={(e) => toggle(field, e.target.checked)} />
              <span className="mark" />
              <span>
                <b>{label}</b>
                <div style={{ fontSize: 12, color: "var(--muted)" }}>{hint}</div>
              </span>
            </label>
          ))}
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
