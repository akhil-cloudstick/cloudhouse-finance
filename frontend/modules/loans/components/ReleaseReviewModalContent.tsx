"use client";

import { NoteField } from "@/common/components/ui/NoteField";
import { useEffect, useState } from "react";
import { useModal } from "@/common/components/ModalProvider";
import { useToast } from "@/common/components/ToastProvider";
import { Icon } from "@/common/components/Icon";
import { fmt } from "@/common/utils/format";
import { getLoan, listLoanRequests, verifyReleaseChecklist, approveReleaseRequest, releaseBankPledge, editReleaseRecord } from "@/modules/loans/services/loanService";
import { type RequestView, type LoanView } from "@/modules/loans/types/loan-types";
import { listPackets, recordMovement, PACKET_STATUS } from "@/modules/packets/services/packetService";
import { type PacketView } from "@/modules/packets/types/packet-types";
import { PaymentModalContent } from "@/common/components/modals/PaymentModalContent";
import { ReleasePledgeModalContent } from "@/modules/loans/components/ReleasePledgeModalContent";
import { ApiError } from "@/common/services/httpClient";
import { useAuth, useApprovalWorkflow } from "@/common/providers/AuthProvider";
import { canActAtStage, chainFor, flowOf, isFlowOff, stageByPending, trackerLabels } from "@/common/services/approvalWorkflowService";
import { StageTracker } from "@/common/components/StageTracker";
import { routeHref } from "@/common/services/appRoutes";
import { useCanOpenRoute } from "@/common/hooks/use-can-open-route";
import { singleFlight } from "@/common/utils/singleFlight";
import { ConfirmModalContent } from "@/common/components/modals/ConfirmModalContent";
import { FieldError } from "@/common/components/ui/FieldError";
import { DatePicker } from "@/common/components/ui/DatePicker";
import { ReleaseCompleteModalContent } from "@/modules/loans/components/ReleaseCompleteModalContent";

function localToday(): string {
	const n = new Date();
	return `${n.getFullYear()}-${String(n.getMonth() + 1).padStart(2, "0")}-${String(n.getDate()).padStart(2, "0")}`;
}
import { releaseAmountNeeded } from "@/modules/loans/utils/releaseAmount";
import { TableCols } from "@/common/components/ui/TableCols";

// Mirrors backend/internal/loan/service.go's partialReleaseDrift — the
// no-buffer check ApproveReleaseRequest re-runs at Manager/Management
// approval. Only used here to decide whether to reveal the Top-Up Payment
// prompt BEFORE attempting the approval call; the backend remains the
// authority (ErrDriftPaymentRequired) and this is just an earlier signal so
// staff aren't surprised by a rejected Approve click.
function partialReleaseDrift(outstandingBalance: number, remainingGoldValue: number, ltvPercent: number): number {
	return outstandingBalance - (remainingGoldValue * ltvPercent) / 100;
}

type ReleaseReviewModalContentProps = { request: RequestView; onSaved: () => void };

/* Staff review screen for a pending Release request — shown from
 * Requests.tsx's "Review" button. Reworked to the 2-item checklist
 * (Customer Saw Gold + Record Payment via the general payment modal) — see
 * backend/internal/loan/model_request.go's LoanRequest doc comment. Once a
 * payment is recorded (PaymentRecorded/Locked flip true), the checkbox can
 * no longer be changed and Reject disappears entirely — see
 * Service.ApproveReleaseRequest's ErrRequestLocked. Both full and partial
 * releases go through this same screen; l.isPartial only changes what
 * CompleteRelease does at the final approval. */
export function ReleaseReviewModalContent({ request, onSaved }: ReleaseReviewModalContentProps) {
	const { closeModal, openModal, openChildModal } = useModal();
	const toast = useToast();
	// Without "can update loan" this modal is a read-only view: the checklist
	// toggles stay locked and the approve/reject pair never renders (see
	// Requests.tsx, which labels the row button View in that case).
	const { can, role, isSystem } = useAuth();
	const canOpen = useCanOpenRoute();
	const canDecide = can("Loan_Management", "can_update_loan");
	const canEditLedger = can("Loan_Management", "can_edit_ledger_entry");
	// Checklist verification and the two Manager/Management approval stages
	// each need their own "Release Approval" permission on top of the
	// general canDecide gate — see internal/authz.Catalogue and backend/
	// internal/loan/service.go's VerifyReleaseChecklist/ApproveReleaseRequest.
	const canVerifyChecklist = can("Release_Approval", "can_verify_release_checklist");
	// Which of the Manager/Management stages apply is per-business
	// configuration (flow "loan_release").
	const { config: workflow } = useApprovalWorkflow();

  const [loan, setLoan] = useState<LoanView | null>(null);
  const [packet, setPacket] = useState<PacketView | null>(null);
  const [req, setReq] = useState(request);
  const [notes, setNotes] = useState(request.verificationNotes || "");
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState("");
  const [notesErr, setNotesErr] = useState("");
  // Reveals the Top-Up Payment prompt only after ApproveReleaseRequest
  // actually refuses with the drift error — hidden otherwise, per the plan.
  const [showTopUp, setShowTopUp] = useState(false);
  // The day the customer saw the gold / the release happened. Staff can backdate it; it becomes the default
  // Payment Date in the Record Payment form, which they can still change each time.
  const [releaseDate, setReleaseDate] = useState(() => {
    // a release that is already decided shows the date it was recorded with, so it can be corrected
    if (request.requestedAt) return request.requestedAt.slice(0, 10);
    const n = new Date();
    return `${n.getFullYear()}-${String(n.getMonth() + 1).padStart(2, "0")}-${String(n.getDate()).padStart(2, "0")}`;
  });

  const [earlierLocked, setEarlierLocked] = useState<number[]>([]);
	useEffect(() => {
		loadLoan().then(setLoan).catch(() => setLoan(null));
	}, [request.loanNumericId]);

	// A request made on this PC can point at a loan the server has not numbered yet (id 0): open it by its number then.
	function loadLoan(): Promise<LoanView> {
		const byNumber = () => getLoanByNumber(request.loanNumber);
		return request.loanNumericId ? getLoan(request.loanNumericId).catch(byNumber) : byNumber();
	}

	// The backend no longer gates CustomerSawGold on the packet's own stage
	// (see VerifyReleaseChecklist's own doc comment — that's tracked
	// separately in internal/packet now), but ticking it while the gold is
	// still physically pledged to a bank or sitting in a locker would have
	// staff attest to something that hasn't actually happened yet. Caught
	// here instead, same listPackets({loanId}) call LoanDetail.tsx already
	// makes for its own Bank Pledge card.
	useEffect(() => {
		if (!loan) return;
		if (!can("Packet_Management", "can_view_packet_module")) return;
		listPackets({ loanId: loan.numericId }).then((ps) => setPacket(ps[0] ?? null)).catch(() => setPacket(null));
	}, [loan?.numericId, loan?.bankPledgeStatus]);

	// Shown again after a popup it opened (payment, bank pledge release) closes: pick up what that changed.
	useEffect(() => { refreshRequest(); }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const releasingIds = loan ? (req.isPartial ? req.ornamentIds : loan.ornaments.filter((o) => !o.releasedAt).map((o) => o.id)) : [];
  // Only the ornaments of THIS request count; a pledge with no ornament list covers the whole loan.
  const scopedPledges = loan ? loan.bankPledges.filter((bp) => bp.status === "Active" && (!bp.ornamentIds || bp.ornamentIds.length === 0 || bp.ornamentIds.some((id) => releasingIds.includes(id)))) : [];
  const pledgedHere = scopedPledges.length > 0;
  const goldStillHeld = pledgedHere || packet?.status === "Locker Stored";
  // The gold sitting in a locker can be checked out right here instead of from the packet page: the Gold
  // Release box records the packet as Released, the same move the packet page's Release button makes, and
  // that is what lets the customer be shown the gold.
  const canMovePackets = can("Packet_Management", "can_update_packet");
  const packetInLocker = !pledgedHere && packet?.status === "Locker Stored";
  // Gold pledged to a bank is released the same way: the box opens the usual Release Bank Pledge popup
  // (it needs the repayment split for a cash-in pledge) and returns here once it is done.
  const activePledge = scopedPledges[0];
  const canReleasePledge = can("Bank_Pledge_Management", "can_update_bank_pledge");
  const canReleaseHeldGold = req.status === "Pending" && canDecide && !req.locked && ((packetInLocker && canMovePackets) || (!!activePledge && canReleasePledge));
  const [releasingPacket, setReleasingPacket] = useState(false);
  // Ticked from the Gold Release box. Resolves true once the packet is Released; the box then drops out of
  // the grid (the packet is no longer Locker Stored) and the cells after it move up one slot.
  async function releasePacket(): Promise<boolean> { return (await singleFlight("modal:releasereview:releasePacket", async () => {
    if (!packet) return false;
    setReleasingPacket(true);
    setErr("");
    try {
      // Same fixed actor id the packet page sends; the server takes the real employee from the login.
      await recordMovement(packet.id, { toStatus: PACKET_STATUS.RELEASED, employeeId: 1, remarks: `Released with release request on ${request.loanNumber}` });
      const ps = await listPackets({ loanId: packet.loanId });
      setPacket(ps[0] ?? null);
      onSaved();
      toast(`Packet ${packet.code} released`);
      return true;
    } catch (e) {
      setErr(e instanceof ApiError ? e.message : "Could not release the packet — try again.");
      return false;
    } finally {
      setReleasingPacket(false);
    }
  })) ?? false; }
  const goldHeldReason = pledgedHere ? "pledged to a bank" : "checked into a locker";

	// Re-fetches this one request after a payment recorded via the general
	// Record Payment modal — that modal returns a LoanView, not the updated
	// RequestView, so PaymentRecorded/Locked/ApprovalStage have to be pulled
	// fresh here rather than threaded back through its onSaved callback.
	async function refreshRequest() {
		try {
			const all = await listLoanRequests({ loanId: request.loanNumericId });
			const fresh = all.find((r) => r.id === req.id);
			if (fresh) setReq(fresh);
      // Ornaments of earlier open release requests are left out of this request's amount (mirrors the backend).
      const ids = new Set<number>();
      for (const r of all) {
        if (r.type !== "Release" || r.id >= req.id || (r.status !== "Pending" && r.status !== "Approved")) continue;
        if (r.ornamentIds.length > 0) r.ornamentIds.forEach((id) => ids.add(id));
        else if (!(r.status === "Approved" && r.isPartial)) loan?.ornaments.forEach((o) => { if (!o.releasedAt) ids.add(o.id); });
      }
      setEarlierLocked([...ids]);
		} catch {
			/* keep the possibly-stale request rather than blocking the modal */
		}
	}

	// After the release payment: with no approver, or only one, recording it also approves the release (backend
	// advanceReleaseRequestStage). Rather than leave this screen sitting in its approved state, swap it for the one
	// Release Complete summary. Runs after the payment popup has closed back to here, so openModal replaces this modal.
	async function afterReleasePayment() {
		try {
			const [freshLoan, all] = await Promise.all([loadLoan(), listLoanRequests({ loanId: request.loanNumericId })]);
			const fresh = all.find((r) => r.id === req.id);
			setLoan(freshLoan);
			if (fresh) setReq(fresh);
			if (fresh?.status === "Approved") {
				openModal(<ReleaseCompleteModalContent request={fresh} loan={freshLoan} onSaved={onSaved} />, true);
			}
		} catch {
			/* the screen's own refresh on remount still picks the change up */
		}
	}

	// The pending stage from this business's chain (an empty approvalStage
	// reads as PendingManager, like the backend). With every release stage
	// switched off there is nothing to approve — recording the payment
	// completes the release — unless the request was already parked on a
	// stage before it was switched off, which can still be acted on.
	const releaseOff = isFlowOff(workflow, "loan_release");
	const stageView = req.status === "Pending" ? stageByPending(workflow, "loan_release", req.approvalStage) : null;
	const parkedOnDisabled = !!stageView && !stageView.enabled && !!req.approvalStage;
	const activeStage = releaseOff && !parkedOnDisabled ? null : stageView;
	const stage = activeStage?.key ?? "";
	const stageName = activeStage?.label ?? "";
	const canActOnStage = canActAtStage({ role, isSystem }, activeStage);
	const chain = chainFor(workflow, "loan_release", activeStage ? activeStage.pending : null);
	const stageIndex = activeStage ? chain.findIndex((s) => s.key === activeStage.key) : chain.length;

  // The customer can only be shown gold that is out of the locker and out of the bank, so the box waits for
  // the Gold Release box beside it. A recorded payment locks the request (ErrRequestLocked), and the box with it.
  const gaveGoldCheckboxDisabled = saving || releasingPacket || !canDecide || !canVerifyChecklist || req.status !== "Pending" || req.locked || goldStillHeld;

	// Live pre-check for the Top-Up Payment reveal — only meaningful for a
	// partial release (a full release keeps today's plain
	// outstanding<=0.01 gate, no LTV math involved).
	const remainingCollateral = loan && req.isPartial
		? loan.ornaments.filter((o) => !o.releasedAt && !req.ornamentIds.includes(o.id)).reduce((sum, o) => sum + o.goldValue, 0)
		: 0;
	const drift = loan && req.isPartial ? partialReleaseDrift(loan.totalOutstandingBalance, remainingCollateral, loan.schemeLtv) : 0;
	const driftLikely = req.isPartial && drift > 0.01;

	// Mirrors ApproveReleaseRequest's own fallback: PaymentRecorded is
	// ordinarily set by clicking Record Payment against THIS request, but a
	// loan can already satisfy the release's financial condition without
	// that — paid down by an ordinary payment before the release was even
	// requested, or via the Top-Up Payment path above (which posts against
	// the plain loan, not this request). In that case the backend accepts
	// Approve anyway, so the button/messaging here must not block on
	// paymentRecorded alone or it would show a stale "must record payment"
	// warning for a release that's actually ready to go.
	const neededNum = loan
    ? releaseAmountNeeded(loan, req.isPartial ? loan.ornaments.filter((o) => !o.releasedAt && !req.ornamentIds.includes(o.id)).map((o) => o.id) : null, earlierLocked)
: 0;
  const neededText = loan ? fmt(neededNum) : "the minimum amount";
	const paymentConditionMet =req.paymentRecorded || (!!loan && (req.isPartial ? !driftLikely : loan.totalOutstandingBalance <= 0.01));

	async function toggleSawGold(value: boolean) { return singleFlight("modal:releasereview:toggleSawGold", async () => {
		setSaving(true);
		setErr("");
		try {
			const updated = await verifyReleaseChecklist(req.id, { customerSawGold: value, ...(pendingDateChanged ? { requestedAt: releaseDate } : {}) }, req);
			setReq(updated);
		} catch (e) {
			setErr(e instanceof ApiError ? e.message : "Could not update the checklist — try again.");
		} finally {
			setSaving(false);
		}
	}); }

  // The release's own date can still be corrected once it is recorded (the tick beside the date picker).
  const dateChanged = !!req.requestedAt && releaseDate !== req.requestedAt.slice(0, 10) && (req.status !== "Pending" || req.paymentRecorded);

  // A pending request keeps the date the manager picked: it is sent with the checklist and the approval, so the next stage sees it.
  const pendingDateChanged = req.status === "Pending" && !!req.requestedAt && releaseDate !== req.requestedAt.slice(0, 10);

	async function saveReleaseDate() { return singleFlight("modal:releasereview:saveDate", async () => {
		setSaving(true);
		setErr("");
		try {
			await editReleaseRecord(req.id, { requestedAt: releaseDate });
			await refreshRequest();
			onSaved();
			toast("Release date updated");
		} catch (e) {
			setErr(e instanceof ApiError ? e.message : "Could not update the release date — try again.");
		} finally {
			setSaving(false);
		}
	}); }

	async function saveNotes() { return singleFlight("modal:releasereview:saveNotes", async () => {
		setSaving(true);
		setErr(""); setNotesErr("");
		try {
			const updated = await verifyReleaseChecklist(req.id, { verificationNotes: notes }, req);
			setReq(updated);
			toast("Saved");
		} catch (e) {
			// The only thing this call saves is the notes box, so its failure belongs under it.
			setNotesErr(e instanceof ApiError ? e.message : "Could not save — try again.");
		} finally {
			setSaving(false);
		}
	}); }

	/* Rejecting a release request cannot be undone, and the button sits beside Approve: it asks first, as the extension screen does. */
	function promptReject() {
		openModal(
			<ConfirmModalContent title="Reject Release Request" confirmLabel="Reject" busyLabel="Rejecting…" onConfirm={() => decide("Rejected")}>
				<p style={{ margin: 0 }}>This rejects the release request for {req.loanNumber}. The gold stays pledged and the request cannot be reopened.</p>
			</ConfirmModalContent>
		);
	}

	async function decide(action: "Approved" | "Rejected") { return singleFlight("modal:releasereview:decide", async () => {
		setSaving(true);
		setErr("");
		try {
			// The acting employee is derived server-side from the logged-in
			// user's JWT — no employeeId sent from here.
      if (action === "Approved" && pendingDateChanged) await verifyReleaseChecklist(req.id, { requestedAt: releaseDate });
			const updated = await approveReleaseRequest(req.id, { stage, action }, req);
			setReq(updated);
			onSaved();
			if (action !== "Approved" || updated.status !== "Approved") {
				// Approved-but-not-final (Manager stage on a two-stage chain) keeps
				// the modal open so staff can see the advanced stage; Rejected and
				// final Approved both close it.
				if (action === "Rejected") {
					closeModal();
					toast("Release request rejected");
				} else {
					toast(`Release ${stageName} stage approved`);
				}
			} else {
				closeModal();
				toast(req.isPartial ? "Release approved — selected ornaments released" : "Release approved — gold released, loan closed");
			}
		} catch (e) {
			if (e instanceof ApiError && e.status === 409 && /drift|top-up/i.test(e.message)) {
				// ErrDriftPaymentRequired — the buffer that absorbed drift at
				// creation time no longer covers it. Reveal the Top-Up Payment
				// prompt instead of just showing the raw error.
				setShowTopUp(true);
				setErr("Outstanding balance has drifted above what the remaining collateral supports — record a top-up payment below, then try approving again.");
			} else {
				setErr(e instanceof ApiError ? e.message : "Could not record the decision — try again.");
			}
		} finally {
			setSaving(false);
		}
	}); }

  return (
    <>
      <div className="hd">
        <h3>
          Review Release — {req.loanNumber}
          {req.isPartial && <span className="chip brand" style={{ marginLeft: 8, fontSize: 11 }}>Partial</span>}
        </h3>
        <button className="x" onClick={closeModal}>×</button>
      </div>
      {/* `bd-scroll` caps the modal at the viewport and scrolls THIS body
        * instead of the page behind it — see app.css. */}
      <div className="bd bd-scroll rel-review">
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

        {req.isPartial && loan && (
          <div style={{ marginBottom: 14 }}>
            <label className="f">Selected Ornaments — {req.ornamentIds.length} of {loan.ornaments.filter((o) => !o.releasedAt).length}</label>
            <div className="tbl-wrap rel-orn-wrap"><table className="tbl"><TableCols widths={[40, 18, 18, 24]} />
              <thead><tr><th>Ornament</th><th>Purity</th><th className="num">Net (g)</th><th className="num">Gold Value</th></tr></thead>
              <tbody>
                {loan.ornaments.filter((o) => req.ornamentIds.includes(o.id)).map((o) => (
                  <tr key={o.id}><td className="rel-orn-name" title={o.name}>{o.name}</td><td><span className="chip brand">{o.purity}</span></td><td className="num">{o.netWeight.toFixed(1)}</td><td className="num">{fmt(o.goldValue)}</td></tr>
                ))}
              </tbody>
            </table></div>
          </div>
        )}

        {/* One flowing c2 grid (.rel-c2 in app.css), in this order: Gold Release → Customer Check → Release
          * Date → Release Payment → Top-Up. A cell that does not apply is not rendered and every cell after it
          * moves up one slot — e.g. with no gold left to release, Customer Check takes the first slot. */}
        <div className="frow c2 rel-c2">
          {/* The gold must be out of the locker / the bank before the customer can be shown it. */}
          {canReleaseHeldGold && loan && (
            <div>
              <label className="f">Gold Release</label>
              <div className="rel-tick">
                <label className="ccheck" title={activePledge ? `Release the bank pledge (${activePledge.bankName})` : `Release packet ${packet?.code ?? ""}`}>
                  <input
                    type="checkbox"
                    checked={false}
                    disabled={saving || releasingPacket}
                    onChange={(e) => {
                      if (!e.target.checked) return;
                      if (!activePledge) {
                        void releasePacket();
                        return;
                      }
                      openChildModal(
                        <ReleasePledgeModalContent
                          bankName={activePledge.bankName}
                          amount={activePledge.pledgedAmount}
                          cashTreatment={activePledge.cashTreatment}
                          onConfirm={async (payment) => {
                            await releaseBankPledge(loan.numericId, activePledge.id, payment);
                            toast("Bank pledge released");
                            onSaved();
                          }}
                        />,
                      );
                    }}
                  />
                  <span className="mark" />
                  <span><b>{activePledge ? "Release bank pledge" : `Release packet ${packet?.code ?? ""}`}</b></span>
                </label>
              </div>
            </div>
          )}

          <div>
            <label className="f">Customer Check</label>
            <div className={`rel-tick${req.customerSawGold ? " on" : ""}${gaveGoldCheckboxDisabled && !req.customerSawGold ? " locked" : ""}`}>
              <label className="ccheck" title="Customer has seen the gold">
                <input type="checkbox" checked={req.customerSawGold} disabled={gaveGoldCheckboxDisabled} onChange={(e) => toggleSawGold(e.target.checked)} />
                <span className="mark" />
                <span><b>Customer has seen the gold</b></span>
              </label>
            </div>
          </div>

          <div>
            <label className="f">Release Date</label>
            {/* Tick-only "Save date" shares the cell, shown once a recorded release's date is changed. */}
            <div className={`rel-date${canEditLedger && dateChanged ? " has-save" : ""}`}>
              <DatePicker value={releaseDate} min={loan?.opened?.slice(0, 10) || undefined} max={localToday()} onChange={setReleaseDate} disabled={req.status === "Pending" ? !canDecide : !canEditLedger} />
              {canEditLedger && dateChanged && (
                <button type="button" className="btn ghost rel-icon-btn" disabled={saving} onClick={saveReleaseDate} title="Save date" aria-label="Save date">
                  <Icon name="check" />
                </button>
              )}
            </div>
          </div>

          {/* Recorded: just the amount paid, in a green box. Not yet: Record Payment with the minimum under it.
            * Nothing to pay (minimum is ₹0): no cell at all. */}
          {req.paymentRecorded ? (
            <div>
              <label className="f">Release Payment</label>
              <div className="rel-paid">
                <Icon name="check" />
                <span>{fmt(req.recordedPayment + req.recordedDiscount)} paid</span>
              </div>
            </div>
          ) : !(loan && neededNum <= 0.01) && (
            <div>
              <label className="f">Release Payment</label>
              <button
                type="button"
                className="btn ghost"
                style={{ width: "100%" }}
                disabled={req.status !== "Pending" || !canDecide || !loan}
                onClick={() => openChildModal(<PaymentModalContent loan={loan!} releaseRequestId={req.id} initialDate={releaseDate} releaseMinFor={(l) => releaseAmountNeeded(l, req.isPartial ? l.ornaments.filter((o) => !o.releasedAt && !req.ornamentIds.includes(o.id)).map((o) => o.id) : null, earlierLocked)} onSaved={() => { onSaved(); void afterReleasePayment(); }} />, true)}
              >
                <Icon name="coin" /> Record Payment
              </button>
              {loan && <div className="rel-hint">Minimum {neededText}</div>}
            </div>
          )}

          {/* Only after Approve was refused for drift. Deliberately NOT releaseRequestId — a top-up is a payment
            * against the LOAN itself (see LoanRequest.Locked's own doc comment: RecordPayment is not blocked by
            * Locked, only VerifyReleaseChecklist/ApproveReleaseRequest are), posted through the plain
            * /loans/:id/payments endpoint like any other payment, not the release-request endpoint. */}
          {showTopUp && loan && (
            <div>
              <label className="f">Top-Up Payment</label>
              <button type="button" className="btn ghost" style={{ width: "100%" }} onClick={() => openChildModal(<PaymentModalContent loan={loan} onSaved={() => { setShowTopUp(false); onSaved(); getLoan(request.loanNumericId).then(setLoan); refreshRequest(); }} />, true)}>
                <Icon name="coin" /> Record Top-Up
              </button>
            </div>
          )}
        </div>

        {/* Gold still held that this role cannot release from here: point to the page that can. */}
          {goldStillHeld && loan && !canReleaseHeldGold && (
            <p className="notice" style={{ marginBottom: 12, color: "var(--red)" }}>
              <Icon name="shield" />{" "}
              This loan&apos;s gold is still {goldHeldReason}, so it can&apos;t be shown to the customer yet — release it from{" "}
              {/* Real route links (the old "#bankpledge/…" hash form opened the
                * dashboard), and plain text for a role that can't open them. */}
              {pledgedHere ? (
                canOpen("bankpledge") ? (
                  <a href={routeHref(`bankpledge/${loan.id}`)} onClick={closeModal}>Bank &amp; Gold Re-Pledge</a>
                ) : (
                  "Bank & Gold Re-Pledge"
                )
              ) : canOpen("packet") && packet?.code ? (
                <a href={routeHref(`packet/${packet.code}`)} onClick={closeModal}>Packet {packet.code}</a>
              ) : (
                `Packet ${packet?.code ?? ""}`
              )}
              {" "}first.
            </p>
          )}

        <div className="frow"><div className={notesErr ? "has-err" : undefined}><label className="f">Verification Notes</label><NoteField value={notes} disabled={!canDecide || req.locked} onChange={(v) => { setNotes(v); setNotesErr(""); }} onBlur={saveNotes} placeholder="Optional" /><FieldError msg={notesErr} /></div></div>

        {req.status === "Pending" && (!req.customerSawGold || !paymentConditionMet) && (
          <p className="notice" style={{ marginTop: 12 }}>
            <Icon name="shield" />{" "}
            {!req.customerSawGold && !paymentConditionMet
              ? `"Customer has seen the gold" must be ticked and at least ${neededText} paid before this can be approved.`
              : !req.customerSawGold
                ? '"Customer has seen the gold" must be ticked before this can be approved.'
                : `At least ${neededText} must be paid (via Record Payment above) before this can be approved.`}
          </p>
        )}
        {(chain.length > 1 || (chain.length === 1 && req.status === "Rejected")) && (
          <div style={{ marginTop: 14 }}>
            <StageTracker
              stages={trackerLabels(workflow, "loan_release", chain)}
              currentIndex={req.status === "Pending" ? stageIndex : chain.length}
              terminal={req.status === "Rejected" ? "Rejected" : undefined}
            />
          </div>
        )}
        {req.status === "Pending" && req.customerSawGold && paymentConditionMet && activeStage && (
          <p className="notice" style={{ marginTop: 12 }}><Icon name="clock" /> Awaiting {activeStage.role} approval{chain.length > 1 ? ` (${stageName} stage)` : ""}.</p>
        )}
        {req.status === "Pending" && !activeStage && (
          <p className="notice" style={{ marginTop: 12 }}><Icon name="clock" /> No release approval is configured — {flowOf(workflow, "loan_release")?.offBehavior}</p>
        )}
        <p style={{ color: "var(--red)", fontSize: 12.5, minHeight: 16, marginTop: 8 }}>{err}</p>
      </div>
      {/* The × in the header closes the popup; the footer holds only the decision, on the same two columns as
        * the grid above (.rel-ft): Reject left, Approve right, equal width. */}
      {req.status === "Pending" && canDecide && canActOnStage && !!stage && (
      <div className="ft rel-ft">
        {/* Locked (a payment has already been recorded against this
          * request) removes Reject entirely — see LoanRequest.Locked's
          * own doc comment (ErrRequestLocked). Approve keeps the right column. */}
        {!req.locked && <button className="btn danger" disabled={saving} onClick={() => decide("Rejected")}>Reject</button>}
        {/* The stage is named by the tracker and the "Awaiting … approval" line above; a half-width
          * button cannot fit "Approve (Management)", so the stage moves to the tooltip. */}
        <button className="btn rel-approve" title={`Approve (${stageName} stage)`} disabled={saving || !req.customerSawGold || !paymentConditionMet} onClick={() => decide("Approved")}>
          <Icon name="check" /> Approve
        </button>
      </div>
      )}
    </>
  );
}
