"use client";

import { useState } from "react";
import { useGoldRates } from "@/modules/gold-rates/store/GoldRatesProvider";
import { useModal } from "@/common/components/Modal";
import { useToast } from "@/common/components/Toast";
import { Icon } from "@/common/components/Icon";
import { publishGoldRate } from "@/modules/gold-rates/services/goldRateService";
import { finenessForKarat, rateForFineness } from "@/common/utils/purity";
import { ApiError } from "@/common/services/httpClient";

type Mode = "auto" | "manual";

/* Ported from legacy/app.js's `openRateModal()` / `saveRate()`, then
 * redesigned to a single three-tile row (24K/22K/18K side by side,
 * matching the original layout) instead of a karat-picker + one field.
 *
 * Mode is all-or-nothing across all three karats — there is no per-karat
 * Auto/Manual split:
 * - Auto (default): every karat's rate derives live off a REFERENCE 24K
 *   figure (today's/session's already-published K24, frozen at open —
 *   `ref24` below) at an editable fineness% (prefilled with the standard
 *   ratio: 100% for 24K itself, karat/24 for 22K/18K). Typing the
 *   fineness recomputes that karat's rate live.
 * - Typing directly into 22K's or 18K's RATE field switches ALL THREE
 *   karats to Manual at once — same as pressing the top "Manual" tab —
 *   so the modal never sits in a half-Auto/half-Manual state that only
 *   shows up as one column's Fineness field quietly disappearing. 24K's
 *   rate is the one exception: typing it directly does NOT trigger the
 *   switch, since 24K has no separate reference to fall out of sync
 *   with — it can be nudged in Auto without leaving it.
 * - Manual: every rate is typed directly, independent of 24K; there is
 *   no fineness control since there's nothing to derive.
 *
 * On publish, only karats whose effective rate actually differs from the
 * latest published row go out — each as its own POST /gold-rates call,
 * in 24→22→18 order, so a later call's "carry the others forward" (see
 * backend PublishInput's doc comment) always carries the row this same
 * click just published, not a stale one. */
export function RateModalContent() {
  const { latest, refresh } = useGoldRates();
  const { closeModal } = useModal();
  const toast = useToast();

  // Frozen at open — the "999 reference" every Auto karat (24K included)
  // derives its fineness-adjusted rate off. Re-deriving off a live-edited
  // rate24 would make 24K's own fineness field circular (adjusting what
  // it's itself adjusting), so this stays fixed for the life of the modal.
  const [ref24] = useState(latest.k24 || 0);

  const [mode, setMode] = useState<Mode>("auto");

  const [rate24, setRate24] = useState(String(latest.k24 || ""));
  const [fineness24, setFineness24] = useState("100");

  const [rate22, setRate22] = useState(String(latest.k22 || ""));
  const [fineness22, setFineness22] = useState(String(finenessForKarat(22)));

  const [rate18, setRate18] = useState(String(latest.k18 || ""));
  const [fineness18, setFineness18] = useState(String(finenessForKarat(18)));

  const [remarks, setRemarks] = useState("");
  const [err, setErr] = useState("");
  const [saving, setSaving] = useState(false);

  function setAuto() {
    setMode("auto");
    setFineness24("100");
    setFineness22(String(finenessForKarat(22)));
    setFineness18(String(finenessForKarat(18)));
    setRate24(ref24 > 0 ? String(ref24) : "");
    setRate22(ref24 > 0 ? String(rateForFineness(ref24, finenessForKarat(22))) : "");
    setRate18(ref24 > 0 ? String(rateForFineness(ref24, finenessForKarat(18))) : "");
    setErr("");
  }
  function setManual() {
    setMode("manual");
    setErr("");
  }

  function editRate24(v: string) {
    setRate24(v); // never switches mode — see file doc comment
  }
  function editRate22(v: string) {
    setMode("manual"); // any direct 22K/18K rate edit is all-or-nothing
    setRate22(v);
  }
  function editRate18(v: string) {
    setMode("manual");
    setRate18(v);
  }
  // Fineness is a purity percentage — never meaningfully above 100%
  // (pure gold itself). Clamped, not rejected: typing "150" just settles
  // at "100" rather than blocking the keystroke or showing an error.
  function clampFineness(v: string): string {
    return v !== "" && +v > 100 ? "100" : v;
  }
  function editFineness24(v: string) {
    const c = clampFineness(v);
    setFineness24(c);
    if (ref24 > 0 && +c > 0) setRate24(String(rateForFineness(ref24, +c)));
  }
  function editFineness22(v: string) {
    const c = clampFineness(v);
    setFineness22(c);
    if (ref24 > 0 && +c > 0) setRate22(String(rateForFineness(ref24, +c)));
  }
  function editFineness18(v: string) {
    const c = clampFineness(v);
    setFineness18(c);
    if (ref24 > 0 && +c > 0) setRate18(String(rateForFineness(ref24, +c)));
  }

  // Non-blocking sanity check on Manual entries — 22K/18K priced above a
  // purer karat inverts the usual purity hierarchy (less pure gold should
  // never cost more per gram). Flagged, never prevented: a real market
  // anomaly can legitimately happen and staff may need to publish it
  // anyway.
  const hierarchyWarning =
    mode === "manual" && +rate22 > 0 && +rate24 > 0 && +rate22 > +rate24
      ? "22K is priced higher than 24K."
      : mode === "manual" && +rate18 > 0 && +rate22 > 0 && +rate18 > +rate22
        ? "18K is priced higher than 22K."
        : mode === "manual" && +rate18 > 0 && +rate24 > 0 && +rate18 > +rate24
          ? "18K is priced higher than 24K."
          : "";

  async function save() {
    const setBy = latest.setBy && latest.setBy !== "—" ? latest.setBy : "Admin";
    if (!(+rate24 > 0)) { setErr("The 24K rate must be greater than zero."); return; }
    if (!(+rate22 > 0)) { setErr("The 22K rate must be greater than zero."); return; }
    if (!(+rate18 > 0)) { setErr("The 18K rate must be greater than zero."); return; }

    // Only karats that actually changed from the latest published row get
    // published — publishing an untouched karat would still be harmless
    // (the backend carries it forward unchanged either way) but would
    // create a needless extra history row for a value that didn't move.
    const jobs: { karat: 24 | 22 | 18; rate: number }[] = [];
    if (Math.round(+rate24) !== Math.round(latest.k24 || 0)) jobs.push({ karat: 24, rate: +rate24 });
    if (Math.round(+rate22) !== Math.round(latest.k22 || 0)) jobs.push({ karat: 22, rate: +rate22 });
    if (Math.round(+rate18) !== Math.round(latest.k18 || 0)) jobs.push({ karat: 18, rate: +rate18 });

    if (jobs.length === 0) {
      setErr("Nothing has changed from today's published rates.");
      return;
    }

    setErr("");
    setSaving(true);
    try {
      for (const j of jobs) {
        await publishGoldRate({ karat: j.karat, rate: j.rate, setBy });
      }
      refresh();
      closeModal();
      toast(`${jobs.map((j) => `${j.karat}K`).join(", ")} rate${jobs.length > 1 ? "s" : ""} published for today`);
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
        <div className="tabs" style={{ marginBottom: 14 }}>
          <button className={mode === "auto" ? "on" : ""} onClick={setAuto}>Auto</button>
          <button className={mode === "manual" ? "on" : ""} onClick={setManual}>Manual</button>
        </div>

        <div className="frow c3">
          <div>
            <label className="f">24K · 999 (₹/g)</label>
            <input className="inp" type="number" value={rate24} onChange={(e) => editRate24(e.target.value)} />
            <p style={{ fontSize: 11, color: "var(--muted)", margin: "5px 0 0" }}>
              {mode === "manual" ? "set directly" : "adjust directly, or via fineness below"}
            </p>
            {mode === "auto" && (
              <div style={{ marginTop: 8 }}>
                <label className="f" style={{ marginBottom: 2 }}>Fineness (%)</label>
                <input className="inp" type="number" max={100} value={fineness24} onChange={(e) => editFineness24(e.target.value)} />
                <span style={{ fontSize: 10.5, color: "var(--muted)", display: "block", marginTop: 4 }}>standard 100%</span>
              </div>
            )}
          </div>

          <div>
            <label className="f">22K (₹/g)</label>
            <input className="inp" type="number" value={rate22} onChange={(e) => editRate22(e.target.value)} />
            <p style={{ fontSize: 11, color: "var(--muted)", margin: "5px 0 0" }}>
              {mode === "manual" ? "set independently of 24K" : "editing this switches to Manual ↓"}
            </p>
            {mode === "auto" && (
              <div style={{ marginTop: 8 }}>
                <label className="f" style={{ marginBottom: 2 }}>Fineness (%)</label>
                <input className="inp" type="number" max={100} value={fineness22} onChange={(e) => editFineness22(e.target.value)} />
                <span style={{ fontSize: 10.5, color: "var(--muted)", display: "block", marginTop: 4 }}>standard {finenessForKarat(22)}%</span>
              </div>
            )}
          </div>

          <div>
            <label className="f">18K (₹/g)</label>
            <input className="inp" type="number" value={rate18} onChange={(e) => editRate18(e.target.value)} />
            <p style={{ fontSize: 11, color: "var(--muted)", margin: "5px 0 0" }}>
              {mode === "manual" ? "set independently of 24K" : "editing this switches to Manual ↓"}
            </p>
            {mode === "auto" && (
              <div style={{ marginTop: 8 }}>
                <label className="f" style={{ marginBottom: 2 }}>Fineness (%)</label>
                <input className="inp" type="number" max={100} value={fineness18} onChange={(e) => editFineness18(e.target.value)} />
                <span style={{ fontSize: 10.5, color: "var(--muted)", display: "block", marginTop: 4 }}>standard {finenessForKarat(18)}%</span>
              </div>
            )}
          </div>
        </div>

        {hierarchyWarning && (
          <div className="notice" style={{ marginTop: 14, borderColor: "var(--gold)" }}>
            <Icon name="warning" />
            <span>{hierarchyWarning} You can still publish this if intentional.</span>
          </div>
        )}

        <div className="notice" style={{ marginTop: 14 }}>
          <Icon name="shield" />
          <span>Typing 22K/18K&apos;s rate switches the whole modal to Manual; 24K&apos;s never does. Nothing publishes until you press Publish.</span>
        </div>
        <div className="frow" style={{ marginTop: 10 }}>
          <div><label className="f">Remarks (optional)</label><input className="inp" placeholder="e.g. MCX morning reference" value={remarks} onChange={(e) => setRemarks(e.target.value)} /></div>
        </div>
        <p style={{ color: "var(--red)", fontSize: 12.5, minHeight: 16, marginTop: 8 }}>{err}</p>
      </div>
      <div className="ft">
        <button className="btn ghost" onClick={closeModal}>Cancel</button>
        <button className="btn" onClick={save} disabled={saving}><Icon name="check" /> {saving ? "Publishing…" : "Publish Rate"}</button>
      </div>
    </>
  );
}
