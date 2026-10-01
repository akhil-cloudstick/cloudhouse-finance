"use client";

import { useRef, useState } from "react";
import { useModal } from "@/product/components/Modal";
import { useToast } from "@/product/components/Toast";
import { Icon } from "@/product/components/Icon";
import { DatePicker } from "@/product/components/ui/DatePicker";
import { fmt } from "@/product/utils/format";
import {
  issueAuctionNotice,
  scheduleAuction,
  recordAuctionSale,
  settleAuction,
  resolveAuctionDecision,
  type AuctionRecordView,
  type AuctionDecisionRequestView,
  type AuctionDecisionStatus,
  type AuctionSurplusDisposition,
} from "@/product/pages/loans/services/loanService";
import { ApiError } from "@/product/services/httpClient";
import { useApprovalWorkflow } from "@/product/providers/auth-context";
import { isFlowOff } from "@/product/services/approvalWorkflowService";
import type { LoanView } from "@/product/pages/loans/services/loanService";

/* One modal body per auction stage-advance action — each posts to its own
 * POST /loans/:id/auction/{notice,schedule,sale,settle} endpoint (see
 * loansApi.ts) and hands the refreshed AuctionRecordView back to the
 * caller (Auctions.tsx) via onSaved. Replaces the old single AuctionModal
 * that recorded a date+sale-amount in one step and jumped straight to
 * "Auctioned" — the real workflow now has 4 separate staff actions. */

// Notice method is not picked by staff. Only WhatsApp is listed because it
// is the only channel with a live gateway — SMS and Registered Post have no
// provider wired up (see loan.Service's auctionNoticeChannels), so naming
// them here promised the customer messages nobody actually sends. The
// backend still writes an AuctionNotice row per channel for the compliance
// notice history; this is only what staff are told goes out.
const NOTICE_CHANNELS = ["WhatsApp"];

export function IssueNoticeModalContent({ loan, onSaved, onError }: { loan: LoanView; onSaved: (rec: AuctionRecordView) => void; onError?: () => void }) {
  const { closeModal } = useModal();
  const toast = useToast();
  const [remarks, setRemarks] = useState("");
  const [err, setErr] = useState("");
  const [saving, setSaving] = useState(false);

  async function save() {
    setSaving(true);
    try {
      const rec = await issueAuctionNotice(loan.numericId, remarks.trim() || undefined);
      onSaved(rec);
      closeModal();
      toast(`Notice sent for ${loan.id} via WhatsApp`);
    } catch (e) {
      setErr(e instanceof ApiError ? e.message : "Could not log the notice — try again.");
      // The card behind this modal loaded its auction stage on mount — if
      // this failed because that stage has since moved on (another staff
      // member acted, or the record was withdrawn/concluded in the
      // meantime), the card's own state is now stale and would otherwise
      // keep offering this exact same action, which would keep failing the
      // same way. Re-syncing it with the real backend state here corrects
      // the button shown (and the stage tracker) without the user needing
      // to reload the page to discover why the action won't go through.
      onError?.();
    } finally {
      setSaving(false);
    }
  }

  return (
    <>
      <div className="hd"><h3>Issue Auction Notice — {loan.id}</h3><button className="x" onClick={closeModal}>×</button></div>
      <div className="bd bd-scroll">
        <div className="frow"><div><label className="f">Channel</label>
          <p style={{ fontSize: 13.5, margin: "4px 0 0" }}>{NOTICE_CHANNELS.join(" · ")} — sent automatically</p></div></div>
        <div className="frow"><div><label className="f">Remarks</label><input className="inp" value={remarks} onChange={(e) => setRemarks(e.target.value)} /></div></div>
        <p style={{ color: "var(--red)", fontSize: 12.5, minHeight: 16, marginTop: 8 }}>{err}</p>
      </div>
      <div className="ft">
        <button className="btn ghost" onClick={closeModal}>Cancel</button>
        <button className="btn" onClick={save} disabled={saving}><Icon name="check" /> {saving ? "Sending…" : "Log Notice"}</button>
      </div>
    </>
  );
}

export function ScheduleAuctionModalContent({ loan, onSaved, onError }: { loan: LoanView; onSaved: (rec: AuctionRecordView) => void; onError?: () => void }) {
  const { closeModal } = useModal();
  const toast = useToast();
  const today = new Date().toISOString().slice(0, 10);
  const [date, setDate] = useState(today);
  const [ref, setRef] = useState("");
  const [err, setErr] = useState("");
  const [saving, setSaving] = useState(false);

  async function save() {
    if (!date) { setErr("Please select the auction date."); return; }
    setSaving(true);
    try {
      const rec = await scheduleAuction(loan.numericId, date, ref.trim() || undefined);
      onSaved(rec);
      closeModal();
      toast(`Auction scheduled for ${loan.id}`);
    } catch (e) {
      setErr(e instanceof ApiError ? e.message : "Could not schedule the auction — try again.");
      onError?.(); // see IssueNoticeModalContent's onError comment above
    } finally {
      setSaving(false);
    }
  }

  return (
    <>
      <div className="hd"><h3>Schedule Auction — {loan.id}</h3><button className="x" onClick={closeModal}>×</button></div>
      <div className="bd bd-scroll">
        <div className="frow c2">
          <div><label className="f">Auction Date *</label><DatePicker value={date} onChange={setDate} /></div>
          <div><label className="f">Reference Number</label><input className="inp" value={ref} onChange={(e) => setRef(e.target.value)} /></div>
        </div>
        <p style={{ color: "var(--red)", fontSize: 12.5, minHeight: 16, marginTop: 8 }}>{err}</p>
      </div>
      <div className="ft">
        <button className="btn ghost" onClick={closeModal}>Cancel</button>
        <button className="btn" onClick={save} disabled={saving}><Icon name="check" /> {saving ? "Saving…" : "Schedule"}</button>
      </div>
    </>
  );
}

export function RecordSaleModalContent({ loan, onSaved, onError }: { loan: LoanView; onSaved: (rec: AuctionRecordView) => void; onError?: () => void }) {
  const { closeModal } = useModal();
  const toast = useToast();
  const [amount, setAmount] = useState("");
  const [expenses, setExpenses] = useState("");
  const [err, setErr] = useState("");
  const [saving, setSaving] = useState(false);

  const sale = +amount || 0;
  const exp = +expenses || 0;
  const preview = sale - exp - loan.totalOutstandingBalance;
  // With the auction_shortfall approval flow off no decision request is
  // raised — the balance is simply pursued (the loan moves to Overdue).
  const { config: workflow } = useApprovalWorkflow();
  const shortfallAuto = isFlowOff(workflow, "auction_shortfall");

  async function save() {
    if (!sale || sale <= 0) { setErr("Please enter the sale amount."); return; }
    setSaving(true);
    try {
      const rec = await recordAuctionSale(loan.numericId, sale, exp);
      onSaved(rec);
      closeModal();
      toast(`Auction sale recorded for ${loan.id}`);
    } catch (e) {
      setErr(e instanceof ApiError ? e.message : "Could not record the sale — try again.");
      onError?.(); // see IssueNoticeModalContent's onError comment above
    } finally {
      setSaving(false);
    }
  }

  return (
    <>
      <div className="hd"><h3>Record Auction Sale — {loan.id}</h3><button className="x" onClick={closeModal}>×</button></div>
      <div className="bd bd-scroll">
        <div className="notice" style={{ marginBottom: 16 }}>
          <Icon name="gavel" /> {loan.customerName} · outstanding <b>{fmt(loan.totalOutstandingBalance)}</b>
        </div>
        <div className="frow c2">
          <div><label className="f">Sale Amount (₹) *</label><input className="inp" type="number" min={1} value={amount} onChange={(e) => setAmount(e.target.value)} /></div>
          <div><label className="f">Auction Expenses (₹)</label><input className="inp" type="number" min={0} value={expenses} onChange={(e) => setExpenses(e.target.value)} /></div>
        </div>
        <div style={{ display: "flex", justifyContent: "space-between", padding: "8px 0", fontWeight: 600, color: preview >= 0 ? "var(--green)" : "var(--red)" }}>
          <span>{preview >= 0 ? "Surplus" : "Shortfall"}</span><span>{fmt(Math.abs(preview))}</span>
        </div>
        {/* Spell out the consequence before the click. The two outcomes differ
          * sharply — one closes the loan, the other keeps a real balance owing
          * and escalates it to management — and the amount entered here is what
          * decides which, so it should not be a surprise afterwards. */}
        {/* .notice is display:flex, so all text must sit inside ONE child
          * element — otherwise each <b> becomes its own flex item and the
          * amounts get pulled out into separate columns mid-sentence. */}
        {sale > 0 && (
          <div className="notice" style={{ fontSize: 12.5 }}>
            <Icon name="shield" />
            <span>
              {preview >= 0 ? (
                <>Full recovery — the loan will be <b>closed</b>. Net proceeds of {fmt(sale - exp)} will be added to Cash-in-Hand
                {preview > 0.01 ? <>, and a surplus of <b>{fmt(preview)}</b> will be payable back to {loan.customerName}</> : null}.</>
              ) : (
                <>Partial recovery — net proceeds of {fmt(sale - exp)} will be added to Cash-in-Hand and applied to the debt,
                leaving <b>{fmt(Math.abs(preview))}</b> still owing. The loan stays open and{" "}
                {shortfallAuto
                  ? <>the balance is pursued automatically — no decision is needed.</>
                  : <>a decision request goes to the Branch Manager to write the balance off or pursue it.</>}</>
              )}
            </span>
          </div>
        )}
        <p style={{ color: "var(--red)", fontSize: 12.5, minHeight: 16, marginTop: 8 }}>{err}</p>
      </div>
      <div className="ft">
        <button className="btn ghost" onClick={closeModal}>Cancel</button>
        <button className="btn" onClick={save} disabled={saving}><Icon name="check" /> {saving ? "Saving…" : "Record Sale"}</button>
      </div>
    </>
  );
}

/* SettleAuctionModalContent is now specifically the SURPLUS DISPOSITION step.
 * It is only reachable when the sale covered the debt in full — a shortfall goes
 * through the management decision instead (AuctionDecisionModalContent below),
 * and the backend rejects settling such a loan.
 *
 * The surplus is the customer's money, so what happens to it is recorded as an
 * explicit decision with no pre-selected default: previously the dropdown
 * defaulted based on the sign of the surplus, which meant the common path was to
 * accept whatever was already highlighted without really choosing. */
export function SettleAuctionModalContent({ loan, rec, onSaved, onError }: { loan: LoanView; rec: AuctionRecordView; onSaved: (rec: AuctionRecordView) => void; onError?: () => void }) {
  const { closeModal } = useModal();
  const toast = useToast();
  const [disposition, setDisposition] = useState<AuctionSurplusDisposition | "">("");
  const [remarks, setRemarks] = useState("");
  const [err, setErr] = useState("");
  const [saving, setSaving] = useState(false);

  const surplus = rec.surplusPayableAmount;
  // Guards a double-click/double-Enter that fires both calls before React
  // has re-rendered the disabled button — `saving` state alone isn't
  // enough since both calls can read it as still-false in the same tick.
  // Without this, the first call could settle the case and the second
  // then fails against the now-concluded case with a confusing "no active
  // auction" error, even though the settle itself succeeded.
  const submittingRef = useRef(false);

  async function save() {
    if (submittingRef.current) return;
    if (!disposition) { setErr("Please choose what happens to the surplus."); return; }
    // Retaining a customer's money needs a stated reason — enforced server-side
    // too, so this is a courtesy check rather than the control.
    if (disposition === "RecordedAsIncome" && !remarks.trim()) {
      setErr("Please state why the surplus is being retained.");
      return;
    }
    submittingRef.current = true;
    setSaving(true);
    try {
      const updated = await settleAuction(loan.numericId, disposition, remarks.trim() || undefined);
      onSaved(updated);
      closeModal();
      toast(disposition === "RefundedToCustomer"
        ? `Surplus of ${fmt(surplus)} marked for refund to ${loan.customerName}`
        : `Auction settled for ${loan.id} — surplus retained as income`);
    } catch (e) {
      onError?.(); // see IssueNoticeModalContent's onError comment above
      // "already settled" means a previous attempt already succeeded (a
      // stale screen re-submitting after its first click went through) —
      // nothing left for this modal to do, so close it instead of leaving
      // staff staring at a settle form for a case that's already done.
      if (e instanceof ApiError && /already been settled/i.test(e.message)) {
        closeModal();
        toast("This auction case was already settled.");
        return;
      }
      setErr(e instanceof ApiError ? e.message : "Could not settle the auction — try again.");
      submittingRef.current = false;
    } finally {
      setSaving(false);
    }
  }

  return (
    <>
      <div className="hd"><h3>Settle Auction — {loan.id}</h3><button className="x" onClick={closeModal}>×</button></div>
      <div className="bd bd-scroll">
        <div className="notice" style={{ marginBottom: 16 }}>
          <Icon name="gavel" />
          <span>
            The gold sold for {fmt(rec.saleAmount)} and cleared the full amount owed.
            A surplus of <b>{fmt(surplus)}</b> remains. What should happen to it?
          </span>
        </div>
        <div className="frow"><div>
          <label className="f">Surplus Disposition *</label>
          <div style={{ display: "flex", flexDirection: "column", gap: 6, marginTop: 4 }}>
            <label className="cradio" style={{ fontSize: 13 }}>
              <input type="radio" name="disposition" checked={disposition === "RefundedToCustomer"} onChange={() => setDisposition("RefundedToCustomer")} />
              <span className="mark" />
              <span>
                <strong className="cradio-title">Refund to customer</strong>
                <span className="cradio-detail">a cash-out of {fmt(surplus)} will be booked and the money handed back to {loan.customerName}.</span>
              </span>
            </label>
            <label className="cradio" style={{ fontSize: 13 }}>
              <input type="radio" name="disposition" checked={disposition === "RecordedAsIncome"} onChange={() => setDisposition("RecordedAsIncome")} />
              <span className="mark" />
              <span>
                <strong className="cradio-title">Record as company income</strong>
                <span className="cradio-detail">the money stays in the till. No further cash movement is created, since the full proceeds were already booked in at sale time.</span>
              </span>
            </label>
          </div>
        </div></div>
        <div className="frow"><div>
          <label className="f">Remarks {disposition === "RecordedAsIncome" ? "*" : ""}</label>
          <input className="inp" value={remarks} onChange={(e) => setRemarks(e.target.value)} placeholder="reason / reference" maxLength={255} />
        </div></div>
        <p style={{ fontSize: 12, color: "var(--muted)" }}>This can only be recorded once — a surplus cannot be disposed of twice.</p>
        <p style={{ color: "var(--red)", fontSize: 12.5, minHeight: 16, marginTop: 8 }}>{err}</p>
      </div>
      <div className="ft">
        <button className="btn ghost" onClick={closeModal}>Cancel</button>
        {/* Not blanket-disabled on `!disposition` — that would block save()'s
         * own "Please choose what happens to the surplus" validation (and
         * Enter-to-submit, see common/utils/enterToSubmit.ts) from ever
         * running, silently doing nothing instead of showing the warning. */}
        <button className="btn" onClick={save} disabled={saving}><Icon name="check" /> {saving ? "Saving…" : "Settle"}</button>
      </div>
    </>
  );
}

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
}: {
  loan: LoanView;
  request: AuctionDecisionRequestView;
  onSaved: (rec: AuctionRecordView) => void;
  onError?: () => void;
}) {
  const { closeModal } = useModal();
  const toast = useToast();
  const isShortfall = request.kind === "Shortfall";
  const [decision, setDecision] = useState<Exclude<AuctionDecisionStatus, "Pending"> | "">("");
  const [remarks, setRemarks] = useState("");
  const [err, setErr] = useState("");
  const [saving, setSaving] = useState(false);

  async function save() {
    if (!decision) { setErr("Please choose a decision."); return; }
    if (isShortfall && !remarks.trim()) { setErr("Please state the reason for this decision."); return; }
    setSaving(true);
    try {
      const updated = await resolveAuctionDecision(loan.numericId, request.id, decision, remarks.trim() || undefined);
      onSaved(updated);
      closeModal();
      toast(DECISION_TOASTS[decision](loan.id));
    } catch (e) {
      setErr(e instanceof ApiError ? e.message : "Could not record the decision — try again.");
      onError?.(); // see IssueNoticeModalContent's onError comment above
    } finally {
      setSaving(false);
    }
  }

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

        <div className="frow"><div>
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
                  onChange={() => setDecision(value as Exclude<AuctionDecisionStatus, "Pending">)}
                />
                <span className="mark" />
                <span>
                  <strong className="cradio-title">{title}</strong>
                  <span className="cradio-detail">{detail}</span>
                </span>
              </label>
            ))}
          </div>
        </div></div>

        <div className="frow"><div>
          <label className="f">Remarks {isShortfall ? "*" : ""}</label>
          <input className="inp" value={remarks} onChange={(e) => setRemarks(e.target.value)} placeholder="reason for this decision" maxLength={255} />
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
