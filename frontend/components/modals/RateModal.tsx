"use client";

import { useState } from "react";
import { useGoldRates } from "@/lib/GoldRatesProvider";
import { useModal } from "@/components/Modal";
import { useToast } from "@/components/Toast";
import { Icon } from "@/lib/icons";
import { publishGoldRate } from "@/lib/goldRateApi";
import { rateForKarat } from "@/lib/purity";
import { ApiError } from "@/lib/api";

/* Ported from legacy/app.js's `openRateModal()` / `saveRate()`. Now posts to
 * the real /gold-rates backend (see backend/internal/goldrate) instead of
 * db.saveRates()'s unvalidated localStorage write.
 *
 * Only the 24K benchmark is published — every other purity is resolved
 * per-ornament, at pledge/re-test time, off this single number (see
 * PurityPicker.tsx / lib/purity.ts). The 22K/18K figures shown here are
 * just a live-computed reference, not separately published rates. */
export function RateModalContent() {
  const { latest, refresh } = useGoldRates();
  const { closeModal } = useModal();
  const toast = useToast();

  const [r24, setR24] = useState(String(latest.k24 || ""));
  const [remarks, setRemarks] = useState("");
  const [err, setErr] = useState("");
  const [saving, setSaving] = useState(false);

  const k24 = +r24;
  const computedK22 = k24 > 0 ? rateForKarat(k24, 22) : 0;
  const computedK18 = k24 > 0 ? rateForKarat(k24, 18) : 0;

  async function save() {
    if (!(k24 > 0)) {
      setErr("The 24K rate must be greater than zero.");
      return;
    }
    setErr("");
    setSaving(true);
    try {
      await publishGoldRate({ k24, setBy: latest.setBy && latest.setBy !== "—" ? latest.setBy : "Admin" });
      refresh();
      closeModal();
      toast("Gold rate published for today");
    } catch (e) {
      setErr(e instanceof ApiError ? e.message : "Could not publish rate — try again");
    } finally {
      setSaving(false);
    }
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
          <div><label className="f">22K (computed)</label><input className="inp" value={computedK22 ? `₹${computedK22}/g` : "—"} disabled /></div>
          <div><label className="f">18K (computed)</label><input className="inp" value={computedK18 ? `₹${computedK18}/g` : "—"} disabled /></div>
        </div>
        <p style={{ fontSize: 12, color: "var(--muted)", margin: "4px 0 0" }}>
          Only the 24K benchmark is published. Other purities are resolved per-ornament when pledged.
        </p>
        <div className="frow" style={{ marginTop: 10 }}><div><label className="f">Remarks (optional)</label><input className="inp" placeholder="e.g. MCX morning reference" value={remarks} onChange={(e) => setRemarks(e.target.value)} /></div></div>
        <p style={{ color: "var(--red)", fontSize: 12.5, minHeight: 16, marginTop: 8 }}>{err}</p>
      </div>
      <div className="ft">
        <button className="btn ghost" onClick={closeModal}>Cancel</button>
        <button className="btn" onClick={save} disabled={saving}><Icon name="check" /> {saving ? "Publishing…" : "Publish Rate"}</button>
      </div>
    </>
  );
}
