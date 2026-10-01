"use client";

import { useEffect, useRef, useState } from "react";
import { Icon } from "@/product/components/Icon";
import { FEATURES } from "@/product/config/features";

const STEPS: [number, string][] = [
  [0, "Downloading update"],
  [38, "Installing"],
  [82, "Finishing up"],
];
const RING_C = 2 * Math.PI * 12;
const storageKey = () => `cloudhouse.updateNotice.${FEATURES.updateId}`;

type State = "hidden" | "idle" | "updating" | "done";

function stepIndex(p: number) {
  let k = 0;
  STEPS.forEach(([at], i) => { if (p >= at) k = i; });
  return k;
}

/* The sidebar's "Update available" card, pinned above the footer. Shown only
 * when NEXT_PUBLIC_ENABLE_UPDATE_NOTICE is on. UI-only: "Update now" runs a
 * progress animation inside this card (nothing else on the page moves),
 * then shows "You're up to date" and folds away. Finishing or choosing
 * "Later" is remembered per update (keyed by the notes text), so the card
 * comes back only when the env file announces a new one. */
export function UpdateNotice() {
  // Starts hidden and reads storage after mount, so the static-export HTML
  // and the first client render agree.
  const [state, setState] = useState<State>("hidden");
  const [progress, setProgress] = useState(0);
  const [closing, setClosing] = useState(false);
  const timers = useRef<number[]>([]);
  const tick = useRef(0);

  useEffect(() => {
    if (!FEATURES.updateNotice) return;
    let seen = false;
    try { seen = localStorage.getItem(storageKey()) === "1"; } catch { /* storage blocked: just show it */ }
    // localStorage can't be read during render without breaking hydration
    // (same reasoning as BrandingProvider's mount effect).
    // eslint-disable-next-line react-hooks/set-state-in-effect
    if (!seen) setState("idle");
    const pending = timers.current;
    return () => pending.forEach((t) => { window.clearTimeout(t); window.clearInterval(t); });
  }, []);

  function remember() {
    try { localStorage.setItem(storageKey(), "1"); } catch { /* not persisted; shows again next load */ }
  }

  function close() {
    remember();
    setClosing(true);
    timers.current.push(window.setTimeout(() => setState("hidden"), 480));
  }

  function start() {
    setState("updating");
    setProgress(0);
    const id = window.setInterval(() => {
      setProgress((p) => {
        // Uneven speed per stage so it reads like download / install work.
        const inc = p < 38 ? 2.6 : p < 82 ? 1.4 : 2.2;
        return Math.min(100, p + inc * (0.6 + Math.random() * 0.8));
      });
    }, 90);
    tick.current = id;
    timers.current.push(id);
  }

  // Completion lives here rather than inside the setProgress updater, which
  // must stay pure (Strict Mode runs updaters twice).
  useEffect(() => {
    if (state !== "updating" || progress < 100) return;
    window.clearInterval(tick.current);
    const t = window.setTimeout(() => setState("done"), 350);
    return () => window.clearTimeout(t);
  }, [state, progress]);

  useEffect(() => {
    if (state !== "done") return;
    const t = window.setTimeout(close, 3200);
    return () => window.clearTimeout(t);
    // close only touches refs and setters
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state]);

  if (state === "hidden") return null;
  const k = stepIndex(progress);

  return (
    <div className={`upd-slot${closing ? " closing" : ""}`}>
      {state === "idle" && (
        <div className="upd-card">
          <div className="upd-top"><span className="upd-dot" /><b>Update available</b></div>
          <p>{FEATURES.updateNotes}</p>
          <div className="upd-actions">
            <button className="upd-go" onClick={start}><Icon name="download" />Update now</button>
            <button className="upd-later" onClick={close}>Later</button>
          </div>
        </div>
      )}
      {state === "updating" && (
        <div className="upd-card" aria-live="polite">
          <div className="upd-run">
            <div className="upd-ring">
              <svg viewBox="0 0 30 30">
                <circle className="trk" cx="15" cy="15" r="12" fill="none" strokeWidth="3" />
                <circle className="val" cx="15" cy="15" r="12" fill="none" strokeWidth="3" strokeLinecap="round"
                  strokeDasharray={RING_C} strokeDashoffset={RING_C * (1 - progress / 100)} />
              </svg>
              <span className="upd-spin" />
            </div>
            <div className="upd-txt"><b>Updating…</b><span>{STEPS[k][1]}</span></div>
            <span className="upd-pct">{Math.round(progress)}%</span>
          </div>
          <div className="upd-bar"><i style={{ width: `${progress}%` }} /></div>
          <div className="upd-steps">{STEPS.map(([at], i) => <i key={at} className={i <= k ? "on" : ""} />)}</div>
        </div>
      )}
      {state === "done" && (
        <div className="upd-card done" aria-live="polite">
          <div className="upd-run">
            <span className="upd-chk">
              <svg viewBox="0 0 24 24" fill="none" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round"><path d="M5 12.5l4.5 4.5L19 7.5" /></svg>
            </span>
            <div className="upd-txt"><b>You&apos;re up to date</b><span>Updated just now</span></div>
          </div>
        </div>
      )}
    </div>
  );
}
