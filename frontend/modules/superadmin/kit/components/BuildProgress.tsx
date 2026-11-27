import { useEffect, useState } from "react";
import { OS_ICON, OS_NAME, type DesktopOs } from "../common/desktopOs";
import "../styles/desktop.css";

/* The live desktop builds, the same in every console: one card per operating
 * system build with a progress bar, six steps, the time, and Cancel / View log /
 * Retry / Download, under one overall bar. A product turns its own build jobs
 * into BuildCards. */

export const BUILD_STEPS = ["Queued", "Preparing", "Building", "Uploading", "Verifying", "Done"] as const;

export type BuildState = "run" | "done" | "failed" | "cancelled";

export type BuildCard = {
  /** Unique per card (a job can hold several systems). */
  key: string;
  /** The product's build job this card belongs to — what Cancel stops and Retry replaces. */
  jobId: number;
  os: DesktopOs;
  /** The business it is built for (its code or name). */
  business: string;
  version: string;
  state: BuildState;
  /** 0-5 in BUILD_STEPS: the step it is on. Unknown on a stopped build = the last step seen. */
  stage?: number | undefined;
  /** The product's own words for the step right now (e.g. GitHub's step name). */
  detail?: string | undefined;
  /** Real progress 0-100 when the product reports it; otherwise it is estimated from the time. */
  percent?: number | undefined;
  startedAt: string;
  /** When it stopped (finished, failed or cancelled). */
  endedAt?: string | undefined;
  logUrl?: string | undefined;
  downloadUrl?: string | undefined;
};

// Where each step sits on the bar (%), and a typical run length per system, for the estimate and "time left".
const EDGE = [0, 5, 15, 75, 90, 100];
const TYPICAL_SECONDS: Record<DesktopOs, number> = { win: 180, mac: 300, linux: 240, content: 120 };

const CHECK = (
  <svg viewBox="0 0 10 10" fill="none" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <path d="M2 5.2 4.1 7.2 8 3" />
  </svg>
);
const CROSS = (
  <svg viewBox="0 0 10 10" fill="none" strokeWidth="2" strokeLinecap="round" aria-hidden="true">
    <path d="M3 3l4 4M7 3 3 7" />
  </svg>
);

function formatDuration(totalSeconds: number) {
  const s = Math.max(0, Math.floor(totalSeconds));
  const m = Math.floor(s / 60);
  return m ? `${m}m ${String(s % 60).padStart(2, "0")}s` : `${s}s`;
}

function secondsBetween(fromIso: string, to: number) {
  const from = new Date(fromIso).getTime();
  return Number.isNaN(from) ? 0 : (to - from) / 1000;
}

type BuildProgressProps = {
  cards: BuildCard[];
  onCancel: (card: BuildCard) => void;
  /** Starts the failed build again; absent = no Retry button. */
  onRetry?: ((card: BuildCard) => void) | undefined;
  /** The version live before this build, for the "installed apps will update" note. */
  previousVersion?: string | null | undefined;
  error?: string | null | undefined;
};

export function BuildProgress({ cards, onCancel, onRetry, previousVersion, error }: BuildProgressProps) {
  const [now, setNow] = useState(() => Date.now());
  // The last running step seen per card, so a stopped card can mark the step it stopped at. Updated while
  // rendering when new cards arrive (React's pattern for state that follows props), not in an effect.
  const [seen, setSeen] = useState<{ cards: BuildCard[] | null; stages: Record<string, number> }>({ cards: null, stages: {} });
  if (seen.cards !== cards) {
    const stages = { ...seen.stages };
    for (const c of cards) if (c.state === "run" && c.stage !== undefined) stages[c.key] = c.stage;
    setSeen({ cards, stages });
  }
  const lastStage = seen.stages;
  const running = cards.some((c) => c.state === "run");

  // A one-second clock while anything runs, for the elapsed and time-left figures.
  useEffect(() => {
    if (!running) return;
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, [running]);

  const stageOf = (c: BuildCard) => (c.state === "done" ? 5 : c.stage ?? lastStage[c.key] ?? 0);
  const endOf = (c: BuildCard) => (c.state !== "run" && c.endedAt ? new Date(c.endedAt).getTime() : now);

  // Progress of one card on the 0-100 bar: the real percent when known, else estimated inside its step's band.
  function progressOf(c: BuildCard) {
    if (c.state === "done") return 100;
    if (c.percent !== undefined) return Math.min(99, Math.max(0, c.percent));
    const stage = stageOf(c);
    const elapsed = secondsBetween(c.startedAt, endOf(c));
    return Math.min(Math.max((elapsed / TYPICAL_SECONDS[c.os]) * 100, EDGE[stage]), EDGE[stage + 1] - 1);
  }

  const finished = cards.filter((c) => c.state !== "run").length;
  const failed = cards.filter((c) => c.state === "failed").length;
  const ready = cards.filter((c) => c.state === "done").length;
  const overall = cards.length ? cards.reduce((sum, c) => sum + progressOf(c), 0) / cards.length : 0;
  const appWord = cards.length === 1 ? "app" : "apps";
  const summary =
    finished < cards.length
      ? `Building ${cards.length} ${appWord}…`
      : failed || ready < cards.length
        ? `${ready} of ${cards.length} ready${failed ? `, ${failed} failed` : ""}`
        : `All ${cards.length} ${appWord} ready`;

  return (
    <div className="sa-rb">
      <div className="sa-rb-summary">
        <div className="sa-rb-summary-top">
          <strong>{summary}</strong>
          <span>
            {finished} of {cards.length} finished
          </span>
        </div>
        <div className="sa-rb-bar">
          <i style={{ width: `${overall}%` }} />
        </div>
      </div>

      {error && (
        <span className="sa-error" role="alert">
          {error}
        </span>
      )}

      {cards.map((c) => {
        const elapsed = secondsBetween(c.startedAt, endOf(c));
        const pct = Math.round(progressOf(c));
        const stage = stageOf(c);
        const osName = OS_NAME[c.os];
        const stateLabel =
          c.state === "run" ? `${BUILD_STEPS[stage]}…` : c.state === "done" ? "Ready" : c.state === "failed" ? `Failed at ${BUILD_STEPS[stage].toLowerCase()}` : "Cancelled";
        const timeLine =
          c.state === "run"
            ? c.percent !== undefined
              ? c.detail || `Running for ${formatDuration(elapsed)}`
              : `About ${formatDuration(Math.max(0, TYPICAL_SECONDS[c.os] - elapsed))} left`
            : c.state === "done"
              ? `Finished in ${formatDuration(elapsed)}`
              : `Stopped after ${formatDuration(elapsed)}`;
        const downloadLabel = c.os === "win" ? "Download for Windows" : c.os === "mac" ? "Download for macOS" : "Download";
        return (
          <div key={c.key} className={`sa-rb-job ${c.state}`}>
            <div className="sa-rb-job-top">
              <div className="sa-rb-os">{OS_ICON[c.os]}</div>
              <div className="sa-rb-who">
                <b>
                  {osName} · v{c.version}
                </b>
                <span>
                  <span className="sa-rb-code">{c.business}</span> · {formatDuration(elapsed)}
                </span>
              </div>
              <span className={`sa-rb-state ${c.state}`}>{stateLabel}</span>
            </div>

            <div className="sa-rb-track">
              <div className="sa-rb-pct">
                <span>{timeLine}</span>
                <span>{pct}%</span>
              </div>
              <div className="sa-rb-bar">
                <i style={{ width: `${pct}%` }} />
              </div>
            </div>

            <ol className="sa-rb-steps" aria-label="Build steps">
              {BUILD_STEPS.map((s, i) => {
                const cls = c.state === "done" || i < stage ? "past" : i === stage ? "now" : "";
                const mark = c.state === "failed" && i === stage ? CROSS : cls === "past" ? CHECK : null;
                return (
                  <li key={s} className={cls}>
                    <div className="sa-rb-dot">{mark}</div>
                    <span>{s}</span>
                  </li>
                );
              })}
            </ol>

            {c.state === "failed" && (
              <div className="sa-rb-msg bad">
                The {osName} build stopped while {BUILD_STEPS[stage].toLowerCase()}
                {c.detail ? ` (${c.detail})` : ""}. Open the log to see the full error.
              </div>
            )}
            {c.state === "done" && c.os !== "content" && (
              <div className="sa-rb-msg ok">
                Uploaded. Installed apps{previousVersion && previousVersion !== c.version ? ` on version ${previousVersion}` : ""} will offer this update next time they open.
              </div>
            )}

            <div className="sa-rb-actions">
              {c.state === "run" && (
                <button type="button" className="sa-btn danger" onClick={() => onCancel(c)}>
                  Cancel
                </button>
              )}
              {/* Always shown, so every build card has the same buttons; greyed out until GitHub gives the log link. */}
              {c.logUrl ? (
                <a className="sa-btn" href={c.logUrl} target="_blank" rel="noopener noreferrer">
                  View log
                </a>
              ) : (
                <button type="button" className="sa-btn" disabled title="Available once GitHub starts this build">
                  View log
                </button>
              )}
              {c.state === "failed" && onRetry && (
                <button type="button" className="sa-btn" onClick={() => onRetry(c)}>
                  Retry {osName}
                </button>
              )}
              {c.state === "done" && c.downloadUrl && (c.os !== "mac" || /\.dmg(\?|$)/i.test(c.downloadUrl)) && (
                <a className="sa-btn primary" href={c.downloadUrl} target="_blank" rel="noopener noreferrer">
                  {downloadLabel}
                </a>
              )}
            </div>
          </div>
        );
      })}
    </div>
  );
}
