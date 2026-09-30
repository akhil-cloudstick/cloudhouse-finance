"use client";

import { useEffect, useState } from "react";
import { useModal } from "@/product/components/Modal";
import { useToast } from "@/product/components/Toast";
import { useAuth } from "@/product/providers/auth-context";
import { StageTracker } from "@/product/components/ui/StageTracker";
import { Icon } from "@/product/components/Icon";
import { fmt } from "@/product/utils/format";
import { approveExtensionRequest, getLoan, type PaymentView, type RequestView, type LoanView } from "@/product/pages/loans/services/loanService";
import { ApiError } from "@/product/services/httpClient";
import { PaymentModalContent } from "@/product/components/modals/PaymentModal";
import { ConfirmModalContent } from "@/product/components/modals/ConfirmModal";

const EXTENSION_STAGES = ["LoanOfficer", "BranchManager", "Management"] as const;
type ExtensionStage = (typeof EXTENSION_STAGES)[number];

const STAGE_LABELS: Record<ExtensionStage, string> = {
  LoanOfficer: "Loan Officer",
  BranchManager: "Branch Manager",
  Management: "Management",
};

// Display-only now — whose "turn" this label names in the "Awaiting <role>
// approval" text below. Who can actually ACT is a real permission grant
// (STAGE_PERMISSIONS below), not a role-name match; an admin can grant a
// stage's permission to any role, not just the one this label names.
const STAGE_ROLES: Record<ExtensionStage, string> = {
  LoanOfficer: "Loan Operator",
  BranchManager: "Branch Manager",
  Management: "Management",
};

// The "Loan Extension Approval" permission actually checked server-side (backend/
// internal/loan/service.go's extensionChain/checkStagePermission).
const STAGE_PERMISSIONS: Record<ExtensionStage, string> = {
  LoanOfficer: "can_verify_the_loan_extension",
  BranchManager: "can_approve_extension_branch_manager_stage",
  Management: "can_approve_extension_management_stage",
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
 * backend/internal/loan/service.go's ApproveExtensionRequest), gated by the
 * "Loan Extension Approval" permissions (see internal/authz.Catalogue) rather
 * than a hardcoded role-name match. */
export function ExtensionReviewModalContent({ request, onSaved }: { request: RequestView; onSaved: () => void }) {
  const { closeModal, openModal } = useModal();
  const toast = useToast();
  const { can } = useAuth();
  // canActOnStage below decides whose turn it is in the chain; this decides
  // whether the viewer may act on requests at all — without it the
  // approve/reject pair never renders (see Requests.tsx).
  const canDecide = can("Loan_Management", "can_update_loan");

  const [req, setReq] = useState(request);
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState("");
  // The interest/penal-interest arrears that had to be cleared before this
  // request could even be logged (see CreateExtensionRequest's
  // ErrExtensionNeedsPayment) isn't stored on the request itself — it's
  // just whatever payment(s) the loan's own ledger shows around
  // req.requestedAt. Fetched here (not carried on RequestView) so this
  // modal always reflects the loan's real payment history rather than a
  // snapshot that could drift from it.
  const [clearingPayments, setClearingPayments] = useState<PaymentView[] | null>(null);
  // Fetched purely to hand to PaymentModalContent if Approve gets bounced
  // for still-unpaid arrears — see needsPayment below.
  const [loan, setLoan] = useState<LoanView | null>(null);
  // Reveals the Record Payment prompt only after ApproveExtensionRequest
  // actually refuses with ErrExtensionNeedsPayment — hidden otherwise, same
  // pattern as ReleaseReviewModal's Top-Up Payment reveal.
  const [needsPayment, setNeedsPayment] = useState(false);
  const [rejectReason, setRejectReason] = useState("");

  useEffect(() => {
    getLoan(request.loanNumericId).then(setLoan).catch(() => setLoan(null));
  }, [request.loanNumericId]);

  useEffect(() => {
    let cancelled = false;
    getLoan(req.loanNumericId)
      .then((loan) => {
        if (cancelled) return;
        const cutoff = req.requestedAt.slice(0, 10);
        const relevant = loan.payments
          .filter((p) => (p.interestApplied > 0.01 || p.penalInterestApplied > 0.01) && p.paidOn <= cutoff)
          .sort((a, b) => (a.paidOn < b.paidOn ? 1 : -1));
        setClearingPayments(relevant.slice(0, 3));
      })
      .catch(() => { /* best-effort — the review still works without this context */ });
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [req.loanNumericId, req.requestedAt]);

  const stageKey = stageKeyFor(req.approvalStage);
  const stageIndex = stageKey ? EXTENSION_STAGES.indexOf(stageKey) : EXTENSION_STAGES.length;
  const requiredRole = stageKey ? STAGE_ROLES[stageKey] : null;
  const canActOnStage = !!stageKey && can("Loan_Extension_Approval", STAGE_PERMISSIONS[stageKey]);

  async function decide(action: "Approved" | "Rejected", remarks = "") {
    if (!stageKey) return;
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
      if (e instanceof ApiError && e.status === 400 && /outstanding interest/i.test(e.message)) {
        // ErrExtensionNeedsPayment — arrears have re-accrued past what they
        // were when this request was raised. Reveal the Record Payment
        // prompt instead of just showing the raw error.
        setNeedsPayment(true);
        setErr("Outstanding interest/penal interest must be paid before this extension can be approved — record a payment below, then try approving again.");
      } else {
        setErr(e instanceof ApiError ? e.message : "Could not record the decision — try again.");
      }
    } finally {
      setSaving(false);
    }
  }

  function promptReject() {
    openModal(
      <ConfirmModalContent
        title="Reject Extension Request"
        confirmLabel="Reject"
        busyLabel="Rejecting…"
        onConfirm={() => decide("Rejected", rejectReason)}
      >
        <div className="frow">
          <div>
            <label className="f">Reason for rejecting (optional)</label>
            <input
              className="inp"
              autoFocus
              value={rejectReason}
              onChange={(e) => setRejectReason(e.target.value)}
              placeholder="optional"
            />
          </div>
        </div>
      </ConfirmModalContent>
    );
  }

  return (
    <>
      <div className="hd">
        <h3>Review Extension — {req.loanNumber}</h3>
        <button className="x" onClick={closeModal}>×</button>
      </div>
      <div className="bd bd-scroll">
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
        {clearingPayments && clearingPayments.length > 0 && (
          <div className="notice" style={{ marginBottom: 14 }}>
            <Icon name="check" /> Interest paid to clear arrears before this request:
            <ul style={{ margin: "4px 0 0", paddingLeft: 18 }}>
              {clearingPayments.map((p) => (
                <li key={p.id}>
                  {p.paidOn} — {fmt(p.interestApplied)}{p.penalInterestApplied > 0.01 ? ` + ${fmt(p.penalInterestApplied)} penal` : ""} via {p.method}
                </li>
              ))}
            </ul>
          </div>
        )}

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
        {needsPayment && loan && (
          <div style={{ marginTop: 12 }}>
            <label className="f">Record Payment</label>
            <p className="ccheck-hint" style={{ marginBottom: 8 }}>Clear the outstanding interest/penal interest, then try Approve again.</p>
            <button
              className="btn ghost sm"
              onClick={() => openModal(
                <PaymentModalContent
                  loan={loan}
                  onSaved={() => { setNeedsPayment(false); setErr(""); getLoan(request.loanNumericId).then(setLoan); }}
                />
              )}
            >
              <Icon name="coin" /> Record Payment
            </button>
          </div>
        )}
        <p style={{ color: "var(--red)", fontSize: 12.5, minHeight: 16, marginTop: 8 }}>{err}</p>
      </div>
      <div className="ft">
        <button className="btn ghost" onClick={closeModal}>Close</button>
        {req.status === "Pending" && stageKey && canActOnStage && canDecide && (
          <>
            <button className="btn danger" disabled={saving} onClick={promptReject}>Reject</button>
            <button className="btn" disabled={saving} onClick={() => decide("Approved")}>
              <Icon name="check" /> Approve ({STAGE_LABELS[stageKey]})
            </button>
          </>
        )}
      </div>
    </>
  );
}
