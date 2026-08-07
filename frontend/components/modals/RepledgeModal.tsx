"use client";

import { useState } from "react";
import { useData } from "@/lib/DataProvider";
import { useModal } from "@/components/Modal";
import { useToast } from "@/components/Toast";
import { Icon } from "@/lib/icons";
import { fmtW } from "@/lib/format";
import type { Loan } from "@/lib/data";

/* Ported from legacy/app.js's `openRepledgeModal()` / `saveRepledge()`. */
export function RepledgeModalContent({ loanId }: { loanId: string }) {
  const { db, refresh } = useData();
  const { closeModal } = useModal();
  const toast = useToast();

  const l = db.loans.find((x) => x.id === loanId);
  const today = new Date().toISOString().slice(0, 10);

  const [bank, setBank] = useState("");
  const [ref, setRef] = useState("");
  const [amt, setAmt] = useState("");
  const [date, setDate] = useState(today);
  const [err, setErr] = useState("");

  if (!l) { toast("Loan not found"); return null; }

  function save() {
    if (!bank) { setErr("Please select the bank to repledge with."); return; }
    if (!date) { setErr("Please select the pledge date."); return; }
    const bankRef = ref.trim().toUpperCase() ||
      (bank.split(" ").map((w) => w[0]).join("").toUpperCase() + "/RPL/" + String(Date.now()).slice(-4));
    const amount = +amt || 0;
    const fields: Partial<Loan> = { pledge: "Bank Pledged", bank, bankRef, pledgeDate: date, locker: "Bank: " + bank };
    if (amount) fields.pledgeAmt = amount;
    if (!db.updateLoan(loanId, fields)) { setErr("Could not save — storage is full."); return; }
    db.addPayment(loanId, { d: date, desc: "Gold repledged — " + bank, debit: 0, credit: 0, mode: "—", ref: bankRef });
    refresh();
    closeModal();
    toast(`Gold repledged to ${bank} (${bankRef})`);
  }

  return (
    <>
      <div className="hd"><h3>Repledge Gold to Bank — {l.id}</h3><button className="x" onClick={closeModal}>×</button></div>
      <div className="bd">
        <div className="notice" style={{ marginBottom: 16 }}>
          <Icon name="bank" /> Packet <b>{l.packet}</b> · {fmtW(l.weight)} gold · currently at <b>{l.locker}</b>
        </div>
        <div className="frow"><div><label className="f">Bank *</label>
          <select className="inp" value={bank} onChange={(e) => setBank(e.target.value)}>
            <option value="">Select bank…</option>
            {db.banks.map((b) => <option key={b.name}>{b.name}</option>)}
          </select></div></div>
        <div className="frow c2">
          <div><label className="f">Pledge Reference (optional)</label><input className="inp" placeholder="Bank pledge ref — auto if blank" style={{ textTransform: "uppercase" }} value={ref} onChange={(e) => setRef(e.target.value)} /></div>
          <div><label className="f">Pledged Amount (₹, optional)</label><input className="inp" type="number" min={1} placeholder="amount raised from bank" value={amt} onChange={(e) => setAmt(e.target.value)} /></div>
        </div>
        <div className="frow"><div><label className="f">Pledge Date *</label><input className="inp" type="date" value={date} onChange={(e) => setDate(e.target.value)} /></div></div>
        <p style={{ color: "var(--red)", fontSize: 12.5, minHeight: 16, marginTop: 8 }}>{err}</p>
      </div>
      <div className="ft">
        <button className="btn ghost" onClick={closeModal}>Cancel</button>
        <button className="btn" onClick={save}><Icon name="check" /> Repledge to Bank</button>
      </div>
    </>
  );
}
