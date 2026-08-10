"use client";

import { useState } from "react";
import { useModal } from "@/components/Modal";
import { useToast } from "@/components/Toast";
import { Icon } from "@/lib/icons";
import { createScheme, updateScheme, type SchemeView } from "@/lib/schemesApi";

const DURATIONS = [3, 6, 9, 12, 18, 24];
const METHODS = ["Monthly simple interest", "Flat monthly", "Quarterly simple", "Compound monthly"];

/* Ported from legacy/app.js's `openSchemeModal(id)` / `saveScheme(id)`
 * (legacy/app.js:1154-1219). Now calls the Go backend (`POST`/`PUT
 * /api/v1/schemes`) instead of writing to the localStorage mock store. */
export function SchemeModalContent({ scheme: s, onSaved }: { scheme?: SchemeView; onSaved: () => void }) {
  const { closeModal } = useModal();
  const toast = useToast();

  const [name, setName] = useState(s?.name || "");
  const [rate, setRate] = useState(s ? String(s.rate) : "");
  const [duration, setDuration] = useState(s?.durationMonths || DURATIONS[3]);
  const [ltv, setLtv] = useState(s ? String(s.ltv) : "");
  const [method, setMethod] = useState(s?.method || METHODS[0]);
  const [penal, setPenal] = useState(s ? String(s.penal) : "");
  const [cond, setCond] = useState(s?.cond || "");
  const [active, setActive] = useState(s ? s.active : true);
  const [err, setErr] = useState("");
  const [saving, setSaving] = useState(false);

  async function save() {
    const n = name.trim();
    const r = parseFloat(rate);
    const l = parseInt(ltv, 10);
    const p = parseFloat(penal);
    if (n.length < 3) { setErr("Please enter a scheme name."); return; }
    if (!(r > 0)) { setErr("Please enter a valid interest rate."); return; }
    if (!(l >= 1 && l <= 90)) { setErr("LTV must be between 1 and 90%."); return; }
    if (!(p >= 0 && p <= 10)) { setErr("Please enter penal charges between 0 and 10% per month."); return; }

    const input = { name: n, rate: r, durationMonths: duration, ltv: l, penal: p, method, cond: cond.trim(), active };
    setSaving(true);
    setErr("");
    try {
      if (s) await updateScheme(s.id, input);
      else await createScheme(input);
      onSaved();
      closeModal();
      toast(s ? `Scheme "${n}" updated` : `Scheme "${n}" created`);
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Failed to save scheme.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <>
      <div className="hd"><h3>{s ? "Edit Scheme — " + s.name : "New Loan Scheme"}</h3><button className="x" onClick={closeModal}>×</button></div>
      <div className="bd">
        <div className="frow c2">
          <div><label className="f">Scheme Name *</label><input className="inp" placeholder="e.g. Swarna Premium" value={name} onChange={(e) => setName(e.target.value)} /></div>
          <div><label className="f">Interest Rate (% p.a.) *</label><input className="inp" type="number" step="0.1" min={0} placeholder="12.5" value={rate} onChange={(e) => setRate(e.target.value)} /></div>
        </div>
        <div className="frow c2">
          <div><label className="f">Loan Duration *</label>
            <select className="inp" value={duration} onChange={(e) => setDuration(Number(e.target.value))}>
              {DURATIONS.map((d) => <option key={d} value={d}>{d} months</option>)}
            </select></div>
          <div><label className="f">LTV (%) *</label><input className="inp" type="number" min={1} max={90} placeholder="max 90" value={ltv} onChange={(e) => setLtv(e.target.value)} /></div>
        </div>
        <div className="frow c2">
          <div><label className="f">Interest Calculation Method</label>
            <select className="inp" value={method} onChange={(e) => setMethod(e.target.value)}>
              {METHODS.map((m) => <option key={m}>{m}</option>)}
            </select></div>
          <div><label className="f">Penal Charges (% / month) *</label>
            <input className="inp" type="number" step="0.1" min={0} max={10} placeholder="e.g. 2" value={penal} onChange={(e) => setPenal(e.target.value)} /></div>
        </div>
        <div className="frow"><div><label className="f">Applicable Conditions</label>
          <input className="inp" placeholder="e.g. Interest payable monthly; penal 2%/m after due" value={cond} onChange={(e) => setCond(e.target.value)} /></div></div>
        <div className="frow"><div><label className="f">Status</label>
          <select className="inp" value={active ? "1" : "0"} onChange={(e) => setActive(e.target.value === "1")}>
            <option value="1">Active</option>
            <option value="0">Inactive</option>
          </select></div></div>
        <div className="notice"><Icon name="shield" /> Scheme changes are restricted to authorized administrators and recorded in the audit trail.</div>
        <p style={{ color: "var(--red)", fontSize: 12.5, minHeight: 16, marginTop: 8 }}>{err}</p>
      </div>
      <div className="ft">
        <button className="btn ghost" onClick={closeModal}>Cancel</button>
        <button className="btn" onClick={save} disabled={saving}><Icon name="check" /> {saving ? "Saving…" : s ? "Save Changes" : "Create Scheme"}</button>
      </div>
    </>
  );
}
