"use client";

import { useState } from "react";
import { useModal } from "@/components/Modal";
import { useToast } from "@/components/Toast";
import { Icon } from "@/lib/icons";
import { fmt } from "@/lib/format";
import { issueAuctionNotice, scheduleAuction, recordAuctionSale, settleAuction, type AuctionRecordView } from "@/lib/loansApi";
import { ApiError } from "@/lib/api";
import type { LoanView } from "@/lib/loansApi";

/* One modal body per auction stage-advance action — each posts to its own
 * POST /loans/:id/auction/{notice,schedule,sale,settle} endpoint (see
 * loansApi.ts) and hands the refreshed AuctionRecordView back to the
 * caller (Auctions.tsx) via onSaved. Replaces the old single AuctionModal
 * that recorded a date+sale-amount in one step and jumped straight to
 * "Auctioned" — the real workflow now has 4 separate staff actions. */

export function IssueNoticeModalContent({ loan, onSaved }: { loan: LoanView; onSaved: (rec: AuctionRecordView) => void }) {
  const { closeModal } = useModal();
  const toast = useToast();
  const [method, setMethod] = useState("Registered Post");
  const [remarks, setRemarks] = useState("");
  const [err, setErr] = useState("");
  const [saving, setSaving] = useState(false);

  async function save() {
    setSaving(true);
    try {
      const rec = await issueAuctionNotice(loan.numericId, method, remarks.trim() || undefined);
      onSaved(rec);
      closeModal();
      toast(`Notice logged for ${loan.id}`);
    } catch (e) {
      setErr(e instanceof ApiError ? e.message : "Could not log the notice — try again.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <>
      <div className="hd"><h3>Issue Auction Notice — {loan.id}</h3><button className="x" onClick={closeModal}>×</button></div>
      <div className="bd">
        <div className="frow"><div><label className="f">Method *</label>
          <select className="inp" value={method} onChange={(e) => setMethod(e.target.value)}>
            <option>Registered Post</option>
            <option>SMS</option>
            <option>In Person</option>
            <option>Email</option>
          </select></div></div>
        <div className="frow"><div><label className="f">Remarks</label><input className="inp" value={remarks} onChange={(e) => setRemarks(e.target.value)} /></div></div>
        <p style={{ color: "var(--red)", fontSize: 12.5, minHeight: 16, marginTop: 8 }}>{err}</p>
      </div>
      <div className="ft">
        <button className="btn ghost" onClick={closeModal}>Cancel</button>
        <button className="btn" onClick={save} disabled={saving}><Icon name="check" /> {saving ? "Saving…" : "Log Notice"}</button>
      </div>
    </>
  );
}

export function ScheduleAuctionModalContent({ loan, onSaved }: { loan: LoanView; onSaved: (rec: AuctionRecordView) => void }) {
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
    } finally {
      setSaving(false);
    }
  }

  return (
    <>
      <div className="hd"><h3>Schedule Auction — {loan.id}</h3><button className="x" onClick={closeModal}>×</button></div>
      <div className="bd">
        <div className="frow c2">
          <div><label className="f">Auction Date *</label><input className="inp" type="date" value={date} onChange={(e) => setDate(e.target.value)} /></div>
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

export function RecordSaleModalContent({ loan, onSaved }: { loan: LoanView; onSaved: (rec: AuctionRecordView) => void }) {
  const { closeModal } = useModal();
  const toast = useToast();
  const [amount, setAmount] = useState("");
  const [expenses, setExpenses] = useState("");
  const [err, setErr] = useState("");
  const [saving, setSaving] = useState(false);

  const sale = +amount || 0;
  const exp = +expenses || 0;
  const preview = sale - exp - loan.totalOutstandingBalance;

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
    } finally {
      setSaving(false);
    }
  }

  return (
    <>
      <div className="hd"><h3>Record Auction Sale — {loan.id}</h3><button className="x" onClick={closeModal}>×</button></div>
      <div className="bd">
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
        <p style={{ color: "var(--red)", fontSize: 12.5, minHeight: 16, marginTop: 8 }}>{err}</p>
      </div>
      <div className="ft">
        <button className="btn ghost" onClick={closeModal}>Cancel</button>
        <button className="btn" onClick={save} disabled={saving}><Icon name="check" /> {saving ? "Saving…" : "Record Sale"}</button>
      </div>
    </>
  );
}

export function SettleAuctionModalContent({ loan, rec, onSaved }: { loan: LoanView; rec: AuctionRecordView; onSaved: (rec: AuctionRecordView) => void }) {
  const { closeModal } = useModal();
  const toast = useToast();
  const [status, setStatus] = useState<"SettledToCustomer" | "SettledToLoanCo">(rec.surplusShortfall >= 0 ? "SettledToCustomer" : "SettledToLoanCo");
  const [err, setErr] = useState("");
  const [saving, setSaving] = useState(false);

  async function save() {
    setSaving(true);
    try {
      const updated = await settleAuction(loan.numericId, status);
      onSaved(updated);
      closeModal();
      toast(`Auction settled for ${loan.id}`);
    } catch (e) {
      setErr(e instanceof ApiError ? e.message : "Could not settle the auction — try again.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <>
      <div className="hd"><h3>Settle Auction — {loan.id}</h3><button className="x" onClick={closeModal}>×</button></div>
      <div className="bd">
        <div className="notice" style={{ marginBottom: 16 }}>
          {rec.surplusShortfall >= 0 ? "Surplus" : "Shortfall"} of <b>{fmt(Math.abs(rec.surplusShortfall))}</b> from the sale.
        </div>
        <div className="frow"><div><label className="f">Settlement *</label>
          <select className="inp" value={status} onChange={(e) => setStatus(e.target.value as "SettledToCustomer" | "SettledToLoanCo")}>
            <option value="SettledToCustomer">Surplus refunded to customer</option>
            <option value="SettledToLoanCo">Shortfall recovered / written off</option>
          </select></div></div>
        <p style={{ color: "var(--red)", fontSize: 12.5, minHeight: 16, marginTop: 8 }}>{err}</p>
      </div>
      <div className="ft">
        <button className="btn ghost" onClick={closeModal}>Cancel</button>
        <button className="btn" onClick={save} disabled={saving}><Icon name="check" /> {saving ? "Saving…" : "Settle"}</button>
      </div>
    </>
  );
}
