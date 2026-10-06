"use client";

import { useEffect, useState } from "react";
import { useModal } from "@/product/components/Modal";
import { useToast } from "@/product/components/Toast";
import { Icon } from "@/product/components/Icon";
import { fmt } from "@/product/utils/format";
import { getLoan, listLoanRequests, verifyReleaseChecklist, approveReleaseRequest, type RequestView, type LoanView } from "@/product/pages/loans/services/loanService";
import { listPackets, type PacketView } from "@/product/pages/packets/services/packetService";
import { PaymentModalContent } from "@/product/components/modals/PaymentModal";
import { ApiError } from "@/product/services/httpClient";
import { useAuth, useApprovalWorkflow } from "@/product/providers/auth-context";
import { canActAtStage, chainFor, flowOf, isFlowOff, stageByPending, trackerLabels } from "@/product/services/approvalWorkflowService";
import { StageTracker } from "@/product/components/ui/StageTracker";
import { routeHref } from "@/product/services/appRoutes";
import { useCanOpenRoute } from "@/product/hooks/useCanOpenRoute";
import { singleFlight } from "@/product/utils/singleFlight";

// Mirrors backend/internal/loan/service.go's partialReleaseDrift — the
// no-buffer check ApproveReleaseRequest re-runs at Manager/Management
// approval. Only used here to decide whether to reveal the Top-Up Payment
// prompt BEFORE attempting the approval call; the backend remains the
// authority (ErrDriftPaymentRequired) and this is just an earlier signal so
// staff aren't surprised by a rejected Approve click.
function partialReleaseDrift(outstandingBalance: number, remainingGoldValue: number, ltvPercent: number): number {
  return outstandingBalance - (remainingGoldValue * ltvPercent) / 100;
}

/* Staff review screen for a pending Release request — shown from
 * Requests.tsx's "Review" button. Reworked to the 2-item checklist
 * (Customer Saw Gold + Record Payment via the general payment modal) — see
 * backend/internal/loan/model_request.go's LoanRequest doc comment. Once a
 * payment is recorded (PaymentRecorded/Locked flip true), the checkbox can
 * no longer be changed and Reject disappears entirely — see
 * Service.ApproveReleaseRequest's ErrRequestLocked. Both full and partial
 * releases go through this same screen; l.isPartial only changes what
 * CompleteRelease does at the final approval. */
export function ReleaseReviewModalContent({ request, onSaved }: { request: RequestView; onSaved: () => void }) {
  const { closeModal, openModal } = useModal();
  const toast = useToast();
  // Without "can update loan" this modal is a read-only view: the checklist
  // toggles stay locked and the approve/reject pair never renders (see
  // Requests.tsx, which labels the row button View in that case).
  const { can, role, isAdmin } = useAuth();
  const canOpen = useCanOpenRoute();
  const canDecide = can("Loan_Management", "can_update_loan");
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
  // Reveals the Top-Up Payment prompt only after ApproveReleaseRequest
  // actually refuses with the drift error — hidden otherwise, per the plan.
  const [showTopUp, setShowTopUp] = useState(false);

  useEffect(() => {
    getLoan(request.loanNumericId).then(setLoan).catch(() => setLoan(null));
  }, [request.loanNumericId]);

  // The backend no longer gates CustomerSawGold on the packet's own stage
  // (see VerifyReleaseChecklist's own doc comment — that's tracked
  // separately in internal/packet now), but ticking it while the gold is
  // still physically pledged to a bank or sitting in a locker would have
  // staff attest to something that hasn't actually happened yet. Caught
  // here instead, same listPackets({loanId}) call LoanDetail.tsx already
  // makes for its own Bank Pledge card.
  useEffect(() => {
    if (!loan) return;
    listPackets({ loanId: loan.numericId }).then((ps) => setPacket(ps[0] ?? null)).catch(() => setPacket(null));
  }, [loan?.numericId, loan?.bankPledgeStatus]);

  const goldStillHeld = loan?.bankPledgeStatus === "Bank Pledged" || packet?.status === "Locker Stored";
  const goldHeldReason = loan?.bankPledgeStatus === "Bank Pledged" ? "pledged to a bank" : "checked into a locker";

  // Re-fetches this one request after a payment recorded via the general
  // Record Payment modal — that modal returns a LoanView, not the updated
  // RequestView, so PaymentRecorded/Locked/ApprovalStage have to be pulled
  // fresh here rather than threaded back through its onSaved callback.
  async function refreshRequest() {
    try {
      const all = await listLoanRequests({ loanId: request.loanNumericId });
      const fresh = all.find((r) => r.id === req.id);
      if (fresh) setReq(fresh);
    } catch {
      /* keep the possibly-stale request rather than blocking the modal */
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
  const canActOnStage = canActAtStage({ role, isAdmin }, activeStage);
  const chain = chainFor(workflow, "loan_release", activeStage ? activeStage.pending : null);
  const stageIndex = activeStage ? chain.findIndex((s) => s.key === activeStage.key) : chain.length;

  const gaveGoldCheckboxDisabled = saving || !canDecide || !canVerifyChecklist || req.status !== "Pending" || req.locked || goldStillHeld;

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
  const paymentConditionMet = req.paymentRecorded || (!!loan && (req.isPartial ? !driftLikely : loan.totalOutstandingBalance <= 0.01));

  async function toggleSawGold(value: boolean) { return singleFlight("modal:releasereview:toggleSawGold", async () => {
    setSaving(true);
    setErr("");
    try {
      const updated = await verifyReleaseChecklist(req.id, { customerSawGold: value });
      setReq(updated);
    } catch (e) {
      setErr(e instanceof ApiError ? e.message : "Could not update the checklist — try again.");
    } finally {
      setSaving(false);
    }
  }); }

  async function saveNotes() { return singleFlight("modal:releasereview:saveNotes", async () => {
    setSaving(true);
    setErr("");
    try {
      const updated = await verifyReleaseChecklist(req.id, { verificationNotes: notes });
      setReq(updated);
      toast("Saved");
    } catch (e) {
      setErr(e instanceof ApiError ? e.message : "Could not save — try again.");
    } finally {
      setSaving(false);
    }
  }); }

  async function decide(action: "Approved" | "Rejected") { return singleFlight("modal:releasereview:decide", async () => {
    setSaving(true);
    setErr("");
    try {
      // The acting employee is derived server-side from the logged-in
      // user's JWT — no employeeId sent from here.
      const updated = await approveReleaseRequest(req.id, { stage, action });
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
      <div className="bd bd-scroll">
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
            <div className="tbl-wrap"><table className="tbl">
              <thead><tr><th>Ornament</th><th>Purity</th><th className="num">Net (g)</th><th className="num">Gold Value</th></tr></thead>
              <tbody>
                {loan.ornaments.filter((o) => req.ornamentIds.includes(o.id)).map((o) => (
                  <tr key={o.id}><td>{o.name}</td><td><span className="chip brand">{o.purity}</span></td><td className="num">{o.netWeight.toFixed(1)}</td><td className="num">{fmt(o.goldValue)}</td></tr>
                ))}
              </tbody>
            </table></div>
          </div>
        )}

        <div style={{ margin: "14px 0" }}>
          <label className="f">Verification</label>
          <div className="ccheck-grid">
            <label className="ccheck" style={{ padding: "6px 0" }}>
              <input type="checkbox" checked={req.customerSawGold} disabled={gaveGoldCheckboxDisabled} onChange={(e) => toggleSawGold(e.target.checked)} />
              <span className="mark" />
              <span>
                <b>Customer has seen the gold</b>
                <div className="ccheck-hint">Confirm the customer has been shown the pledged ornaments</div>
              </span>
            </label>
          </div>
          {goldStillHeld && loan && (
            <p className="notice" style={{ marginTop: 8, color: "var(--red)" }}>
              <Icon name="shield" />{" "}
              This loan&apos;s gold is still {goldHeldReason}, so it can&apos;t be shown to the customer yet — release it from{" "}
              {/* Real route links (the old "#bankpledge/…" hash form opened the
                * dashboard), and plain text for a role that can't open them. */}
              {loan.bankPledgeStatus === "Bank Pledged" ? (
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
        </div>

        <button
          className="btn ghost sm"
          disabled={req.status !== "Pending" || !canDecide || !loan}
          onClick={() => openModal(<PaymentModalContent loan={loan!} releaseRequestId={req.id} onSaved={() => { onSaved(); getLoan(request.loanNumericId).then(setLoan); refreshRequest(); }} />, true)}
        >
          <Icon name="coin" /> Record Payment
        </button>

        <div className="frow" style={{ marginTop: 14 }}><div><label className="f">Verification Notes</label><input className="inp" value={notes} disabled={!canDecide || req.locked} onChange={(e) => setNotes(e.target.value)} onBlur={saveNotes} placeholder="optional" /></div></div>

        {driftLikely && !showTopUp && (
          <p className="notice" style={{ marginTop: 12, color: "var(--red)" }}>
            <Icon name="shield" /> Outstanding balance may have drifted above what the remaining collateral supports — approval may require a top-up payment.
          </p>
        )}
        {showTopUp && loan && (
          <div style={{ marginTop: 12 }}>
            <label className="f">Top-Up Payment</label>
            <p className="ccheck-hint" style={{ marginBottom: 8 }}>Record the shortfall against the loan, then try Approve again.</p>
            {/* Deliberately NOT releaseRequestId — a top-up is a payment
              * against the LOAN itself (see LoanRequest.Locked's own doc
              * comment: RecordPayment is not blocked by Locked, only
              * VerifyReleaseChecklist/ApproveReleaseRequest are), posted
              * through the plain /loans/:id/payments endpoint like any
              * other payment, not the release-request endpoint. */}
            <button className="btn ghost sm" onClick={() => openModal(<PaymentModalContent loan={loan} onSaved={() => { setShowTopUp(false); onSaved(); getLoan(request.loanNumericId).then(setLoan); refreshRequest(); }} />, true)}>
              <Icon name="coin" /> Record Top-Up Payment
            </button>
          </div>
        )}

        {req.status === "Pending" && (!req.customerSawGold || !paymentConditionMet) && (
          <p className="notice" style={{ marginTop: 12 }}>
            <Icon name="shield" />{" "}
            {!req.customerSawGold && !paymentConditionMet
              ? '"Customer has seen the gold" must be ticked and the minimum amount paid before this can be approved.'
              : !req.customerSawGold
                ? '"Customer has seen the gold" must be ticked before this can be approved.'
                : "The minimum amount must be paid (via Record Payment above, or an earlier payment on the loan) before this can be approved."}
          </p>
        )}
        {chain.length > 0 && (
          <div style={{ marginTop: 14 }}>
            <StageTracker
              stages={trackerLabels(workflow, "loan_release", chain)}
              currentIndex={req.status === "Pending" ? stageIndex : chain.length}
              terminal={req.status === "Rejected" ? "Rejected" : undefined}
            />
          </div>
        )}
        {req.status === "Pending" && req.customerSawGold && paymentConditionMet && activeStage && (
          <p className="notice" style={{ marginTop: 12 }}><Icon name="clock" /> Awaiting {activeStage.role} approval ({stageName} stage).</p>
        )}
        {req.status === "Pending" && !activeStage && (
          <p className="notice" style={{ marginTop: 12 }}><Icon name="clock" /> No release approval is configured — {flowOf(workflow, "loan_release")?.offBehavior}</p>
        )}
        <p style={{ color: "var(--red)", fontSize: 12.5, minHeight: 16, marginTop: 8 }}>{err}</p>
      </div>
      <div className="ft">
        <button className="btn ghost" onClick={closeModal}>Close</button>
        {req.status === "Pending" && canDecide && canActOnStage && !!stage && (
          <>
            {/* Locked (a payment has already been recorded against this
              * request) removes Reject entirely — see LoanRequest.Locked's
              * own doc comment (ErrRequestLocked). */}
            {!req.locked && <button className="btn danger" disabled={saving} onClick={() => decide("Rejected")}>Reject</button>}
            <button className="btn" disabled={saving || !req.customerSawGold || !paymentConditionMet} onClick={() => decide("Approved")}>
              <Icon name="check" /> Approve ({stageName})
            </button>
          </>
        )}
      </div>
    </>
  );
}
