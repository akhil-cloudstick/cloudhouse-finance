"use client";

import { useState } from "react";
import { useData } from "@/lib/DataProvider";
import { useModal } from "@/components/Modal";
import { useToast } from "@/components/Toast";
import { Icon } from "@/lib/icons";
import { fmt } from "@/lib/format";

/* Ported from legacy/app.js's `openCashOutModal()` / `saveCashOut()`. */
export function CashOutModalContent() {
  const { db, refresh } = useData();
  const { closeModal } = useModal();
  const toast = useToast();
  const today = new Date().toISOString().slice(0, 10);

  const [purpose, setPurpose] = useState("");
  const [bank, setBank] = useState("");
  const [amt, setAmt] = useState("");
  const [date, setDate] = useState(today);
  const [err, setErr] = useState("");

  function save() {
    if (!purpose.trim()) { setErr("Please enter the purpose of this cash withdrawal."); return; }
    const amount = +amt;
    if (!(amount > 0)) { setErr("Please enter a valid cash amount."); return; }
    if (!date) { setErr("Please select the date."); return; }

    if (!db.addCashMovement({ d: date, type: "out", purpose: purpose.trim(), bank, amount })) {
      setErr("Could not save — storage is full.");
      return;
    }
    refresh();
    closeModal();
    toast(`${fmt(amount)} taken out of cash`);
  }

  return (
    <>
      <div className="hd"><h3>Take Cash Out</h3><button className="x" onClick={closeModal}>×</button></div>
      <div className="bd">
        <div className="frow"><div><label className="f">Purpose *</label>
          <input className="inp" placeholder="e.g. Bank deposit" value={purpose} onChange={(e) => setPurpose(e.target.value)} /></div></div>
        <div className="frow"><div><label className="f">Bank</label>
          <select className="inp" value={bank} onChange={(e) => setBank(e.target.value)}>
            <option value="">— None / not applicable —</option>
            {db.banks.map((b) => <option key={b.name}>{b.name}</option>)}
          </select></div></div>
        <div className="frow c2">
          <div><label className="f">Amount (₹) *</label><input className="inp" type="number" min={1} value={amt} onChange={(e) => setAmt(e.target.value)} /></div>
          <div><label className="f">Date *</label><input className="inp" type="date" value={date} onChange={(e) => setDate(e.target.value)} /></div>
        </div>
        <p style={{ color: "var(--red)", fontSize: 12.5, minHeight: 16, marginTop: 8 }}>{err}</p>
      </div>
      <div className="ft">
        <button className="btn ghost" onClick={closeModal}>Cancel</button>
        <button className="btn" onClick={save}><Icon name="check" /> Take Cash Out</button>
      </div>
    </>
  );
}
