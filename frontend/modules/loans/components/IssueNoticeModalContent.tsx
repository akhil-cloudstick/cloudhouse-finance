"use client";

import { useState } from "react";
import { useModal } from "@/common/components/ModalProvider";
import { useToast } from "@/common/components/ToastProvider";
import { Icon } from "@/common/components/Icon";
import { issueAuctionNotice } from "@/modules/loans/services/loanService";
import { type AuctionRecordView, type LoanView } from "@/modules/loans/types/loan-types";
import { ApiError } from "@/common/services/httpClient";
import { singleFlight } from "@/common/utils/singleFlight";

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
type IssueNoticeModalContentProps = { loan: LoanView; onSaved: (rec: AuctionRecordView) => void; onError?: () => void };

export function IssueNoticeModalContent({ loan, onSaved, onError }: IssueNoticeModalContentProps) {
  const { closeModal } = useModal();
  const toast = useToast();
  const [remarks, setRemarks] = useState("");
  const [err, setErr] = useState("");
  const [saving, setSaving] = useState(false);

  async function save() { return singleFlight("auction-modal:save:1", async () => {
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
  }); }

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
