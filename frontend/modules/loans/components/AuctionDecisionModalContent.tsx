"use client";

import { useState } from "react";
import { useModal } from "@/common/components/ModalProvider";
import { useToast } from "@/common/components/ToastProvider";
import { Icon } from "@/common/components/Icon";
import { fmt } from "@/common/utils/format";
import { resolveAuctionDecision } from "@/modules/loans/services/loanService";
import { type AuctionRecordView, type AuctionDecisionRequestView, type AuctionDecisionStatus, type LoanView } from "@/modules/loans/types/loan-types";
import { ApiError } from "@/common/services/httpClient";
import { singleFlight } from "@/common/utils/singleFlight";
import { FieldError, fieldForMessage } from "@/common/components/ui/FieldError";

type AuctionDecisionModalContentProps = {
  loan: LoanView;
  request: AuctionDecisionRequestView;
  onSaved: (rec: AuctionRecordView) => void;
  onError?: () => void;
};

/* AuctionDecisionModalContent resolves an escalation the SYSTEM raised — staff
 * never create these, so the decision cannot be quietly skipped. Two kinds:
 *
 *  - PartialRepayment: the customer part-paid while their gold was in the
 *    pipeline. The auction is frozen until this is answered. Either the Auction
 *    Administrator or the Branch Manager may decide, whoever acts first.
 *
 *  - Shortfall: the sale did not cover the debt. Only Branch Manager/
 *    Management/Administrator may decide; the Auction Administrator who raised
 *    it sees it read-only. Enforced server-side, not just here.
 */
export function AuctionDecisionModalContent({
  loan,
  request,
  onSaved,
  onError,
}: AuctionDecisionModalContentProps) {
  const { closeModal } = useModal();
  const toast = useToast();
  const isShortfall = request.kind === "Shortfall";
  const [decision, setDecision] = useState<Exclude<AuctionDecisionStatus, "Pending"> | "">("");
  const [remarks, setRemarks] = useState("");
  const [err, setErr] = useState("");
  const [fe, setFe] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState(false);

  const fail = (field: string, msg: string) => { setErr(""); setFe({ [field]: msg }); };

  async function save() { return singleFlight("auction-modal:save:5", async () => {
    setErr(""); setFe({});
    if (!decision) { fail("decision", "Please choose a decision."); return; }
    if (isShortfall && !remarks.trim()) { fail("remarks", "Please state the reason for this decision."); return; }
    setSaving(true);
    try {
      const updated = await resolveAuctionDecision(loan.numericId, request.id, decision, remarks.trim() || undefined);
      onSaved(updated);
      closeModal();
      toast(DECISION_TOASTS[decision](loan.id));
    } catch (e) {
      const msg = e instanceof ApiError ? e.message : "Could not record the decision — try again.";
      const field = fieldForMessage(msg, { remarks: /reason|remark/i });
      if (field) fail(field, msg); else { setFe({}); setErr(msg); }
      onError?.(); // see IssueNoticeModalContent's onError comment above
    } finally {
      setSaving(false);
    }
  }); }

  return (
    <>
      <div className="hd">
        <h3>{isShortfall ? "Shortfall Decision" : "Repayment Decision"} — {loan.id}</h3>
        <button className="x" onClick={closeModal}>×</button>
      </div>
      <div className="bd bd-scroll">
        <div className="notice" style={{ marginBottom: 16 }}>
          <Icon name="shield" />
          <span>
            {isShortfall ? (
              <>The auction realised <b>{fmt(request.amountPaid)}</b>, which did not cover everything owed.{" "}
              <b>{fmt(request.outstandingAtRequest)}</b> remains outstanding on a loan whose gold has already been sold.
              The balance is currently frozen — it will only resume accruing interest if you choose to pursue it.</>
            ) : (
              <>{loan.customerName} paid <b>{fmt(request.amountPaid)}</b> while this gold was in the auction pipeline.{" "}
              <b>{fmt(request.outstandingAtRequest)}</b> is still outstanding. The auction is <b>frozen</b> until you
              decide — no notice, schedule, or sale can proceed.</>
            )}
          </span>
        </div>

        <div className="frow"><div className={fe.decision ? "has-err" : undefined}>
          <label className="f">Decision *</label>
          <div style={{ display: "flex", flexDirection: "column", gap: 6, marginTop: 4 }}>
            {(isShortfall
              ? [
                  ["PursueBalance", "Pursue the balance", "The loan returns to Overdue and stays collectible, resuming interest. The customer is notified."],
                  ["WriteOff", "Write the balance off", "The remaining amount is waived and the loan closes. No cash moves; the write-off is logged against the loan."],
                ]
              : [
                  ["RemovedFromAuction", "Remove from auction", "The gold is no longer at risk and the case is withdrawn. If the loan defaults again later, a fresh auction can be started."],
                  ["KeepInAuction", "Keep in auction", "The auction un-freezes and continues from its current stage. The customer is told their gold remains at risk."],
                ]
            ).map(([value, title, detail]) => (
              <label key={value} className="cradio" style={{ fontSize: 13 }}>
                <input
                  type="radio"
                  name="decision"
                  checked={decision === value}
                  onChange={() => { setDecision(value as Exclude<AuctionDecisionStatus, "Pending">); setFe((cur) => ({ ...cur, decision: "" })); }}
                />
                <span className="mark" />
                <span>
                  <strong className="cradio-title">{title}</strong>
                  <span className="cradio-detail">{detail}</span>
                </span>
              </label>
            ))}
          </div>
          <FieldError msg={fe.decision} />
        </div></div>

        <div className="frow"><div className={fe.remarks ? "has-err" : undefined}>
          <label className="f">Remarks {isShortfall ? "*" : ""}</label>
          <input className="inp" value={remarks} onChange={(e) => { setRemarks(e.target.value); setFe((cur) => ({ ...cur, remarks: "" })); }} placeholder="reason for this decision" maxLength={255} /><FieldError msg={fe.remarks} />
        </div></div>
        <p style={{ color: "var(--red)", fontSize: 12.5, minHeight: 16, marginTop: 8 }}>{err}</p>
      </div>
      <div className="ft">
        <button className="btn ghost" onClick={closeModal}>Cancel</button>
        {/* Not blanket-disabled on `!decision` — see the Settle button's own
         * comment above for why. */}
        <button className="btn" onClick={save} disabled={saving}><Icon name="check" /> {saving ? "Saving…" : "Record Decision"}</button>
      </div>
    </>
  );
}

const DECISION_TOASTS: Record<Exclude<AuctionDecisionStatus, "Pending">, (loanId: string) => string> = {
  KeepInAuction: (id) => `${id} remains in auction`,
  RemovedFromAuction: (id) => `${id} removed from auction`,
  PursueBalance: (id) => `Balance on ${id} will be pursued`,
  WriteOff: (id) => `Balance on ${id} written off — loan closed`,
};
