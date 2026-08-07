"use client";

import { useState } from "react";
import { useData } from "@/lib/DataProvider";
import { useModal } from "@/components/Modal";
import { useToast } from "@/components/Toast";
import { Icon } from "@/lib/icons";
import { fmt } from "@/lib/format";

/* Ported from legacy/app.js's `openPaymentModal()` / `pmModeChanged()` /
 * `savePayment()`. */
export function PaymentModalContent({ loanId }: { loanId: string }) {
  const { db, refresh } = useData();
  const { closeModal } = useModal();
  const toast = useToast();

  const l = db.loans.find((x) => x.id === loanId);
  const today = new Date().toISOString().slice(0, 10);

  const [mode, setMode] = useState("");
  const [bank, setBank] = useState("");
  const [txn, setTxn] = useState("");
  const [amt, setAmt] = useState("");
  const [date, setDate] = useState(today);
  const [err, setErr] = useState("");

  if (!l) { toast("Loan not found"); return null; }

  function save() {
    if (!mode) { setErr("Please select a payment mode."); return; }
    let desc = "Payment received";
    let ref = "PAY-" + String(Date.now()).slice(-4);
    if (mode === "Bank Transfer") {
      if (!bank) { setErr("Please select the bank the transfer was received in."); return; }
      desc = "Payment received — " + bank;
    }
    if (mode === "UPI") {
      const t = txn.trim().toUpperCase();
      if (!t) { setErr("Please enter the UPI transaction ID."); return; }
      ref = t;
    }
    const amount = +amt;
    if (!amount || amount <= 0) { setErr("Please enter a valid payment amount."); return; }
    if (!date) { setErr("Please select the payment date."); return; }
    const entry = { d: date, desc, debit: 0, credit: amount, mode, ref };
    if (!db.addPayment(loanId, entry)) { setErr("Could not save the payment — storage is full."); return; }
    refresh();
    closeModal();
    toast(`Payment of ${fmt(amount)} recorded (${mode})`);
  }

  return (
    <>
      <div className="hd"><h3>Record Payment — {l.id}</h3><button className="x" onClick={closeModal}>×</button></div>
      <div className="bd">
        <div className="notice" style={{ marginBottom: 16 }}>
          <Icon name="coin" /> Current outstanding: <b>{l.outstanding ? fmt(l.outstanding) : "—"}</b>
        </div>
        <div className="frow"><div><label className="f">Payment Mode *</label>
          <select className="inp" value={mode} onChange={(e) => setMode(e.target.value)}>
            <option value="">Select payment mode…</option>
            <option>Bank Transfer</option>
            <option>UPI</option>
            <option>Cash</option>
          </select></div></div>
        {mode === "Bank Transfer" && (
          <div className="frow"><div><label className="f">Bank *</label>
            <select className="inp" value={bank} onChange={(e) => setBank(e.target.value)}>
              <option value="">Select bank…</option>
              {db.banks.map((b) => <option key={b.name}>{b.name}</option>)}
            </select></div></div>
        )}
        {mode === "UPI" && (
          <div className="frow"><div><label className="f">UPI Transaction ID *</label>
            <input className="inp" placeholder="e.g. 417229038511" style={{ textTransform: "uppercase" }} value={txn} onChange={(e) => setTxn(e.target.value)} /></div></div>
        )}
        <div className="frow c2">
          <div><label className="f">Amount (₹) *</label><input className="inp" type="number" min={1} placeholder="e.g. 5000" value={amt} onChange={(e) => setAmt(e.target.value)} /></div>
          <div><label className="f">Payment Date *</label><input className="inp" type="date" value={date} onChange={(e) => setDate(e.target.value)} /></div>
        </div>
        <p style={{ color: "var(--red)", fontSize: 12.5, minHeight: 16, marginTop: 8 }}>{err}</p>
      </div>
      <div className="ft">
        <button className="btn ghost" onClick={closeModal}>Cancel</button>
        <button className="btn" onClick={save}><Icon name="check" /> Record Payment</button>
      </div>
    </>
  );
}
