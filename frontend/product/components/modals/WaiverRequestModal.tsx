"use client";

import { useRef, useState } from "react";
import { useModal } from "@/product/components/Modal";
import { useToast } from "@/product/components/Toast";
import { Icon } from "@/product/components/Icon";
import { Select } from "@/product/components/ui/Select";
import { fmt } from "@/product/utils/format";
import { ApiError } from "@/product/services/httpClient";
import { useApprovalWorkflow } from "@/product/providers/auth-context";
import { firstStage, isFlowOff } from "@/product/services/approvalWorkflowService";
import { createWaiverRequest, type LoanView } from "@/product/pages/loans/services/loanService";

/* Raises a Waiver (forgive outstanding interest + penal interest) or an
 * Adjustment (write down principal outstanding) against a loan. Goes through
 * the business's loan_waiver approval chain (Branch Manager -> Management by
 * default, reviewed from the Extensions & Release page); with that flow
 * switched off the backend posts it to the loan immediately. The limits
 * below mirror the backend's own checks, which remain the authority. */
export function WaiverRequestModalContent({ loan, onSaved }: { loan: LoanView; onSaved: () => void }) {
  const { closeModal } = useModal();
  const toast = useToast();
  const { config: workflow } = useApprovalWorkflow();
  const needsApproval = !isFlowOff(workflow, "loan_waiver");

  const [type, setType] = useState<"Waiver" | "Adjustment">("Waiver");
  const [amount, setAmount] = useState("");
  const [reason, setReason] = useState("");
  const [err, setErr] = useState("");
  const [saving, setSaving] = useState(false);
  // Same double-submit guard as RequestExtensionModal's submittingRef.
  const submittingRef = useRef(false);

  const interestDue = (loan.outstandingInterest ?? 0) + (loan.outstandingPenalInterest ?? 0);
  const limit = type === "Waiver" ? interestDue : loan.outstanding;
  const amt = +amount || 0;

  async function save() {
    if (!amt || amt <= 0) { setErr("Please enter the amount."); return; }
    if (amt > limit + 0.005) {
      setErr(type === "Waiver"
        ? `A waiver can't exceed the outstanding interest + penal interest (${fmt(interestDue)}).`
        : `An adjustment can't exceed the principal outstanding (${fmt(loan.outstanding)}).`);
      return;
    }
    if (!reason.trim()) { setErr("Please enter a reason."); return; }
    if (submittingRef.current) return;
    submittingRef.current = true;
    setSaving(true);
    setErr("");
    try {
      const created = await createWaiverRequest(loan.numericId, { type, amount: amt, reason: reason.trim() });
      onSaved();
      closeModal();
      if (created.status === "Approved") {
        toast(`${type} of ${fmt(amt)} posted to ${loan.id}`);
      } else {
        const first = firstStage(workflow, "loan_waiver");
        toast(`${type} submitted for approval${first ? ` — awaiting ${first.label}` : ""}`);
      }
    } catch (e) {
      setErr(e instanceof ApiError ? e.message : "Could not raise the request — try again.");
    } finally {
      submittingRef.current = false;
      setSaving(false);
    }
  }

  return (
    <>
      <div className="hd"><h3>Waiver / Adjustment — {loan.id}</h3><button className="x" onClick={closeModal}>×</button></div>
      <div className="bd bd-scroll">
        <div className="notice" style={{ marginBottom: 16, flexDirection: "column", alignItems: "stretch", gap: 4 }}>
          <div><Icon name="coin" /> Outstanding interest + penal: <b>{fmt(interestDue)}</b></div>
          <div><Icon name="coin" /> Principal outstanding: <b>{fmt(loan.outstanding)}</b></div>
        </div>
        <div className="frow c2">
          <div>
            <label className="f">Type *</label>
            <Select
              value={type}
              onChange={(v) => setType(v as "Waiver" | "Adjustment")}
              options={[
                { value: "Waiver", label: "Waiver (interest / penal)" },
                { value: "Adjustment", label: "Adjustment (principal)" },
              ]}
            />
          </div>
          <div>
            <label className="f">Amount (₹) *</label>
            <input className="inp" type="number" min={1} max={limit || undefined} value={amount} onChange={(e) => setAmount(e.target.value)} placeholder={`up to ${fmt(limit)}`} />
          </div>
        </div>
        <div className="frow">
          <div><label className="f">Reason *</label><input className="inp" value={reason} onChange={(e) => setReason(e.target.value)} placeholder="why this is being waived / adjusted" /></div>
        </div>
        {!needsApproval && (
          <p className="ccheck-hint" style={{ marginTop: 4 }}>Approval is switched off for waivers — this will be posted to the loan immediately.</p>
        )}
        <p style={{ color: "var(--red)", fontSize: 12.5, minHeight: 16, marginTop: 8 }}>{err}</p>
      </div>
      <div className="ft">
        <button className="btn ghost" onClick={closeModal}>Cancel</button>
        <button className="btn" onClick={save} disabled={saving}>
          <Icon name="check" /> {saving ? "Saving…" : needsApproval ? "Submit for Approval" : `Post ${type}`}
        </button>
      </div>
    </>
  );
}
