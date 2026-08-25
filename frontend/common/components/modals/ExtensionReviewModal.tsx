"use client";

import { useState } from "react";
import { useModal } from "@/common/components/Modal";
import { useToast } from "@/common/components/Toast";
import { useAuth } from "@/common/auth-context";
import { StageTracker } from "@/common/components/ui/StageTracker";
import { Icon } from "@/common/components/Icon";
import { approveExtensionRequest, type RequestView } from "@/modules/loans/services/loanService";
import { ApiError } from "@/common/services/httpClient";

const EXTENSION_STAGES = ["LoanOfficer", "BranchManager", "Management"] as const;
type ExtensionStage = (typeof EXTENSION_STAGES)[number];

const STAGE_LABELS: Record<ExtensionStage, string> = {
  LoanOfficer: "Loan Officer",
  BranchManager: "Branch Manager",
  Management: "Management",
};

// The role string actually checked server-side (backend/internal/loan/
// service.go's extensionChain) — "Loan Officer" is only ever a display
// label, the real role is "Loan Operator" (see employee.ValidRoles).
const STAGE_ROLES: Record<ExtensionStage, string> = {
  LoanOfficer: "Loan Operator",
  BranchManager: "Branch Manager",
  Management: "Management",
};

function stageKeyFor(approvalStage: string): ExtensionStage | null {
  switch (approvalStage) {
    case "PendingLoanOfficer":
      return "LoanOfficer";
    case "PendingBranchManager":
      return "BranchManager";
    case "PendingManagement":
      return "Management";
    default:
      return null;
  }
}

/* Staff review screen for a pending Extension request — shown from
 * Requests.tsx's "Review" button, mirroring ReleaseReviewModal's pattern.
 * Unlike Release, there's no verification checklist here — just the
 * 3-stage Loan Officer -> Branch Manager -> Management chain (see
 * backend/internal/loan/service.go's ApproveExtensionRequest), which IS
 * server-side role-gated (Administrator bypasses at any stage). */
export function ExtensionReviewModalContent({ request, onSaved }: { request: RequestView; onSaved: () => void }) {
  const { closeModal } = useModal();
  const toast = useToast();
  const { role: myRole } = useAuth();

  const [req, setReq] = useState(request);
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState("");

  const stageKey = stageKeyFor(req.approvalStage);
  const stageIndex = stageKey ? EXTENSION_STAGES.indexOf(stageKey) : EXTENSION_STAGES.length;
  const requiredRole = stageKey ? STAGE_ROLES[stageKey] : null;
  const canActOnStage = !!requiredRole && (myRole === "Administrator" || myRole === requiredRole);

  async function decide(action: "Approved" | "Rejected") {
    if (!stageKey) return;
    let remarks = "";
    if (action === "Rejected") {
      remarks = window.prompt("Reason for rejecting (optional):") || "";
    }
    setSaving(true);
    setErr("");
    try {
      // The acting employee/role is derived server-side from the logged-in
      // user's JWT — no employeeId/role sent from here.
      const updated = await approveExtensionRequest(req.id, { stage: stageKey, action, remarks });
      setReq(updated);
      onSaved();
      if (updated.status !== "Pending") closeModal();
      toast(
        action === "Approved"
          ? updated.status === "Approved"
            ? "Extension approved — due date updated"
            : `${STAGE_LABELS[stageKey]} stage approved`
          : "Extension request rejected"
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
        <h3>Review Extension — {req.loanNumber}</h3>
        <button className="x" onClick={closeModal}>×</button>
      </div>
      <div className="bd">
        <div className="kv" style={{ gridTemplateColumns: "1fr 1fr", marginBottom: 14 }}>
          <div className="i">
            <div className="k">Requested Extension</div>
            <div className="v">{req.requestedExtensionMonths ?? "—"} month(s)</div>
          </div>
          <div className="i">
            <div className="k">Requested</div>
            <div className="v">{req.requestedAt}</div>
          </div>
        </div>
        {req.detail && <p className="notice">{req.detail}</p>}

        <StageTracker
          stages={EXTENSION_STAGES.map((k) => STAGE_LABELS[k])}
          currentIndex={stageIndex}
          terminal={req.status === "Rejected" ? "Rejected" : undefined}
        />

        {req.status === "Pending" && stageKey && (
          <p className="notice" style={{ marginTop: 12 }}>
            <Icon name="clock" /> {canActOnStage ? "Awaiting your" : "Awaiting"} {requiredRole} approval
          </p>
        )}
        <p style={{ color: "var(--red)", fontSize: 12.5, minHeight: 16, marginTop: 8 }}>{err}</p>
      </div>
      <div className="ft">
        <button className="btn ghost" onClick={closeModal}>Close</button>
        {req.status === "Pending" && stageKey && canActOnStage && (
          <>
            <button className="btn danger" disabled={saving} onClick={() => decide("Rejected")}>Reject</button>
            <button className="btn" disabled={saving} onClick={() => decide("Approved")}>
              <Icon name="check" /> Approve ({STAGE_LABELS[stageKey]})
            </button>
          </>
        )}
      </div>
    </>
  );
}
