"use client";

import { useState } from "react";
import { useData } from "@/lib/DataProvider";
import { useModal } from "@/components/Modal";
import { useToast } from "@/components/Toast";
import { Icon } from "@/lib/icons";

/* Ported from legacy/app.js's `openRateModal()` / `saveRate()`. */
export function RateModalContent() {
  const { db, refresh } = useData();
  const { closeModal } = useModal();
  const toast = useToast();

  const [r24, setR24] = useState(String(db.rates.k24));
  const [r22, setR22] = useState(String(db.rates.k22));
  const [r18, setR18] = useState(String(db.rates.k18));
  const [remarks, setRemarks] = useState("");

  function save() {
    const r = {
      date: new Date().toISOString().slice(0, 10),
      k24: +r24 || db.rates.k24,
      k22: +r22 || db.rates.k22,
      k18: +r18 || db.rates.k18,
      setBy: "Rajesh Menon",
    };
    db.saveRates(r);
    refresh();
    closeModal();
    toast("Gold rate published for today");
  }

  return (
    <>
      <div className="hd"><h3>Set Today&apos;s Gold Rate</h3><button className="x" onClick={closeModal}>×</button></div>
      <div className="bd">
        <div className="notice" style={{ marginBottom: 16 }}>
          <Icon name="shield" /> Rate changes apply to all new valuations and are recorded in the audit trail.
        </div>
        <div className="frow c3">
          <div><label className="f">24K · 999 (₹/g)</label><input className="inp" type="number" value={r24} onChange={(e) => setR24(e.target.value)} /></div>
          <div><label className="f">22K · 916 (₹/g)</label><input className="inp" type="number" value={r22} onChange={(e) => setR22(e.target.value)} /></div>
          <div><label className="f">18K · 750 (₹/g)</label><input className="inp" type="number" value={r18} onChange={(e) => setR18(e.target.value)} /></div>
        </div>
        <div className="frow"><div><label className="f">Remarks (optional)</label><input className="inp" placeholder="e.g. MCX morning reference" value={remarks} onChange={(e) => setRemarks(e.target.value)} /></div></div>
      </div>
      <div className="ft">
        <button className="btn ghost" onClick={closeModal}>Cancel</button>
        <button className="btn" onClick={save}><Icon name="check" /> Publish Rate</button>
      </div>
    </>
  );
}
