"use client";

import { useState } from "react";
import { useModal } from "@/components/Modal";
import { useToast } from "@/components/Toast";
import { Icon } from "@/lib/icons";
import { fmt, fmtW } from "@/lib/format";
import { recordAuction, type LoanView } from "@/lib/loansApi";
import { ApiError } from "@/lib/api";

/* Ported from legacy/app.js's `openAuctionModal()` / `saveAuctionSchedule()`.
 * The mock version scheduled an auction date/venue as a separate step from
 * recording the sale outcome (db.auctions was always empty in this
 * codebase — see Auctions.tsx's notes). Now backed by the real
 * POST /loans/:id/auction endpoint, which records the auction date and
 * sale amount together and closes the loan out as "Auctioned" in one step
 * (no separate "Scheduled" vs "Sold" backend state exists yet). */
export function AuctionModalContent({ loan, onSaved }: { loan: LoanView; onSaved: () => void }) {
  const { closeModal } = useModal();
  const toast = useToast();
  const today = new Date().toISOString().slice(0, 10);

  const [date, setDate] = useState(today);
  const [amount, setAmount] = useState("");
  const [err, setErr] = useState("");
  const [saving, setSaving] = useState(false);

  async function save() {
    if (!date) { setErr("Please select the auction date."); return; }
    const amt = +amount;
    if (!amt || amt <= 0) { setErr("Please enter the sale amount."); return; }
    setSaving(true);
    try {
      await recordAuction(loan.numericId, { auctionDate: date, auctionAmount: amt });
      onSaved();
      closeModal();
      toast(`Auction recorded for ${loan.id} — sale amount ${fmt(amt)}`);
    } catch (e) {
      setErr(e instanceof ApiError ? e.message : "Could not record the auction — try again.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <>
      <div className="hd"><h3>Record Auction — {loan.id}</h3><button className="x" onClick={closeModal}>×</button></div>
      <div className="bd">
        <div className="notice" style={{ marginBottom: 16 }}>
          <Icon name="gavel" /> {loan.customerName} · {fmtW(loan.totalNetWeight)} gold · outstanding <b>{fmt(loan.outstanding)}</b>
        </div>
        <div className="frow c2">
          <div><label className="f">Auction Date *</label><input className="inp" type="date" value={date} onChange={(e) => setDate(e.target.value)} /></div>
          <div><label className="f">Sale Amount (₹) *</label><input className="inp" type="number" min={1} value={amount} onChange={(e) => setAmount(e.target.value)} /></div>
        </div>
        <p style={{ color: "var(--red)", fontSize: 12.5, minHeight: 16, marginTop: 8 }}>{err}</p>
      </div>
      <div className="ft">
        <button className="btn ghost" onClick={closeModal}>Cancel</button>
        <button className="btn" onClick={save} disabled={saving}><Icon name="check" /> {saving ? "Saving…" : "Record Auction"}</button>
      </div>
    </>
  );
}
