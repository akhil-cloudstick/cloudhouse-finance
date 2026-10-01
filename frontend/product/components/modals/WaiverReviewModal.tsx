"use client";

import { useState } from "react";
import { useModal } from "@/product/components/Modal";
import { useToast } from "@/product/components/Toast";
import { useAuth, useApprovalWorkflow } from "@/product/providers/auth-context";
import { canActAtStage, chainFor, stageByPending, trackerLabels } from "@/product/services/approvalWorkflowService";
import { StageTracker } from "@/product/components/ui/StageTracker";
import { Icon } from "@/product/components/Icon";
import { fmt } from "@/product/utils/format";
import { approveWaiverRequest, type RequestView } from "@/product/pages/loans/services/loanService";
import { ApiError } from "@/product/services/httpClient";

/* Staff review screen for a Waiver/Adjustment request — shown from
 * Requests.tsx's "Review" button, modelled on ExtensionReviewModal. The
 * chain is the business's loan_waiver approval flow (Branch Manager ->
 * Management by default); the final enabled stage posts the waiver/
 * adjustment to the loan. Who may act at a stage is that stage's own
 * "Waiver Approval" permission grant. Reject takes its remarks inline —
 * the modal system holds one modal at a time, so a separate prompt would
 * replace this screen. */
export function WaiverReviewModalContent({ request, onSaved }: { request: RequestView; onSaved: () => void }) {
  const { closeModal } = useModal();
  const toast = useToast();
  const { can, role, isAdmin } = useAuth();
  const { config: workflow } = useApprovalWorkflow();
  // Same general "may act on requests at all" gate as the extension review.
  const canDecide = can("Loan_Management", "can_update_loan");

  const [req, setReq] = useState(request);
  const [remarks, setRemarks] = useState("");
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState("");

  const stageView = req.status === "Pending" ? stageByPending(workflow, "loan_waiver", req.approvalStage) : null;
  const chain = chainFor(workflow, "loan_waiver", req.status === "Pending" ? req.approvalStage : null);
  const stageIndex = stageView ? chain.findIndex((s) => s.key === stageView.key) : chain.length;
  const canActOnStage = canActAtStage({ role, isAdmin }, stageView);

  async function decide(action: "Approved" | "Rejected") {
    if (!stageView) return;
    setSaving(true);
    setErr("");
    try {
      const updated = await approveWaiverRequest(req.id, { stage: stageView.key, action, remarks: remarks.trim() || undefined });
      setReq(updated);
      setRemarks("");
      onSaved();
      if (updated.status !== "Pending") closeModal();
      toast(
        action === "Rejected"
          ? `${req.type} request rejected`
          : updated.status === "Approved"
            ? `${req.type} of ${fmt(req.amount)} posted to ${req.loanNumber}`
            : `${stageView.label} stage approved`
      );
    } catch (e) {
      setErr(e instanceof ApiError ? e.message : "Could not record the decision — try again.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <>
      <div className="hd">
        <h3>Review {req.type} — {req.loanNumber}</h3>
        <button className="x" onClick={closeModal}>×</button>
      </div>
      <div className="bd bd-scroll">
        <div className="kv" style={{ gridTemplateColumns: "1fr 1fr", marginBottom: 14 }}>
          <div className="i">
            <div className="k">{req.type === "Waiver" ? "Interest / Penal Waived" : "Principal Adjusted"}</div>
            <div className="v">{fmt(req.amount)}</div>
          </div>
          <div className="i">
            <div className="k">Requested</div>
            <div className="v">{req.requestedAt}</div>
          </div>
          <div className="i" style={{ gridColumn: "1 / -1" }}>
            <div className="k">Reason</div>
            <div className="v">{req.detail || "—"}</div>
          </div>
        </div>

        {chain.length > 0 && (
          <StageTracker
            stages={trackerLabels(workflow, "loan_waiver", chain)}
            currentIndex={stageIndex}
            terminal={req.status === "Rejected" ? "Rejected" : undefined}
          />
        )}

        {req.status === "Pending" && stageView && (
          <p className="notice" style={{ marginTop: 12 }}>
            <Icon name="clock" /> {canActOnStage ? "Awaiting your" : "Awaiting"} {stageView.role} approval
          </p>
        )}
        {req.status === "Pending" && stageView && canActOnStage && canDecide && (
          <div className="frow" style={{ marginTop: 12 }}>
            <div>
              <label className="f">Remarks (required to reject)</label>
              <input className="inp" value={remarks} onChange={(e) => setRemarks(e.target.value)} placeholder="optional when approving" />
            </div>
          </div>
        )}
        {req.status !== "Pending" && req.remarks && (
          <p className="ccheck-hint" style={{ marginTop: 12 }}>Remarks: {req.remarks}</p>
        )}
        <p style={{ color: "var(--red)", fontSize: 12.5, minHeight: 16, marginTop: 8 }}>{err}</p>
      </div>
      <div className="ft">
        <button className="btn ghost" onClick={closeModal}>Close</button>
        {req.status === "Pending" && stageView && canActOnStage && canDecide && (
          <>
            <button
              className="btn danger"
              disabled={saving}
              onClick={() => (remarks.trim() ? decide("Rejected") : setErr("Please enter remarks before rejecting."))}
            >
              Reject
            </button>
            <button className="btn" disabled={saving} onClick={() => decide("Approved")}>
              <Icon name="check" /> Approve ({stageView.label})
            </button>
          </>
        )}
      </div>
    </>
  );
}
