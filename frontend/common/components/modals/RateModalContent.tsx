"use client";

import { useEffect, useRef, useState } from "react";
import { useGoldRates } from "@/modules/gold-rates/store/GoldRatesProvider";
import { useModal } from "@/common/components/ModalProvider";
import { useToast } from "@/common/components/ToastProvider";
import { Icon } from "@/common/components/Icon";
import { publishGoldRates } from "@/modules/gold-rates/services/goldRateService";
import { finenessFromRate, rateForFineness, FINENESS_24K } from "@/common/utils/purity";
import { ApiError } from "@/common/services/httpClient";
import { useAuth } from "@/common/providers/AuthProvider";
import { singleFlight } from "@/common/utils/singleFlight";

type Mode = "auto" | "manual";

/* Plays app.css's existing `.shake-attention` animation (see NewLoan.tsx's
 * gold-rate recovery banner) once, exactly when `invalid` first flips from
 * false to true — not on every re-render while it stays true, and not
 * replayed by React reusing the same className string across renders
 * (CSS doesn't restart an animation just because the element re-renders
 * with an unchanged class). Cleared again via onAnimationEnd, same
 * pattern as that banner. */
function useShake(invalid: boolean) {
  const [shaking, setShaking] = useState(false);
  const wasInvalid = useRef(false);
  useEffect(() => {
    if (invalid && !wasInvalid.current) {
      setShaking(false);
      requestAnimationFrame(() => setShaking(true));
    }
    wasInvalid.current = invalid;
  }, [invalid]);
  return shaking;
}

/* Ported from legacy/app.js's `openRateModal()` / `saveRate()`, then
 * redesigned to a single three-tile row (24K/22K/18K side by side,
 * matching the original layout) instead of a karat-picker + one field.
 *
 * Mode is all-or-nothing across all three karats — there is no per-karat
 * Auto/Manual split:
 * - Auto (default): every karat's rate derives live off a REFERENCE 24K
 *   figure (today's/session's already-published K24, frozen at open —
 *   `ref24` below) at an editable fineness% (prefilled with the standard
 *   ratio, karat/24, for 22K/18K). Typing the fineness recomputes that
 *   karat's rate live. 24K's fineness is fixed at 99.9% (999) and shown
 *   read-only — it labels the reference rate rather than scaling it.
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
  const { employee } = useAuth();
  const { closeModal } = useModal();
  const toast = useToast();

  // Frozen at open — the "999 reference" Auto falls back to when no rate
  // has been typed yet (see setAuto).
  const [ref24] = useState(latest.k24 || 0);

  const [mode, setMode] = useState<Mode>("auto");

  const [rate24, setRate24] = useState(String(latest.k24 || ""));

  const [rate22, setRate22] = useState(String(latest.k22 || ""));
  // Fineness isn't stored — restore what the last published rates imply
  // (rate ÷ 24K) rather than the standard ratio, so a custom fineness set
  // earlier is still showing when the modal is reopened.
  const [fineness22, setFineness22] = useState(String(finenessFromRate(latest.k24, latest.k22, 22)));

  const [rate18, setRate18] = useState(String(latest.k18 || ""));
  const [fineness18, setFineness18] = useState(String(finenessFromRate(latest.k24, latest.k18, 18)));

  const [remarks, setRemarks] = useState("");
  const [err, setErr] = useState("");
  const [saving, setSaving] = useState(false);

  // Which karat's rate field staff last actually typed into — the
  // hierarchy warning below only ever flags THIS one, never whichever
  // other karat it happens to be compared against, so editing 18K to
  // something too high never lights up 22K/24K (which nobody touched),
  // and vice versa.
  type Karat = 24 | 22 | 18 | null;
  const [lastEdited, setLastEdited] = useState<Karat>(null);

  function setAuto() {
    setMode("auto");
    const f22 = finenessFromRate(latest.k24, latest.k22, 22);
    const f18 = finenessFromRate(latest.k24, latest.k18, 18);
    setFineness22(String(f22));
    setFineness18(String(f18));

    let base24 = +rate24;
    if (!(base24 > 0) && +rate22 > 0) {
      base24 = Math.round((+rate22 / f22) * 100);
    }
    if (!(base24 > 0) && +rate18 > 0) {
      base24 = Math.round((+rate18 / f18) * 100);
    }
    if (!(base24 > 0)) {
      base24 = ref24;
    }

    if (base24 > 0) {
      setRate24(String(base24));
      setRate22(String(rateForFineness(base24, f22)));
      setRate18(String(rateForFineness(base24, f18)));
    }
    setLastEdited(null);
    setErr("");
  }
  function setManual() {
    setMode("manual");
    setLastEdited(null);
    setErr("");
  }

  function editRate24(v: string) {
    setRate24(v); // never switches mode — see file doc comment
    setLastEdited(24);
    // 22K/18K keep tracking 24K live while they're still in Auto.
    const k24 = +v;
    if (mode === "auto" && k24 > 0) {
      if (+fineness22 > 0) setRate22(String(rateForFineness(k24, +fineness22)));
      if (+fineness18 > 0) setRate18(String(rateForFineness(k24, +fineness18)));
    }
  }
  function editRate22(v: string) {
    setMode("manual"); // any direct 22K/18K rate edit is all-or-nothing
    setLastEdited(22);
    setRate22(v);
  }
  function editRate18(v: string) {
    setMode("manual");
    setLastEdited(18);
    setRate18(v);
  }
  // Fineness is a purity percentage — never meaningfully above 100%
  // (pure gold itself). Clamped, not rejected: typing "150" just settles
  // at "100" rather than blocking the keystroke or showing an error.
  function clampFineness(v: string): string {
    return v !== "" && +v > 100 ? "100" : v;
  }
  function editFineness22(v: string) {
    const c = clampFineness(v);
    setFineness22(c);
    // Off the LIVE 24K rate, not the frozen ref24 — tracks whatever's
    // currently typed in the 24K field, not just today's opening reference.
    if (+rate24 > 0 && +c > 0) setRate22(String(rateForFineness(+rate24, +c)));
  }
  function editFineness18(v: string) {
    const c = clampFineness(v);
    setFineness18(c);
    if (+rate24 > 0 && +c > 0) setRate18(String(rateForFineness(+rate24, +c)));
  }

  // Non-blocking sanity check on Manual entries — 22K/18K priced above a
  // purer karat inverts the usual purity hierarchy (less pure gold should
  // never cost more per gram). Flagged, never prevented: a real market
  // anomaly can legitimately happen and staff may need to publish it
  // anyway.
  const violation22vs24 = mode === "manual" && +rate22 > 0 && +rate24 > 0 && +rate22 > +rate24;
  const violation18vs22 = mode === "manual" && +rate18 > 0 && +rate22 > 0 && +rate18 > +rate22;
  const violation18vs24 = mode === "manual" && +rate18 > 0 && +rate24 > 0 && +rate18 > +rate24;
  // Only the karat actually being edited gets flagged, never whichever
  // other one it's compared against — typing 18K too high never lights
  // up 22K/24K, and vice versa.
  const invalid24 = lastEdited === 24 && (violation22vs24 || violation18vs24);
  const invalid22 = lastEdited === 22 && violation22vs24;
  const invalid18 = lastEdited === 18 && (violation18vs22 || violation18vs24);
  // A brighter, more saturated red than the app's usual --red (#c21725,
  // deliberately muted for everyday error text) — this needs to read as
  // an alarm, not just a validation note.
  const BRIGHT_RED = "#ef4444";
  const invalidInputStyle = { borderColor: BRIGHT_RED, boxShadow: `0 0 0 1px ${BRIGHT_RED}` };

  const shaking24 = useShake(invalid24);
  const shaking22 = useShake(invalid22);
  const shaking18 = useShake(invalid18);

  async function save() { return singleFlight("modal:rate:save", async () => {
    // The logged-in employee is who set this rate — never the previous
    // row's setBy (that was e.g. "Auto (GoldAPI)" from the background sync).
    const setBy = employee?.name || employee?.username || "Admin";
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
      await publishGoldRates(Object.fromEntries(jobs.map((j) => [j.karat, j.rate])), setBy);
      refresh();
      closeModal();
      toast(`${jobs.map((j) => `${j.karat}K`).join(", ")} rate${jobs.length > 1 ? "s" : ""} published for today`);
    } catch (e) {
      setErr(e instanceof ApiError ? e.message : "Could not publish rate — try again");
    } finally {
      setSaving(false);
    }
  }); }

  return (
    <>
      <div className="hd"><h3>Set Today&apos;s Gold Rate</h3><button className="x" onClick={closeModal}>×</button></div>
      <div className="bd bd-scroll">
        <div className="tabs" style={{ marginBottom: 14 }}>
          <button className={mode === "auto" ? "on" : ""} onClick={setAuto}>Auto</button>
          <button className={mode === "manual" ? "on" : ""} onClick={setManual}>Manual</button>
        </div>

        <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 12, marginBottom: 13 }}>
          <div>
            {mode === "auto" && (
              <div style={{ marginTop: 8, marginBottom: 12 }}>
                <label className="f" style={{ marginBottom: 2 }}>Fineness ({FINENESS_24K}%)</label>
                <input className="inp" type="number" style={{ width: 140, background: "var(--brand-faint)", cursor: "not-allowed" }} value={FINENESS_24K} disabled readOnly title="24K is fixed at 99.9% (999)" />
              </div>
            )}
            <label className="f">24K · 999 (₹/g)</label>
            <input
              className={`inp${shaking24 ? " shake-attention" : ""}`} type="number" value={rate24}
              onChange={(e) => editRate24(e.target.value)} style={{ width: 140, ...(invalid24 ? invalidInputStyle : {}) }}
            />
            {invalid24 && <p style={{ fontSize: 11, color: BRIGHT_RED, margin: "5px 0 0" }}>⚠ Price hierarchy is wrong.</p>}
            <p style={{ fontSize: 11, color: "var(--muted)", margin: "5px 0 0" }}>
              {mode === "manual" ? "set directly" : "22K/18K follow this rate"}
            </p>
          </div>

          <div>
            {mode === "auto" && (
              <div style={{ marginTop: 8, marginBottom: 12 }}>
                <label className="f" style={{ marginBottom: 2 }}>Fineness (91.7%)</label>
                <input className="inp" type="number" max={100} style={{ width: 140 }} value={fineness22} onChange={(e) => editFineness22(e.target.value)} />
              </div>
            )}
            <label className="f">22K (₹/g)</label>
            <input
              className={`inp${shaking22 ? " shake-attention" : ""}`} type="number" value={rate22}
              onChange={(e) => editRate22(e.target.value)} style={{ width: 140, ...(invalid22 ? invalidInputStyle : {}) }}
            />
            {invalid22 && <p style={{ fontSize: 11, color: BRIGHT_RED, margin: "5px 0 0" }}>⚠ Price hierarchy is wrong.</p>}
            <p style={{ fontSize: 11, color: "var(--muted)", margin: "5px 0 0" }}>
              {mode === "manual" ? "set independently of 24K" : "editing this switches to Manual "}
            </p>
          </div>

          <div>
            {mode === "auto" && (
              <div style={{ marginTop: 8, marginBottom: 12 }}>
                <label className="f" style={{ marginBottom: 2 }}>Fineness (75%)</label>
                <input className="inp" type="number" max={100} style={{ width: 140 }} value={fineness18} onChange={(e) => editFineness18(e.target.value)} />
              </div>
            )}
            <label className="f">18K (₹/g)</label>
            <input
              className={`inp${shaking18 ? " shake-attention" : ""}`} type="number" value={rate18}
              onChange={(e) => editRate18(e.target.value)} style={{ width: 140, ...(invalid18 ? invalidInputStyle : {}) }}
            />
            {invalid18 && <p style={{ fontSize: 11, color: BRIGHT_RED, margin: "5px 0 0" }}>⚠ Price hierarchy is wrong.</p>}
            <p style={{ fontSize: 11, color: "var(--muted)", margin: "5px 0 0" }}>
              {mode === "manual" ? "set independently of 24K" : "editing this switches to Manual "}
            </p>
          </div>
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
