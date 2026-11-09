"use client";

import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useModal } from "@/common/components/ModalProvider";
import { useToast } from "@/common/components/ToastProvider";
import { useAuth, useApprovalWorkflow } from "@/common/providers/AuthProvider";
import { canActAtStage, enabledStages, stageByPending } from "@/common/services/approvalWorkflowService";
import { Icon } from "@/common/components/Icon";
import { fmt, fmtW, fmtDate, addMonthsISO } from "@/common/utils/format";
import { createExtensionRequest, getLoan } from "@/modules/loans/services/loanService";
import { type LoanView } from "@/modules/loans/types/loan-types";
import { ApiError } from "@/common/services/httpClient";
import { PaymentModalContent } from "@/common/components/modals/PaymentModalContent";
import { singleFlight } from "@/common/utils/singleFlight";
import { FieldError, fieldForMessage } from "@/common/components/ui/FieldError";

// Which field a server message is about, by its words (first match wins).
const SERVER_FIELDS: Record<string, RegExp> = { months: /month/i };

const monthsText = (m: number) => `${m} month${m === 1 ? "" : "s"}`;

// onPaid, when given, is called instead of onSaved after the arrears payment (onSaved then means "request logged" only).
type RequestExtensionModalContentProps = { loan: LoanView; onSaved: () => void; onPaid?: () => void };

/* Logs a customer's ask to push a loan's due date out. Staff decide on it
 * later from the Extensions & Release page (modules/loans/pages/RequestsPage.tsx) — this
 * only records the request, it does not change the loan's due date itself.
 *
 * With no extension approver configured the backend applies the extension the
 * moment it is raised, so there it is called "Extend" and first opens a review
 * popup (current → new due date) with Edit to go back, since nobody else will
 * look at it before the due date moves. The same holds when the signed-in user
 * is the one and only approver. More generally the backend approves the first
 * stage for whoever raises the request when that stage is theirs. */
export function RequestExtensionModalContent({ loan: initialLoan, onSaved, onPaid }: RequestExtensionModalContentProps) {
	const { closeModal, openChildModal } = useModal();
	const toast = useToast();
	const { can, role, isSystem } = useAuth();
	const { config: workflow } = useApprovalWorkflow();
	const approvers = enabledStages(workflow, "loan_extension");
	// The user is the final approver with nobody before them — their own approval is the last word.
	const soleApprover = approvers.length === 1 && canActAtStage({ role, isSystem }, approvers[0]) && can("Loan_Management", "can_update_loan");
	const appliesNow = approvers.length === 0 || soleApprover;

	// Re-read on open: this form is shown again after the Record Payment popup closes, and the arrears the caller's
	// copy still carries would keep the form locked.
	const [loan, setLoan] = useState(initialLoan);
	useEffect(() => {
		getLoan(initialLoan.numericId).then(setLoan).catch(() => { /* keep the caller's copy */ });
	}, [initialLoan.numericId]);

	const [months, setMonths] = useState("3");
	const [detail, setDetail] = useState("");
	const [err, setErr] = useState("");
	// Validation messages, each shown under the field it is about; `err` keeps the ones that fit no field.
	const [fe, setFe] = useState<Record<string, string>>({});
	const [saving, setSaving] = useState(false);
	// True while the review popup is open over the form (no-approver case only).
	const [reviewing, setReviewing] = useState(false);
	// The backend refuses the request outright while arrears stand (see
	// Service.CreateExtensionRequest's ErrExtensionNeedsPayment) — checked
	// here too so the form leads with "pay first" instead of only surfacing
	// it as a submit-time error after months/detail are already filled in.
	const hasArrears = loan.outstandingInterest > 0.01 || loan.outstandingPenalInterest > 0.01;
	const arrears = loan.outstandingInterest + loan.outstandingPenalInterest;
	// Belt-and-braces alongside disabled={saving} on the button below: a fast
	// real (or synthetic double-tap) click can fire both handlers before
	// React re-renders with the disabled attribute applied, since setSaving
	// only takes effect on the NEXT render — a plain ref flips synchronously,
	// before either click's async work starts, so the second click's own call
	// sees it already set and bails out instead of logging a second, duplicate
	// request.
	const submittingRef = useRef(false);

	const m = +months;
	const monthsOk = Number.isInteger(m) && m > 0;
	const newDue = monthsOk ? addMonthsISO(loan.due, m) : "";

	// Opens the arrears payment on "Interest only", prefilled with exactly what blocks the extension.
	function openPayment() {
		openChildModal(
			<PaymentModalContent loan={loan} initialMode="Interest" onSaved={() => { (onPaid ?? onSaved)(); toast("Payment recorded — you can now request the extension."); }} />,
			true,
		);
	}

	function validate() {
		setErr(""); setFe({});
		if (!monthsOk) { setFe({ months: "Please enter how many whole months to extend by." }); return false; }
		return true;
	}

	// The footer button: straight to the server when an approver will look at it, else the review popup first.
	function submit() {
		if (!validate()) return;
		if (appliesNow) { setReviewing(true); return; }
		void save();
	}

	async function save() { return singleFlight("modal:requestextension:save:1", async () => {
		if (!validate()) return;
		if (submittingRef.current) return;
		submittingRef.current = true;
		setSaving(true);
		try {
			// The backend approves the first stage itself when the requester holds it (SaveExtensionRequest), so a
			// one-stage chain the user approves — or no chain at all — comes back Approved and already applied.
			const created = await createExtensionRequest(loan.numericId, m, detail.trim() || `+${monthsText(m)}`);
			setReviewing(false);
			onSaved();
			closeModal();
			const waitingAt = created.status === "Pending" ? stageByPending(workflow, "loan_extension", created.approvalStage) : null;
			toast(
				created.status === "Approved"
					? `Extension applied — ${loan.id} now due ${fmtDate(newDue)}`
					: waitingAt && waitingAt.key !== approvers[0]?.key
						? `Extension request logged for ${loan.id} — your ${approvers[0].label} approval is done, now awaiting ${waitingAt.label}`
						: `Extension request logged for ${loan.id}`,
			);
		} catch (e) {
			const msg = e instanceof ApiError ? e.message : "Could not log the request — try again.";
			const field = fieldForMessage(msg, SERVER_FIELDS);
			if (field) setFe({ [field]: msg }); else setErr(msg);
			// Back to the form so the refused figures can be corrected.
			setReviewing(false);
		} finally {
			submittingRef.current = false;
			setSaving(false);
		}
	}); }

	const actionLabel = appliesNow ? "Extend" : "Log Request";

	return (
		<>
			<div className="hd"><h3>{appliesNow ? "Extend Loan" : "Request Extension"} — {loan.id}</h3><button className="x" onClick={closeModal}>×</button></div>
			<div className="bd bd-scroll ext-modal-bd">
				<div className="pay-layout">
					<div className="pay-form">
						{hasArrears && (
							<div className="ext-block">
								<div className="ext-block-tx">
									<b>Interest must be cleared first</b>
									<span>{fmt(loan.outstandingInterest)} interest{loan.outstandingPenalInterest > 0.01 ? ` + ${fmt(loan.outstandingPenalInterest)} penal interest` : ""} is outstanding on this loan.</span>
								</div>
								<button className="btn sm" onClick={openPayment}><Icon name="coin" /> Pay {fmt(arrears)}</button>
							</div>
						)}
						<div className="pay-sec">
							<div className="pay-sec-t">Extension</div>
							<div className="frow c2">
								<div className={fe.months ? "has-err" : undefined}>
									<label className="f">Extend By (months) *</label>
									<input className="inp" type="number" min={1} step={1} value={months} onChange={(e) => { setMonths(e.target.value); setFe({}); }} disabled={hasArrears} />
									<FieldError msg={fe.months} />
								</div>
								<div><label className="f">Note</label><input className="inp" placeholder="optional — why the customer needs more time" value={detail} onChange={(e) => setDetail(e.target.value)} disabled={hasArrears} /></div>
							</div>
						</div>
						<div className="pay-sec ext-sec-plain">
							<div className="pay-sec-t">Loan</div>
							<div className="kv" style={{ gridTemplateColumns: "1fr 1fr" }}>
								<div className="i"><div className="k">Customer</div><div className="v">{loan.customerName}</div></div>
								<div className="i"><div className="k">Gold Pledged</div><div className="v">{fmtW(loan.totalNetWeight)}</div></div>
								<div className="i"><div className="k">Principal Outstanding</div><div className="v">{fmt(loan.outstanding)}</div></div>
								<div className="i"><div className="k">Opened</div><div className="v">{fmtDate(loan.opened)}</div></div>
							</div>
						</div>
					</div>

					<aside className="pay-receipt">
						<div className="pay-r-cap">New due date</div>
						<div className="pay-r-big">{newDue ? fmtDate(newDue) : "—"}</div>
						<div className="pay-r-cap">{monthsOk ? `+${monthsText(m)} from ${fmtDate(loan.due)}` : "Enter the months"}</div>

						<div className="pay-r-h pay-r-div">Interest</div>
						<div className="pay-r-row"><span style={{ color: "var(--muted)" }}>Outstanding</span><b>{fmt(arrears)}</b></div>
						{/* The red banner above the form already says to clear the interest; no second warning here. */}
						{!hasArrears && <div className="pay-r-ok"><Icon name="check" /> Interest is clear</div>}
					</aside>
				</div>
			</div>
			<div className="ft">
				<span className="pay-ft-msg">{err}</span>
				<button className="btn ghost" onClick={closeModal}>Cancel</button>
				<button className="btn" onClick={submit} disabled={saving || hasArrears || !monthsOk} title={hasArrears ? "Pay the outstanding interest/penal interest first" : undefined}>
					<Icon name="check" /> {saving ? "Saving…" : actionLabel}
				</button>
			</div>

			{/* Portalled to <body> so it stacks over this modal as its own smaller popup, same as Record Payment's
				* confirmation; Edit drops back to the form with everything still filled in. */}
			{reviewing && createPortal(
				<div
					className="modal-bg open pay-confirm-bg"
					onClick={(e) => { if (e.target === e.currentTarget && !saving) setReviewing(false); }}
					onKeyDown={(e) => { if (e.key === "Escape" && !saving) setReviewing(false); }}
				>
					<div className="modal" role="dialog" aria-modal="true">
						<div className="hd"><h3>Review Extension</h3><button className="x" onClick={() => setReviewing(false)} disabled={saving}>×</button></div>
						<div className="bd bd-scroll">
							<div className="ext-review-hero">
								<div className="pay-r-cap">{loan.id} · {loan.customerName}</div>
								<div className="ext-dates ext-dates-lg">
									<div><span>Currently due</span><b>{fmtDate(loan.due)}</b></div>
									<Icon name="arrowUp" />
									<div><span>New due date</span><b>{fmtDate(newDue)}</b></div>
								</div>
							</div>
							<div className="ext-review-grid">
								<span>Extend by</span><b>{monthsText(m)}</b>
								<span>Note</span><b>{detail.trim() || "—"}</b>
								<span>Interest outstanding</span><b>{fmt(arrears)}</b>
							</div>
						</div>
						<div className="ft">
							<button className="btn ghost" onClick={() => setReviewing(false)} disabled={saving}><Icon name="edit" /> Edit</button>
							<button className="btn" onClick={() => void save()} disabled={saving} autoFocus><Icon name="check" /> {saving ? "Extending…" : "Confirm Extension"}</button>
						</div>
					</div>
				</div>,
				document.body,
			)}
		</>
	);
}
