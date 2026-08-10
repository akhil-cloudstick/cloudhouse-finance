"use client";

import { useState } from "react";
import { useGoldRates } from "@/lib/GoldRatesProvider";
import { useModal } from "@/components/Modal";
import { useToast } from "@/components/Toast";
import { Icon } from "@/lib/icons";
import { publishGoldRate } from "@/lib/goldRateApi";
import { ApiError } from "@/lib/api";

/* Ported from legacy/app.js's `openRateModal()` / `saveRate()`. Now posts to
 * the real /gold-rates backend (see backend/internal/goldrate) instead of
 * db.saveRates()'s unvalidated localStorage write. */
export function RateModalContent() {
  const { latest, refresh } = useGoldRates();
  const { closeModal } = useModal();
  const toast = useToast();

  const [r24, setR24] = useState(String(latest.k24 || ""));
  const [r22, setR22] = useState(String(latest.k22 || ""));
  const [r18, setR18] = useState(String(latest.k18 || ""));
  const [remarks, setRemarks] = useState("");
  const [err, setErr] = useState("");
  const [saving, setSaving] = useState(false);

  async function save() {
    const k24 = +r24;
    const k22 = +r22;
    const k18 = +r18;
    if (!(k24 > 0) || !(k22 > 0) || !(k18 > 0)) {
      setErr("K24, K22 and K18 rates must all be greater than zero.");
      return;
    }
    setErr("");
    setSaving(true);
    try {
      await publishGoldRate({ k24, k22, k18, setBy: latest.setBy && latest.setBy !== "—" ? latest.setBy : "Admin" });
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
          <div><label className="f">22K · 916 (₹/g)</label><input className="inp" type="number" value={r22} onChange={(e) => setR22(e.target.value)} /></div>
          <div><label className="f">18K · 750 (₹/g)</label><input className="inp" type="number" value={r18} onChange={(e) => setR18(e.target.value)} /></div>
        </div>
        <div className="frow"><div><label className="f">Remarks (optional)</label><input className="inp" placeholder="e.g. MCX morning reference" value={remarks} onChange={(e) => setRemarks(e.target.value)} /></div></div>
        <p style={{ color: "var(--red)", fontSize: 12.5, minHeight: 16, marginTop: 8 }}>{err}</p>
      </div>
      <div className="ft">
        <button className="btn ghost" onClick={closeModal}>Cancel</button>
        <button className="btn" onClick={save} disabled={saving}><Icon name="check" /> {saving ? "Publishing…" : "Publish Rate"}</button>
      </div>
    </>
  );
}
