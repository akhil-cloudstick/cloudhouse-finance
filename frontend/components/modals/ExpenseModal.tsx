"use client";

import { useRef, useState } from "react";
import { useData } from "@/lib/DataProvider";
import { useModal } from "@/components/Modal";
import { useToast } from "@/components/Toast";
import { Icon } from "@/lib/icons";
import { fmt } from "@/lib/format";
import { shrinkImage } from "@/lib/shrinkImage";
import type { Expense } from "@/lib/data";

const CATS = ["Rent & Utilities", "Salaries", "Transportation", "Marketing", "Bank Charges", "Maintenance", "Stationery & Office", "Other"];
const MODES = ["Cash", "UPI", "Bank"];

/* Ported from legacy/app.js's `openExpenseModal()` / `saveExpense()`. */
export function ExpenseModalContent() {
  const { db, refresh } = useData();
  const { closeModal } = useModal();
  const toast = useToast();
  const today = new Date().toISOString().slice(0, 10);
  const fileRef = useRef<HTMLInputElement | null>(null);

  const [desc, setDesc] = useState("");
  const [amt, setAmt] = useState("");
  const [date, setDate] = useState(today);
  const [cat, setCat] = useState(CATS[0]);
  const [mode, setMode] = useState(MODES[0]);
  const [err, setErr] = useState("");

  async function save() {
    const d = desc.trim();
    if (!d) { setErr("Please enter a description."); return; }
    const amount = +amt;
    if (!(amount > 0)) { setErr("Please enter a valid amount."); return; }
    if (!date) { setErr("Please select the date."); return; }

    const e: Expense = { d: date, cat, amt: amount, mode, payee: d, branch: "Koratty", status: "Approved" };
    // legacy always sets payee = desc; the ported Expense type only has `payee`.
    const file = fileRef.current?.files?.[0];
    if (file) e.img = await shrinkImage(file);

    if (!db.addExpense(e)) { setErr("Could not save — storage is full."); return; }
    refresh();
    closeModal();
    toast(`Expense of ${fmt(amount)} recorded`);
  }

  return (
    <>
      <div className="hd"><h3>Record Expense</h3><button className="x" onClick={closeModal}>×</button></div>
      <div className="bd">
        <div className="frow"><div><label className="f">Description *</label>
          <input className="inp" placeholder="e.g. Office maintenance" value={desc} onChange={(e) => setDesc(e.target.value)} /></div></div>
        <div className="frow c2">
          <div><label className="f">Amount (₹) *</label><input className="inp" type="number" min={1} value={amt} onChange={(e) => setAmt(e.target.value)} /></div>
          <div><label className="f">Date *</label><input className="inp" type="date" value={date} onChange={(e) => setDate(e.target.value)} /></div>
        </div>
        <div className="frow c2">
          <div><label className="f">Category</label>
            <select className="inp" value={cat} onChange={(e) => setCat(e.target.value)}>
              {CATS.map((c) => <option key={c}>{c}</option>)}
            </select></div>
          <div><label className="f">Payment Mode</label>
            <select className="inp" value={mode} onChange={(e) => setMode(e.target.value)}>
              {MODES.map((m) => <option key={m}>{m}</option>)}
            </select></div>
        </div>
        <div className="frow"><div><label className="f">Receipt / Bill Image</label>
          <input className="inp" type="file" accept="image/*" ref={fileRef} /></div></div>
        <p style={{ color: "var(--red)", fontSize: 12.5, minHeight: 16, marginTop: 8 }}>{err}</p>
      </div>
      <div className="ft">
        <button className="btn ghost" onClick={closeModal}>Cancel</button>
        <button className="btn" onClick={save}><Icon name="check" /> Record Expense</button>
      </div>
    </>
  );
}

/* Ported from legacy/app.js's `viewExpenseReceipt()`. */
export function ReceiptViewModalContent({ e }: { e: Expense }) {
  const { closeModal } = useModal();
  return (
    <>
      <div className="hd"><h3>Receipt — {e.payee} ({fmt(e.amt)})</h3><button className="x" onClick={closeModal}>×</button></div>
      <div className="bd" style={{ textAlign: "center" }}>
        <img src={e.img} style={{ maxWidth: "100%", maxHeight: "70vh", borderRadius: 8 }} alt="Receipt" />
      </div>
    </>
  );
}
