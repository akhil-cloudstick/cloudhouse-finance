"use client";

import { useEffect, useState } from "react";
import { TruncText } from "@/common/components/ui/TruncText";
import { useModal } from "@/common/components/ModalProvider";
import { useToast } from "@/common/components/ToastProvider";
import { useAuth, useApprovalWorkflow } from "@/common/providers/AuthProvider";
import { canActAtStage, chainFor, isFinalStage, stageByPending } from "@/common/services/approvalWorkflowService";
import { StageTracker } from "@/common/components/StageTracker";
import { Icon } from "@/common/components/Icon";
import { fmt, fmtW, fmtDate, addMonthsISO } from "@/common/utils/format";
import { approveExtensionRequest, getLoan } from "@/modules/loans/services/loanService";
import { type RequestView, type LoanView } from "@/modules/loans/types/loan-types";
import { ApiError } from "@/common/services/httpClient";
import { PaymentModalContent } from "@/common/components/modals/PaymentModalContent";
import { ConfirmModalContent } from "@/common/components/modals/ConfirmModalContent";
import { singleFlight } from "@/common/utils/singleFlight";

type ExtensionReviewModalContentProps = { request: RequestView; onSaved: () => void };

const STATUS_CHIP: Record<RequestView["status"], string> = { Pending: "amber", Approved: "green", Rejected: "red" };

/* Staff review screen for a pending Extension request — shown from
 * Requests.tsx's "Review" button, mirroring ReleaseReviewModal's pattern.
 * Unlike Release, there's no verification checklist here — just the
 * extension approval chain (Loan Officer -> Branch Manager -> Management by
 * default; which stages apply is per-business configuration, flow
 * "loan_extension" — see approvalWorkflowService.ts and backend
 * ApproveExtensionRequest). Who may act at a stage is that stage's own
 * "Loan Extension Approval" permission grant, not a role-name match; the
 * stage's role is display-only ("Awaiting <role> approval"). */
export function ExtensionReviewModalContent({ request, onSaved }: ExtensionReviewModalContentProps) {
	const { closeModal, openModal, openChildModal } = useModal();
	const toast = useToast();
	const { can, role, isSystem } = useAuth();
	const { config: workflow } = useApprovalWorkflow();
	// canActOnStage below decides whose turn it is in the chain; this decides
	// whether the viewer may act on requests at all — without it the
	// approve/reject pair never renders (see Requests.tsx).
	const canDecide = can("Loan_Management", "can_update_loan");

	const [req, setReq] = useState(request);
	const [saving, setSaving] = useState(false);
	const [err, setErr] = useState("");
	// The loan's current due date and interest for the right-hand panel, and
	// what PaymentModalContent needs if Approve gets bounced for still-unpaid
	// arrears — see needsPayment below.
	const [loan, setLoan] = useState<LoanView | null>(null);
	// Reveals the Record Payment prompt only after ApproveExtensionRequest
	// actually refuses with ErrExtensionNeedsPayment — hidden otherwise, same
	// pattern as ReleaseReviewModal's Top-Up Payment reveal.
	const [needsPayment, setNeedsPayment] = useState(false);
	const [rejectReason, setRejectReason] = useState("");

	useEffect(() => {
		getLoan(request.loanNumericId).then(setLoan).catch(() => setLoan(null));
	}, [request.loanNumericId]);

	// Looked up in this business's configured chain — a request parked on a
	// stage that has since been switched off still resolves (and stays on the
	// tracker via chainFor), since it can still be acted on there.
	const stageView = req.status === "Pending" ? stageByPending(workflow, "loan_extension", req.approvalStage) : null;
	const stageKey = stageView?.key ?? null;
	const chain = chainFor(workflow, "loan_extension", req.status === "Pending" ? req.approvalStage : null);
	const stageIndex = stageKey ? chain.findIndex((s) => s.key === stageKey) : chain.length;
	const requiredRole = stageView?.role ?? null;
	const canActOnStage = canActAtStage({ role, isSystem }, stageView);
	// Approving at the last stage is what moves the due date, so there the button just says Extend.
	const finalStage = !!stageKey && isFinalStage(workflow, "loan_extension", stageKey);

	const months = req.requestedExtensionMonths ?? 0;
	// A pending request has not moved the due date yet, so the new one is the loan's due + the months. A decided one
	// just shows the loan's due date today — working back from it would be wrong after any later extension.
	const pending = req.status === "Pending";
	const dueAfter = loan ? (pending ? addMonthsISO(loan.due, months) : loan.due) : "";
	const arrears = loan ? loan.outstandingInterest + loan.outstandingPenalInterest : 0;

	async function decide(action: "Approved" | "Rejected", remarks = "") { return singleFlight("modal:extensionreview:decide", async () => {
		if (!stageKey) return;
		setSaving(true);
		setErr("");
		try {
			// The acting employee/role is derived server-side from the logged-in
			// user's JWT — no employeeId/role sent from here.
			const updated = await approveExtensionRequest(req.id, { stage: stageKey, action, remarks }, req);
			setReq(updated);
			onSaved();
			if (updated.status !== "Pending") closeModal();
			toast(
				action === "Approved"
					? updated.status === "Approved"
						? "Extension approved — due date updated"
						: `${stageView?.label ?? stageKey} stage approved`
					: "Extension request rejected"
			);
		} catch (e) {
			if (e instanceof ApiError && e.status === 400 && /outstanding interest/i.test(e.message)) {
				// ErrExtensionNeedsPayment — arrears have re-accrued past what they
				// were when this request was raised. Reveal the Record Payment
				// prompt instead of just showing the raw error.
				setNeedsPayment(true);
        setErr("Clear the outstanding interest before approving.");
			} else {
				setErr(e instanceof ApiError ? e.message : "Could not record the decision — try again.");
			}
		} finally {
			setSaving(false);
		}
	}); }

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
                  			maxLength={150}
							onChange={(e) => setRejectReason(e.target.value)}
							placeholder="optional"
						/>
					</div>
				</div>
			</ConfirmModalContent>
		);
	}

	// Opens on "Interest only", prefilled with exactly the arrears that block the approval.
	function openPayment() {
		if (!loan) return;
		openChildModal(
			<PaymentModalContent
				loan={loan}
				initialMode="Interest"
				onSaved={() => { setNeedsPayment(false); setErr(""); getLoan(request.loanNumericId).then(setLoan); }}
			/>,
			true
		);
	}

  return (
    <>
      <div className="hd">
        <h3>Review Extension — {req.loanNumber}</h3>
        <button className="x" onClick={closeModal}>×</button>
      </div>
      <div className="bd bd-scroll ext-modal-bd">
        <div className="pay-layout">
          <div className="pay-form">
            {needsPayment && loan && (
              <div className="ext-block">
                <div className="ext-block-tx">
                  <b>Interest must be cleared first</b>
                  <span>{fmt(arrears)} is outstanding — record it, then approve again.</span>
                </div>
                <button className="btn sm" onClick={openPayment}><Icon name="coin" /> Pay {fmt(arrears)}</button>
              </div>
            )}
            <div className="pay-sec">
              <div className="pay-sec-t">Request <span className={`chip ${STATUS_CHIP[req.status]}`} style={{ marginLeft: 6 }}>{req.status}</span></div>
              <div className="kv" style={{ gridTemplateColumns: "1fr 1fr" }}>
                <div className="i"><div className="k">Extend By</div><div className="v">{months ? `${months} month${months === 1 ? "" : "s"}` : "—"}</div></div>
                <div className="i"><div className="k">Requested On</div><div className="v">{fmtDate(req.requestedAt)}</div></div>
                <div className="i"><div className="k">Customer</div><div className="v">{req.customerName}</div></div>
                <div className="i"><div className="k">Gold Pledged</div><div className="v">{loan ? fmtW(loan.totalNetWeight) : "—"}</div></div>
                {req.detail && <div className="i" style={{ gridColumn: "1 / -1", minWidth: 0, border: "none", boxShadow: "none" }}><div className="k">Note</div><div className="v" style={{ minWidth: 0, overflow: "hidden", border: "none", boxShadow: "none", textDecoration: "none" }}><TruncText text={req.detail} maxWidth="100%" /></div></div>}
                {req.status === "Rejected" && req.remarks && <div className="i" style={{ gridColumn: "1 / -1", minWidth: 0 }}><div className="k">Reason Rejected</div><div className="v" style={{ minWidth: 0, overflow: "hidden" }}><TruncText text={req.remarks} maxWidth="100%" /></div></div>}
              </div>
            </div>

						{/* No tracker when the flow has no stages at all (an extension
							* raised then was applied on creation); a single approver shows
							* only the "Awaiting" line, so nothing is left once approved. */}
						{(chain.length > 1 || (chain.length === 1 && req.status !== "Approved")) && (
							<div className="pay-sec">
								<div className="pay-sec-t">Approval</div>
								<StageTracker
									stages={chain.map((s) => s.label)}
									currentIndex={stageIndex}
									terminal={req.status === "Rejected" ? "Rejected" : undefined}
								/>
								{pending && stageKey && (
									<p className="notice" style={{ marginTop: 12 }}>
										<Icon name="clock" /> {canActOnStage ? "Awaiting your" : "Awaiting"} {requiredRole} approval
									</p>
								)}
							</div>
						)}
					</div>

					<aside className="pay-receipt">
						<div className="pay-r-cap">{pending ? "New due date" : "Loan due date"}</div>
						<div className="pay-r-big">{dueAfter ? fmtDate(dueAfter) : "—"}</div>
						<div className="pay-r-cap">{pending ? (loan && months ? `+${months} month${months === 1 ? "" : "s"} from ${fmtDate(loan.due)}` : "") : req.status === "Approved" ? "Extension applied" : "Extension not applied"}</div>

						{pending && loan && (
							<>
								<div className="pay-r-h pay-r-div">Interest</div>
								<div className="pay-r-row"><span style={{ color: "var(--muted)" }}>Outstanding</span><b>{fmt(arrears)}</b></div>
								{arrears > 0.01
									? <div className="pay-r-warn">Must be paid before the extension can be approved.</div>
									: <div className="pay-r-ok"><Icon name="check" /> Interest is clear</div>}
							</>
						)}
					</aside>
				</div>
			</div>
			<div className="ft">
				<span className="pay-ft-msg">{err}</span>
				{pending && stageKey && canActOnStage && canDecide && (
					<>
						<button className="btn danger" disabled={saving} onClick={promptReject}>Reject</button>
						<button className="btn" disabled={saving} onClick={() => decide("Approved")}>
              <Icon name="check" /> {finalStage ? "Extend" : "Approve"}
						</button>
					</>
				)}
			</div>
		</>
	);
}
