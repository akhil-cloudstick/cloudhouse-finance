"use client";

import { useState } from "react";
import { useData } from "@/lib/DataProvider";
import { useModal } from "@/components/Modal";
import { useToast } from "@/components/Toast";
import { Icon } from "@/lib/icons";
import { fmt } from "@/lib/format";

/* Ported from legacy/app.js's `openAddCashModal()` / `acSourceChanged()` /
 * `saveAddCash()`. */
export function AddCashModalContent() {
  const { db, refresh } = useData();
  const { closeModal } = useModal();
  const toast = useToast();
  const today = new Date().toISOString().slice(0, 10);

  const [source, setSource] = useState("");
  const [bank, setBank] = useState("");
  const [amt, setAmt] = useState("");
  const [date, setDate] = useState(today);
  const [err, setErr] = useState("");

  function save() {
    if (!source) { setErr("Please select where the cash is coming from."); return; }
    if (source === "Loan" && !bank) { setErr("Please select the bank the loan was taken from."); return; }
    const amount = +amt;
    if (!(amount > 0)) { setErr("Please enter a valid cash amount."); return; }
    if (!date) { setErr(source === "Loan" ? "Please select the date of the loan." : "Please select the date."); return; }

    const m: { d: string; type: "in"; source: string; bank?: string; amount: number; status?: string } = {
      d: date, type: "in", source, bank, amount,
    };
    if (source === "Loan") m.status = "Open";
    if (!db.addCashMovement(m)) { setErr("Could not save — storage is full."); return; }
    refresh();
    closeModal();
    toast(`${fmt(amount)} added to cash (${source})`);
  }

  return (
    <>
      <div className="hd"><h3>Add Cash</h3><button className="x" onClick={closeModal}>×</button></div>
      <div className="bd">
        <div className="frow"><div><label className="f">Source of Cash *</label>
          <select className="inp" value={source} onChange={(e) => { setSource(e.target.value); if (e.target.value !== "Loan") setBank(""); }}>
            <option value="">Select source…</option>
            <option>Savings</option>
            <option>Loan</option>
          </select></div></div>
        {source === "Loan" && (
          <div className="frow"><div><label className="f">Bank *</label>
            <select className="inp" value={bank} onChange={(e) => setBank(e.target.value)}>
              <option value="">Select bank…</option>
              {db.banks.map((b) => <option key={b.name}>{b.name}</option>)}
            </select></div></div>
        )}
        <div className="frow c2">
          <div><label className="f">Cash Amount (₹) *</label><input className="inp" type="number" min={1} value={amt} onChange={(e) => setAmt(e.target.value)} /></div>
          <div><label className="f">{source === "Loan" ? "Date of Loan *" : "Date *"}</label><input className="inp" type="date" value={date} onChange={(e) => setDate(e.target.value)} /></div>
        </div>
        <p style={{ color: "var(--red)", fontSize: 12.5, minHeight: 16, marginTop: 8 }}>{err}</p>
      </div>
      <div className="ft">
        <button className="btn ghost" onClick={closeModal}>Cancel</button>
        <button className="btn" onClick={save}><Icon name="check" /> Add Cash</button>
      </div>
    </>
  );
}
