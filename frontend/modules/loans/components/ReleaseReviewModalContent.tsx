"use client";

import { useEffect, useState } from "react";
import { useModal } from "@/common/components/ModalProvider";
import { useToast } from "@/common/components/ToastProvider";
import { Icon } from "@/common/components/Icon";
import { fmt } from "@/common/utils/format";
import { getLoan, listLoanRequests, verifyReleaseChecklist, approveReleaseRequest } from "@/modules/loans/services/loanService";
import { type RequestView, type LoanView } from "@/modules/loans/types/loan-types";
import { listPackets } from "@/modules/packets/services/packetService";
import { type PacketView } from "@/modules/packets/types/packet-types";
import { PaymentModalContent } from "@/common/components/modals/PaymentModalContent";
import { ApiError } from "@/common/services/httpClient";
import { useAuth, useApprovalWorkflow } from "@/common/providers/AuthProvider";
import { canActAtStage, chainFor, flowOf, isFlowOff, stageByPending, trackerLabels } from "@/common/services/approvalWorkflowService";
import { StageTracker } from "@/common/components/StageTracker";
import { routeHref } from "@/common/services/appRoutes";
import { useCanOpenRoute } from "@/common/hooks/use-can-open-route";
import { singleFlight } from "@/common/utils/singleFlight";
import { FieldError } from "@/common/components/ui/FieldError";

// Mirrors the backend's own drift check, used here only as an earlier signal before the real approval call.
function partialReleaseDrift(outstandingBalance: number, remainingGoldValue: number, ltvPercent: number): number {
  return outstandingBalance - (remainingGoldValue * ltvPercent) / 100;
}

type ReleaseReviewModalContentProps = { request: RequestView; onSaved: () => void };

// Once a payment is recorded, the checklist locks and Reject disappears entirely — see ErrRequestLocked.
export function ReleaseReviewModalContent({ request, onSaved }: ReleaseReviewModalContentProps) {
  const { closeModal, openModal } = useModal();
  const toast = useToast();
  // Without "can update loan" this modal is read-only: checklist stays locked and approve/reject never renders.
  const { can, role, isSystem } = useAuth();
  const canOpen = useCanOpenRoute();
  const canDecide = can("Loan_Management", "can_update_loan");
  const canVerifyChecklist = can("Release_Approval", "can_verify_release_checklist");
  const { config: workflow } = useApprovalWorkflow();

  const [loan, setLoan] = useState<LoanView | null>(null);
  const [packet, setPacket] = useState<PacketView | null>(null);
  const [req, setReq] = useState(request);
  const [notes, setNotes] = useState(request.verificationNotes || "");
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState("");
  const [notesErr, setNotesErr] = useState("");
  const [showTopUp, setShowTopUp] = useState(false);

  useEffect(() => {
    getLoan(request.loanNumericId).then(setLoan).catch(() => setLoan(null));
  }, [request.loanNumericId]);

  // Ticking "customer saw gold" while it's still pledged to a bank or in a locker would attest to something untrue.
  useEffect(() => {
    if (!loan) return;
    if (!can("Packet_Management", "can_view_packet_module")) return;
    listPackets({ loanId: loan.numericId }).then((ps) => setPacket(ps[0] ?? null)).catch(() => setPacket(null));
  }, [loan?.numericId, loan?.bankPledgeStatus]);

  const goldStillHeld = loan?.bankPledgeStatus === "Bank Pledged" || packet?.status === "Locker Stored";
  const goldHeldReason = loan?.bankPledgeStatus === "Bank Pledged" ? "pledged to a bank" : "checked into a locker";

  // Record Payment's modal returns a LoanView, not the updated RequestView, so re-fetch the request fresh here.
  async function refreshRequest() {
    try {
      const all = await listLoanRequests({ loanId: request.loanNumericId });
      const fresh = all.find((r) => r.id === req.id);
      if (fresh) setReq(fresh);
    } catch {
      // keep the possibly-stale request rather than blocking the modal
    }
  }

  // With every release stage switched off, recording payment completes the release — unless parked on one pre-switch-off.
  const releaseOff = isFlowOff(workflow, "loan_release");
  const stageView = req.status === "Pending" ? stageByPending(workflow, "loan_release", req.approvalStage) : null;
  const parkedOnDisabled = !!stageView && !stageView.enabled && !!req.approvalStage;
  const activeStage = releaseOff && !parkedOnDisabled ? null : stageView;
  const stage = activeStage?.key ?? "";
  const stageName = activeStage?.label ?? "";
  const canActOnStage = canActAtStage({ role, isSystem }, activeStage);
  const chain = chainFor(workflow, "loan_release", activeStage ? activeStage.pending : null);
  const stageIndex = activeStage ? chain.findIndex((s) => s.key === activeStage.key) : chain.length;

  const gaveGoldCheckboxDisabled = saving || !canDecide || !canVerifyChecklist || req.status !== "Pending" || req.locked || goldStillHeld;

  // Only meaningful for a partial release; a full release keeps the plain outstanding<=0.01 gate.
  const remainingCollateral = loan && req.isPartial
    ? loan.ornaments.filter((o) => !o.releasedAt && !req.ornamentIds.includes(o.id)).reduce((sum, o) => sum + o.goldValue, 0)
    : 0;
  const drift = loan && req.isPartial ? partialReleaseDrift(loan.totalOutstandingBalance, remainingCollateral, loan.schemeLtv) : 0;
  const driftLikely = req.isPartial && drift > 0.01;

  // A loan can satisfy the financial condition without PaymentRecorded being set (e.g. paid down earlier), so check both.
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
    setErr(""); setNotesErr("");
    try {
      const updated = await verifyReleaseChecklist(req.id, { verificationNotes: notes });
      setReq(updated);
      toast("Saved");
    } catch (e) {
      // The only thing this call saves is the notes box, so its failure belongs under it.
      setNotesErr(e instanceof ApiError ? e.message : "Could not save — try again.");
    } finally {
      setSaving(false);
    }
  }); }

  async function decide(action: "Approved" | "Rejected") { return singleFlight("modal:releasereview:decide", async () => {
    setSaving(true);
    setErr("");
    try {
      const updated = await approveReleaseRequest(req.id, { stage, action });
      setReq(updated);
      onSaved();
      if (action !== "Approved" || updated.status !== "Approved") {
        // Approved-but-not-final keeps the modal open to show the advanced stage; Rejected and final Approved close it.
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

        <div className="frow" style={{ marginTop: 14 }}><div className={notesErr ? "has-err" : undefined}><label className="f">Verification Notes</label><input className="inp" value={notes} disabled={!canDecide || req.locked} onChange={(e) => { setNotes(e.target.value); setNotesErr(""); }} onBlur={saveNotes} placeholder="optional" /><FieldError msg={notesErr} /></div></div>

        {driftLikely && !showTopUp && (
          <p className="notice" style={{ marginTop: 12, color: "var(--red)" }}>
            <Icon name="shield" /> Outstanding balance may have drifted above what the remaining collateral supports — approval may require a top-up payment.
          </p>
        )}
        {showTopUp && loan && (
          <div style={{ marginTop: 12 }}>
            <label className="f">Top-Up Payment</label>
            <p className="ccheck-hint" style={{ marginBottom: 8 }}>Record the shortfall against the loan, then try Approve again.</p>
            {/* Deliberately NOT releaseRequestId — a top-up is a payment against the LOAN itself, not this request. */}
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
